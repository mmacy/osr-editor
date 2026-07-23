"""The working-document service: canonical serialization, the open-project registry, ops, undo/redo, revisions.

The canonical form is byte-compatible with osr-forge's `write_json_artifact`:
`json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False)` plus a trailing
newline, UTF-8. `sort_keys=False` is the load-bearing half — pydantic dumps fields
in declaration order and `json.loads` preserves insertion order, so
write → reopen → re-dump is byte-stable with no sorting anywhere.

The byte-identity promise covers documents the editor wrote under the same
installed osrlib: re-stamping under a different engine version changes
`engine_version`, so a foreign or older-engine document normalizes on its first
write — one honest diff, exactly the spec's carve-out.

osrlib owns the envelope and its checking. [`load_adventure`][osreditor.documents.load_adventure]
propagates osrlib's errors untranslated — `SaveVersionError` on a newer
`schema_version`, `ContentValidationError` on a wrong kind or malformed envelope —
and the API layer attaches remedies; the editor never re-implements envelope checking.

[`DocumentService`][osreditor.documents.DocumentService] holds the open-project
registry: sync-def endpoints run in FastAPI's threadpool, so threading primitives
are correct (osr-web's proven pattern), and every
[`OpenProject`][osreditor.documents.OpenProject] carries its own lock, created
eagerly in the constructor so it exists before the object is ever published. One
deliberate divergence from osr-web, documented here because osr-web never opens
the same object twice: the editor must — two tabs, one path — so the registry
keeps a resolved-path index and open is get-or-create under the registry lock,
returning the *same* project and id for the same path. That shared document and
revision stream is what makes the 409 contract meaningful. The registry lives on
`app.state`, built in `create_app()` — not module globals like osr-web, because
phase 0 chose an app factory and tests must not leak open projects across app
instances.
"""

import json
import re
import secrets
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

from osrforge.contracts.overrides import Overrides
from osrforge.contracts.report import ExtractionReport
from osrforge.contracts.run import RunMeta
from osrlib.crawl.adventure import Adventure
from osrlib.crawl.dungeon import (
    AreaSpec,
    DungeonSpec,
    EdgeKind,
    FeatureSpec,
    LevelSpec,
    Position,
    TransitionSpec,
)
from osrlib.versioning import check_document, stamp_document
from pydantic import ValidationError

from osreditor.addresses import area_address, cell_address, dungeon_address, level_address
from osreditor.diagnostics import compute_diagnostics, forge_findings
from osreditor.errors import (
    OpInvariantError,
    OpRejectedError,
    OpTargetNotFoundError,
    ProjectNotFoundError,
    RedoStackEmptyError,
    StaleRevisionError,
    UndoStackEmptyError,
)
from osreditor.forge import assemble_workdir, check_workdir, read_overrides_value, read_run_meta, rerun_assemble
from osreditor.ops import (
    AddDungeon,
    AddFeature,
    AddLevel,
    AddTransition,
    AnyEditOp,
    CreateArea,
    Diagnostics,
    ForgeState,
    OpBatch,
    OpBatchResult,
    RemoveArea,
    RemoveDungeon,
    RemoveFeature,
    RemoveLevel,
    RemoveTransition,
    RenameDungeon,
    RenumberLevel,
    ResizeLevel,
    SetAdventureField,
    SetAreaCells,
    SetAreaField,
    SetDungeonField,
    SetEdges,
    SetEncounter,
    SetEntrance,
    SetFeature,
    SetTownField,
    SetTrap,
    SetTreasure,
    SetWandering,
    SubtreeChange,
)
from osreditor.overrides import ForgeTranslationState, TranslationResult, ensure_forge_supported, translate_batch
from osreditor.sidecar import SIDECAR_ARTIFACT, AnySidecarPatch, EditorSidecar, apply_sidecar_patches
from osreditor.store import ProjectStore

__all__ = [
    "ADVENTURE_ARTIFACT",
    "OVERRIDES_ARTIFACT",
    "DocumentService",
    "ForgeProjectState",
    "HistoryEntry",
    "LoadedProject",
    "OpenProject",
    "ProjectType",
    "canonical_edge_cells",
    "canonical_json_bytes",
    "dropped_pointers",
    "dump_adventure",
    "json_pointer",
    "load_adventure",
]

ADVENTURE_ARTIFACT = "adventure.json"
OVERRIDES_ARTIFACT = "overrides.yaml"
MAX_UNDO_DEPTH = 100

ProjectType = Literal["native", "forge"]


def canonical_json_bytes(data: Mapping[str, object]) -> bytes:
    """Serialize a mapping in the canonical byte format.

    Args:
        data: The JSON-ready mapping (typically a stamped document).

    Returns:
        UTF-8 bytes: 2-space indent, `ensure_ascii=False`, keys in insertion
        order, trailing newline.
    """
    return (json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n").encode("utf-8")


def dump_adventure(adventure: Adventure) -> bytes:
    """Serialize an adventure to canonical stamped-document bytes.

    Args:
        adventure: The adventure to serialize.

    Returns:
        The stamped `"adventure"` document in canonical bytes, stamped at the
        installed osrlib's current schema and engine versions.
    """
    document = stamp_document("adventure", adventure.model_dump(mode="json"))
    return canonical_json_bytes(document)


def load_adventure(data: bytes) -> Adventure:
    """Load an adventure from stamped-document bytes.

    Args:
        data: The serialized document, as produced by
            [`dump_adventure`][osreditor.documents.dump_adventure] or any
            osrlib-family writer.

    Returns:
        The validated adventure.

    Raises:
        osrlib.errors.ContentValidationError: If the envelope is malformed or the
            kind is not `"adventure"`.
        osrlib.errors.SaveVersionError: If the document's `schema_version` is
            newer than the installed osrlib understands.
        pydantic.ValidationError: If the payload fails model validation.
    """
    document = json.loads(data)
    payload = check_document(document, "adventure")
    return Adventure.model_validate(payload)


def _escape_pointer_token(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def json_pointer(parts: Sequence[object]) -> str:
    """Build an RFC 6901 JSON Pointer from path parts.

    Args:
        parts: Mapping keys and sequence indices, outermost first — e.g. a
            pydantic error `loc`.

    Returns:
        The pointer, tokens escaped; empty parts give `""` (the whole document).
    """
    return "".join(f"/{_escape_pointer_token(str(part))}" for part in parts)


def _resolve_pointer(node: object, pointer: str) -> object:
    if pointer == "":
        return node
    for raw in pointer[1:].split("/"):
        token = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(node, Mapping):
            node = cast(Mapping[str, object], node)[token]
        elif isinstance(node, Sequence) and not isinstance(node, str):
            node = cast(Sequence[object], node)[int(token)]
        else:
            raise KeyError(f"pointer {pointer!r} does not resolve")
    return node


def dropped_pointers(source: object, reserialized: object, prefix: str = "") -> tuple[str, ...]:
    """Walk a source payload against its re-serialization, reporting dropped fields.

    The open-time fidelity diff, the spec's guard against an always-saved editor
    silently eating a newer osrlib's fields: a key present in the source but
    absent from the re-serialization — recursively through mappings, pairwise
    through sequences — is a field the pinned models dropped. The reverse
    direction (defaults the pinned models add) is normal normalization and
    reports nothing.

    Args:
        source: The document payload as read from disk.
        reserialized: The parsed model's `model_dump(mode="json")`.
        prefix: The JSON Pointer of the node under comparison (recursion state).

    Returns:
        The dropped fields as RFC 6901 JSON Pointers, in source order.
    """
    dropped: list[str] = []
    if isinstance(source, Mapping):
        source_map = cast(Mapping[str, object], source)
        if isinstance(reserialized, Mapping):
            reserialized_map = cast(Mapping[str, object], reserialized)
            for key, value in source_map.items():
                pointer = f"{prefix}/{_escape_pointer_token(key)}"
                if key not in reserialized_map:
                    dropped.append(pointer)
                else:
                    dropped.extend(dropped_pointers(value, reserialized_map[key], pointer))
        else:
            # The node changed shape entirely — every source key under it is
            # gone from the re-serialization, which is exactly the loss the
            # guard exists to name.
            dropped.extend(f"{prefix}/{_escape_pointer_token(key)}" for key in source_map)
    elif isinstance(source, Sequence) and not isinstance(source, str | bytes):
        source_seq = cast(Sequence[object], source)
        if isinstance(reserialized, Sequence) and not isinstance(reserialized, str | bytes):
            reserialized_seq = cast(Sequence[object], reserialized)
            for index, value in enumerate(source_seq):
                pointer = f"{prefix}/{index}"
                if index >= len(reserialized_seq):
                    dropped.append(pointer)
                else:
                    dropped.extend(dropped_pointers(value, reserialized_seq[index], pointer))
        else:
            dropped.extend(f"{prefix}/{index}" for index in range(len(source_seq)))
    return tuple(dropped)


@dataclass
class ForgeProjectState:
    """A forge-backed project's working state beside the document.

    Mutable like [`OpenProject`][osreditor.documents.OpenProject] — guarded by
    the same per-project lock. `overrides_bytes` is the raw `overrides.yaml`
    as on disk (`b""` when absent), the currency of the forge undo stack's
    snapshots; `checked` flips false on every assembly (re-assembly wipes
    check findings by forge's design) and true after the check route.
    """

    workdir: Path
    run: RunMeta
    report: ExtractionReport
    overrides: Overrides
    overrides_bytes: bytes
    checked: bool = False


@dataclass(frozen=True)
class LoadedProject:
    """What a project loader answers: everything `get_or_open` needs to admit a project."""

    adventure: Adventure
    project_type: ProjectType
    dropped_fields: tuple[str, ...]
    sidecar: EditorSidecar
    forge: ForgeProjectState | None


@dataclass(frozen=True)
class HistoryEntry:
    """One undo-stack step.

    Native entries carry the prior document plus the note key-remaps the
    commit's re-keying ops performed (undo replays them inversely, redo
    forward, on the live notes map — note *content* never rides the stack).
    Forge entries carry the snapshot pair instead: the `overrides.yaml` bytes
    and the `auto_reasons` tuple together — the document is derived state, and
    `auto_reasons` is derived state of the same commit, so one is never
    restored without the other.
    """

    document: Adventure | None = None
    note_remap: tuple[tuple[str, str], ...] = ()
    forge_snapshot: tuple[bytes, tuple[str, ...]] | None = None


class OpenProject:
    """One open project: the document, its revision stream, and its history.

    Mutable by design — this is the working state the service guards with the
    per-project lock, created eagerly here so it exists before the object is
    ever published to another thread.
    """

    def __init__(
        self,
        project_id: str,
        path: Path,
        project_type: ProjectType,
        adventure: Adventure,
        dropped_fields: tuple[str, ...],
        diagnostics: Diagnostics,
        sidecar: EditorSidecar,
        forge: ForgeProjectState | None = None,
    ) -> None:
        """Bundle a just-loaded project's working state.

        Args:
            project_id: The server-minted opaque id.
            path: The resolved project directory path.
            project_type: The detected project shape.
            adventure: The loaded (native) or assembled (forge) document.
            dropped_fields: The open-time fidelity diff's pointers.
            diagnostics: The diagnostics computed at open.
            sidecar: The editor sidecar, loaded or empty.
            forge: The forge working state; `None` for native projects.
        """
        self.id = project_id
        self.path = path
        self.type: ProjectType = project_type
        self.adventure = adventure
        self.dropped_fields = dropped_fields
        self.diagnostics = diagnostics
        self.sidecar = sidecar
        self.forge = forge
        self.revision_number = 1
        self.undo_stack: list[HistoryEntry] = []
        self.redo_stack: list[HistoryEntry] = []
        self.lock = threading.Lock()

    @property
    def revision(self) -> str:
        """The current revision token — contractually opaque; the format is this issuer's private choice."""
        return f"r{self.revision_number}"


class DocumentService:
    """The open-project registry and the batch/undo/redo engine.

    Project ids are opaque server-minted tokens; a server restart mints fresh
    ids, so no stale revision can ever cross process lifetimes — the old tab
    404s and reopens.
    """

    def __init__(self, store: ProjectStore) -> None:
        """Build an empty registry over a store.

        Args:
            store: The persistence seam every artifact write goes through.
        """
        self.store = store
        self._registry_lock = threading.Lock()
        self._by_id: dict[str, OpenProject] = {}
        self._by_path: dict[str, OpenProject] = {}

    def get(self, project_id: str) -> OpenProject:
        """Return the open project with `project_id`.

        Args:
            project_id: The server-minted project id.

        Returns:
            The open project.

        Raises:
            ProjectNotFoundError: If no open project has that id (typically a
                stale id after a server restart).
        """
        with self._registry_lock:
            project = self._by_id.get(project_id)
        if project is None:
            raise ProjectNotFoundError(f"no open project with id {project_id!r}")
        return project

    def get_or_open(self, path: Path, loader: Callable[[], LoadedProject]) -> OpenProject:
        """Return the already-open project for a resolved path, or admit a new one.

        The whole open — `loader` included — runs under the registry lock:
        single-user, milliseconds, simplicity wins. Two tabs opening one path
        get the *same* project and id, hence one document, one revision stream,
        one history.

        Args:
            path: The resolved project directory path (the registry index).
            loader: Classifies and loads the project; called only on a miss.

        Returns:
            The open project.
        """
        with self._registry_lock:
            existing = self._by_path.get(str(path))
            if existing is not None:
                return existing
            loaded = loader()
            diagnostics = compute_diagnostics(loaded.adventure)
            if loaded.forge is not None:
                diagnostics = diagnostics.model_copy(update={"forge": forge_findings(loaded.forge.report.findings)})
            project = OpenProject(
                project_id=secrets.token_hex(8),
                path=path,
                project_type=loaded.project_type,
                adventure=loaded.adventure,
                dropped_fields=loaded.dropped_fields,
                diagnostics=diagnostics,
                sidecar=loaded.sidecar,
                forge=loaded.forge,
            )
            self._by_id[project.id] = project
            self._by_path[str(path)] = project
            return project

    def close(self, project: OpenProject) -> None:
        """Drop a project from the open registry (the detach crossing).

        The next open of the same path admits a fresh project with a fresh id;
        any tab still holding the old id 404s and returns home — the same
        contract a server restart already imposes.

        Args:
            project: The project to drop.
        """
        with self._registry_lock:
            self._by_id.pop(project.id, None)
            self._by_path.pop(str(project.path), None)

    def apply_batch(self, project: OpenProject, batch: OpBatch) -> OpBatchResult:
        """Apply one batch atomically: all ops or none, one undo step, one revision.

        Native projects commit the op-applied document directly. Forge-backed
        projects run the same ops against the in-memory document first — the
        same invariants and rejections hold in both modes, with the pinned
        growth-rule substitution — then translate the batch to the next
        `overrides.yaml` value and run the forge commit protocol; the document
        the project adopts is the *assembled* result, never the candidate.

        Args:
            project: The open project.
            batch: The ops and the revision they were computed against.

        Returns:
            The result: new revision, coalesced delta, refreshed diagnostics.

        Raises:
            StaleRevisionError: If the batch names any revision but the current one.
            OpTargetNotFoundError: If an op's target — a dungeon, level, area,
                or transition position — is not in the document.
            OpInvariantError: If an op violates an editor-enforced semantic
                invariant (a duplicate id, a non-canonical edge key, an
                out-of-bounds cell, a stranding resize — see the op docstrings).
            OpUnsupportedForgeError: If the project is forge-backed and an op
                has no override translation — the whole batch rejects before
                any translation side effect, with the detach offer as remedy.
            OpRejectedError: If the batch would produce an invalid model — the
                round-trip re-validation is the single enforcement point, because
                `model_copy(update=...)` bypasses every validator in pydantic v2.
                It also backstops every invariant the ops enforce ahead of it: a
                bug in an op-level check surfaces as `op_rejected`, never a
                committed invalid document.
            ForgeOverrideInvalidError: If forge rejects the translated
                overrides at assembly — the snapshot is restored and the
                workdir is unchanged (forge fails before any artifact write).
        """
        with project.lock:
            if batch.revision != project.revision:
                raise StaleRevisionError(
                    f"batch was computed against revision {batch.revision}, "
                    f"but the current revision is {project.revision}",
                    current_revision=project.revision,
                )
            if project.forge is not None:
                return self._apply_forge_batch(project, batch)
            candidate = project.adventure
            touched: list[str] = []
            remap_rules: list[tuple[str, str]] = []
            for op in batch.ops:
                candidate, pointer = _apply_op(candidate, op)
                touched.append(pointer)
                remap_rules.extend(_note_remap_rules(op))
            try:
                validated = Adventure.model_validate(candidate.model_dump())
            except ValidationError as error:
                raise OpRejectedError(
                    "the batch would produce an invalid document and was rejected whole",
                    errors=[
                        {"path": json_pointer(detail["loc"]), "message": detail["msg"]} for detail in error.errors()
                    ],
                ) from error
            previous = project.adventure
            self._commit(project, validated)
            applied_remap = self._remap_notes(project, remap_rules)
            project.undo_stack.append(HistoryEntry(document=previous, note_remap=applied_remap))
            if len(project.undo_stack) > MAX_UNDO_DEPTH:
                project.undo_stack.pop(0)
            project.redo_stack.clear()
            payload = validated.model_dump(mode="json")
            delta = _coalesce_delta(payload, touched)
            return self._result(project, delta)

    def _apply_forge_batch(self, project: OpenProject, batch: OpBatch) -> OpBatchResult:
        """The forge half of `apply_batch`: apply, validate, translate, commit. Caller holds the lock."""
        forge = project.forge
        assert forge is not None
        ensure_forge_supported(batch.ops)
        candidate = project.adventure
        for op in batch.ops:
            candidate, _ = _apply_op(candidate, op, forge_mode=True)
        try:
            Adventure.model_validate(candidate.model_dump())
        except ValidationError as error:
            raise OpRejectedError(
                "the batch would produce an invalid document and was rejected whole",
                errors=[{"path": json_pointer(detail["loc"]), "message": detail["msg"]} for detail in error.errors()],
            ) from error
        translation = translate_batch(
            batch.ops,
            ForgeTranslationState(
                document=project.adventure,
                applied=candidate,
                overrides=forge.overrides,
                report=forge.report,
                auto_reasons=frozenset(project.sidecar.auto_reasons),
            ),
        )
        return self._commit_forge(project, translation)

    def commit_forge_translation(
        self, project: OpenProject, revision: str, translation: TranslationResult
    ) -> OpBatchResult:
        """Commit an already-built overrides value at a named revision — the override-level edits' entry.

        Args:
            project: The open project (must be forge-backed).
            revision: The revision the edits were computed against.
            translation: The next overrides value with its `auto_reasons`.

        Returns:
            The result, carrying the whole-document delta and refreshed forge
            state.

        Raises:
            StaleRevisionError: If `revision` is not current.
            ForgeOverrideInvalidError: If forge rejects the overrides at
                assembly — the snapshot is restored.
        """
        with project.lock:
            if revision != project.revision:
                raise StaleRevisionError(
                    f"edits were computed against revision {revision}, but the current revision is {project.revision}",
                    current_revision=project.revision,
                )
            return self._commit_forge(project, translation)

    def _commit_forge(self, project: OpenProject, translation: TranslationResult) -> OpBatchResult:
        """The forge commit protocol: snapshot → write → assemble → adopt, or restore.

        Caller holds the lock. On any assembly failure the snapshotted
        `overrides.yaml` bytes and `auto_reasons` are restored and the error
        re-raised — forge's fail-before-write guarantee means the workdir
        artifacts never saw the bad file, so restoring the input restores the
        whole state.
        """
        forge = project.forge
        assert forge is not None
        snapshot = HistoryEntry(forge_snapshot=(forge.overrides_bytes, project.sidecar.auto_reasons))
        new_bytes = translation.serialized
        new_auto = tuple(sorted(translation.auto_reasons))
        self._write_forge_state(project, new_bytes, new_auto)
        try:
            result = assemble_workdir(forge.workdir)
        except Exception:
            self._write_forge_state(project, *_snapshot_pair(snapshot))
            raise
        self._adopt_assembly(project, result.adventure, result.report)
        forge.overrides = translation.overrides
        project.undo_stack.append(snapshot)
        if len(project.undo_stack) > MAX_UNDO_DEPTH:
            project.undo_stack.pop(0)
        project.redo_stack.clear()
        return self._result(project, _whole_document_delta(project.adventure))

    def _write_forge_state(self, project: OpenProject, overrides_bytes: bytes, auto_reasons: tuple[str, ...]) -> None:
        """Write the overrides file and, when it changed, the sidecar's `auto_reasons`."""
        forge = project.forge
        assert forge is not None
        self.store.write_artifact(str(project.path), OVERRIDES_ARTIFACT, overrides_bytes)
        forge.overrides_bytes = overrides_bytes
        if auto_reasons != project.sidecar.auto_reasons:
            project.sidecar = project.sidecar.model_copy(update={"auto_reasons": auto_reasons})
            self.persist_sidecar(project)

    def _adopt_assembly(self, project: OpenProject, adventure: Adventure, report: ExtractionReport) -> None:
        """Install a fresh assembly: document, report, run, revision, diagnostics — the forge tier honestly emptied."""
        forge = project.forge
        assert forge is not None
        project.adventure = adventure
        forge.report = report
        forge.run = read_run_meta(forge.workdir)
        forge.checked = False
        project.revision_number += 1
        project.diagnostics = compute_diagnostics(adventure).model_copy(
            update={"forge": forge_findings(report.findings)}
        )

    def undo(self, project: OpenProject) -> OpBatchResult:
        """Revert the latest commit.

        Deliberately revision-free: the stack belongs to the shared project, so
        a second tab's undo legitimately reverts the first tab's latest commit —
        one document, one history, like two windows onto one desktop app. The
        result still bumps the revision, so the other tab's next batch is a 409
        and it resyncs.

        Forge-backed undo restores the snapshot pair — the `overrides.yaml`
        bytes and `auto_reasons` together — and re-assembles; assembly is pure
        and deterministic, so the restored document is exact.

        Args:
            project: The open project.

        Returns:
            The result, carrying the degenerate whole-document delta.

        Raises:
            UndoStackEmptyError: If there is nothing to undo.
        """
        with project.lock:
            if not project.undo_stack:
                raise UndoStackEmptyError("there is nothing to undo")
            entry = project.undo_stack[-1]
            if entry.forge_snapshot is not None:
                current = HistoryEntry(forge_snapshot=(_forge_bytes(project), project.sidecar.auto_reasons))
                self._restore_forge_snapshot(project, entry)
                project.undo_stack.pop()
                project.redo_stack.append(current)
                return self._result(project, _whole_document_delta(project.adventure))
            assert entry.document is not None
            previous = project.adventure
            self._commit(project, entry.document)
            self._remap_notes(project, [(new, old) for old, new in reversed(entry.note_remap)])
            project.undo_stack.pop()
            project.redo_stack.append(HistoryEntry(document=previous, note_remap=entry.note_remap))
            return self._result(project, _whole_document_delta(project.adventure))

    def redo(self, project: OpenProject) -> OpBatchResult:
        """Re-apply the latest undone commit.

        Args:
            project: The open project.

        Returns:
            The result, carrying the degenerate whole-document delta.

        Raises:
            RedoStackEmptyError: If there is nothing to redo.
        """
        with project.lock:
            if not project.redo_stack:
                raise RedoStackEmptyError("there is nothing to redo")
            entry = project.redo_stack[-1]
            if entry.forge_snapshot is not None:
                current = HistoryEntry(forge_snapshot=(_forge_bytes(project), project.sidecar.auto_reasons))
                self._restore_forge_snapshot(project, entry)
                project.redo_stack.pop()
                project.undo_stack.append(current)
                return self._result(project, _whole_document_delta(project.adventure))
            assert entry.document is not None
            previous = project.adventure
            self._commit(project, entry.document)
            self._remap_notes(project, list(entry.note_remap))
            project.redo_stack.pop()
            project.undo_stack.append(HistoryEntry(document=previous, note_remap=entry.note_remap))
            return self._result(project, _whole_document_delta(project.adventure))

    def apply_check(self, project: OpenProject) -> OpBatchResult:
        """Run forge's on-demand `check()` and refresh the forge tier.

        Not part of the per-commit loop: re-assembly wipes findings by forge's
        explicit design, the editor's own live lint already mirrors the five
        static checks per commit, and the delve is a deliberate, whole-dungeon
        act. The revision does not bump — the document is unchanged.

        Args:
            project: The open project (must be forge-backed; callers guard).

        Returns:
            The envelope with the refreshed forge tier and `checked` state.
        """
        with project.lock:
            forge = project.forge
            assert forge is not None
            findings = check_workdir(forge.workdir)
            # check() rewrote report.json with exactly this merge — mirror it
            # in memory rather than re-reading forge's own write.
            forge.report = forge.report.model_copy(update={"findings": findings})
            forge.checked = True
            project.diagnostics = project.diagnostics.model_copy(update={"forge": forge_findings(findings)})
            return self._result(project, ())

    def apply_rerun(self, project: OpenProject, settings_updates: Mapping[str, object] | None) -> OpBatchResult:
        """Re-run the assemble stage, optionally updating assembly-owned knobs.

        Not an undo step: the snapshot stack captures `overrides.yaml` and the
        reason ledger, and a knob change lives in `run.json`'s settings echo —
        pipeline state, not correction history. The revision bumps because the
        document may change.

        Args:
            project: The open project (must be forge-backed; callers guard).
            settings_updates: Knob updates, or `None`/empty for a plain
                re-assembly.

        Returns:
            The envelope with the whole-document delta and refreshed forge
            state.
        """
        with project.lock:
            forge = project.forge
            assert forge is not None
            result = rerun_assemble(forge.workdir, settings_updates if settings_updates else None)
            self._adopt_assembly(project, result.adventure, result.report)
            return self._result(project, _whole_document_delta(project.adventure))

    def _restore_forge_snapshot(self, project: OpenProject, entry: HistoryEntry) -> None:
        """Write a snapshot pair back and re-assemble; restore the current pair on failure."""
        forge = project.forge
        assert forge is not None
        current_bytes, current_auto = _forge_bytes(project), project.sidecar.auto_reasons
        overrides_bytes, auto_reasons = _snapshot_pair(entry)
        self._write_forge_state(project, overrides_bytes, auto_reasons)
        try:
            result = assemble_workdir(forge.workdir)
        except Exception:
            self._write_forge_state(project, current_bytes, current_auto)
            raise
        self._adopt_assembly(project, result.adventure, result.report)
        forge.overrides = read_overrides_value(forge.workdir)

    def _remap_notes(self, project: OpenProject, rules: Sequence[tuple[str, str]]) -> tuple[tuple[str, str], ...]:
        """Apply note key-remap rules to the live notes map, persisting when anything moved.

        Each rule is an address-prefix pair; a note key matches when it equals
        the old prefix or continues it with a `/` segment. Returns the actual
        `(old key, new key)` pairs applied — the entry undo replays. A rule
        landing on a key where a dormant note sits overwrites it: the live
        entity's note wins, pinned as acceptable.
        """
        if not rules or not project.sidecar.notes:
            return ()
        notes = dict(project.sidecar.notes)
        applied: list[tuple[str, str]] = []
        for old_prefix, new_prefix in rules:
            moved: dict[str, str] = {}
            for key in list(notes):
                if key == old_prefix or key.startswith(f"{old_prefix}/"):
                    moved[key] = f"{new_prefix}{key[len(old_prefix) :]}"
            for old_key, new_key in moved.items():
                notes[new_key] = notes.pop(old_key)
                applied.append((old_key, new_key))
        if not applied:
            return ()
        project.sidecar = project.sidecar.model_copy(update={"notes": notes})
        self.persist_sidecar(project)
        return tuple(applied)

    def apply_sidecar_patch(self, project: OpenProject, patches: tuple[AnySidecarPatch, ...]) -> EditorSidecar:
        """Apply typed sidecar patches and save atomically, answering the new state.

        Deliberately not revision-guarded: annotation state, single-user,
        last-write-wins — the document's 409 discipline exists to prevent
        silent *content* destruction, which annotations are not.

        Args:
            project: The open project.
            patches: The patches, in order.

        Returns:
            The new sidecar.
        """
        with project.lock:
            project.sidecar = apply_sidecar_patches(project.sidecar, patches)
            self.persist_sidecar(project)
            return project.sidecar

    def persist_sidecar(self, project: OpenProject) -> None:
        """Write the project's sidecar — the first sidecar-bearing write creates the file.

        Args:
            project: The open project whose sidecar changed.
        """
        self.store.write_artifact(
            str(project.path),
            SIDECAR_ARTIFACT,
            canonical_json_bytes(project.sidecar.model_dump(mode="json")),
        )

    def _commit(self, project: OpenProject, document: Adventure) -> None:
        """Persist a document, then install it: revision bump, diagnostics refresh.

        Always-saved: every commit, undo, and redo rewrites `adventure.json`
        through the store atomically. The write comes first, so a failed write
        (disk full) raises with the in-memory document, revision, and — because
        callers mutate them only after this returns — the history stacks all
        exactly as they were. Native only: a forge project's persistence path
        is the commit protocol, and the editor never writes a workdir's
        `adventure.json`.
        """
        self.store.write_artifact(str(project.path), ADVENTURE_ARTIFACT, dump_adventure(document))
        project.adventure = document
        project.revision_number += 1
        project.diagnostics = compute_diagnostics(document)

    def _result(self, project: OpenProject, delta: tuple[SubtreeChange, ...]) -> OpBatchResult:
        return OpBatchResult(
            revision=project.revision,
            diagnostics=project.diagnostics,
            delta=delta,
            can_undo=bool(project.undo_stack),
            can_redo=bool(project.redo_stack),
            forge=forge_state_model(project),
            sidecar=project.sidecar,
        )


def forge_state_model(project: OpenProject) -> ForgeState | None:
    """Build the API-surface forge state from a project's working state.

    Args:
        project: The open project.

    Returns:
        The forge state, or `None` for native projects.
    """
    if project.forge is None:
        return None
    return ForgeState(
        report=project.forge.report,
        run=project.forge.run,
        overrides=project.forge.overrides,
        checked=project.forge.checked,
    )


def _forge_bytes(project: OpenProject) -> bytes:
    forge = project.forge
    assert forge is not None
    return forge.overrides_bytes


def _snapshot_pair(entry: HistoryEntry) -> tuple[bytes, tuple[str, ...]]:
    assert entry.forge_snapshot is not None
    return entry.forge_snapshot


def _note_remap_rules(op: AnyEditOp) -> list[tuple[str, str]]:
    """The address-prefix remaps a re-keying op implies for the notes map.

    The three re-keying ops are all native-mode ops (forge blocks every one),
    so the cascade never coincides with a forge commit.
    """
    if isinstance(op, RenameDungeon):
        return [(dungeon_address(op.old_id), dungeon_address(op.new_id))]
    if isinstance(op, RenumberLevel):
        return [
            (level_address(op.dungeon_id, op.old_number), level_address(op.dungeon_id, op.new_number)),
        ]
    if isinstance(op, SetAreaField) and op.field == "id":
        return [
            (
                area_address(op.dungeon_id, op.level_number, op.area_id),
                area_address(op.dungeon_id, op.level_number, op.value),
            )
        ]
    return []


def _apply_op(adventure: Adventure, op: AnyEditOp, forge_mode: bool = False) -> tuple[Adventure, str]:
    """Apply one op to a candidate document, returning it and the touched subtree root.

    The rebuild is bottom-up nested `model_copy(update=...)` — the idiom
    osrlib's own tests use pervasively. It bypasses validators, which is why
    the batch round-trip re-validation in `apply_batch` is mandatory.

    `forge_mode` is the pinned growth-rule substitution: a forge level's
    dimensions are the derived bounding box forge recomputes and `ResizeLevel`
    is blocked, so the geometry ops' in-bounds invariants become *nonnegative*
    invariants — forge's own guard, and the only one it has. The candidate
    legally carries cells beyond its stale `width`/`height` for the instant
    before the assembled document's recomputed bounding box is adopted
    (out-of-bounds cells are validation findings, not model errors). Forge
    mode also tolerates an edge delete naming no entry — an absent entry is
    already the wall the gesture wants — where native mode rejects it.
    """
    if isinstance(op, SetAdventureField):
        return adventure.model_copy(update={op.field: op.value}), json_pointer([op.field])
    if isinstance(op, SetTownField):
        town = adventure.town.model_copy(update={op.field: op.value})
        return adventure.model_copy(update={"town": town}), "/town"
    if isinstance(op, SetWandering):
        return _apply_level_field(adventure, op, "wandering", op.wandering)
    if isinstance(op, SetEdges):
        return _apply_set_edges(adventure, op, forge_mode)
    if isinstance(op, SetEntrance):
        return _apply_set_entrance(adventure, op, forge_mode)
    if isinstance(op, CreateArea):
        return _apply_create_area(adventure, op, forge_mode)
    if isinstance(op, SetAreaCells):
        return _apply_set_area_cells(adventure, op, forge_mode)
    if isinstance(op, SetAreaField):
        return _apply_set_area_field(adventure, op)
    if isinstance(op, RemoveArea):
        return _apply_remove_area(adventure, op)
    if isinstance(op, SetEncounter):
        return _apply_set_area_content(adventure, op, "encounter", op.encounter)
    if isinstance(op, SetTrap):
        return _apply_set_area_content(adventure, op, "trap", op.trap)
    if isinstance(op, SetTreasure):
        return _apply_set_area_content(adventure, op, "treasure", op.treasure)
    if isinstance(op, AddFeature):
        return _apply_add_feature(adventure, op)
    if isinstance(op, SetFeature):
        return _apply_set_feature(adventure, op)
    if isinstance(op, RemoveFeature):
        return _apply_remove_feature(adventure, op)
    if isinstance(op, AddTransition):
        return _apply_add_transition(adventure, op, forge_mode)
    if isinstance(op, RemoveTransition):
        return _apply_remove_transition(adventure, op)
    if isinstance(op, AddDungeon):
        return _apply_add_dungeon(adventure, op)
    if isinstance(op, SetDungeonField):
        return _apply_set_dungeon_field(adventure, op)
    if isinstance(op, RenameDungeon):
        return _apply_rename_dungeon(adventure, op)
    if isinstance(op, RemoveDungeon):
        return _apply_remove_dungeon(adventure, op)
    if isinstance(op, AddLevel):
        return _apply_add_level(adventure, op)
    if isinstance(op, RenumberLevel):
        return _apply_renumber_level(adventure, op)
    if isinstance(op, ResizeLevel):
        return _apply_resize_level(adventure, op)
    return _apply_remove_level(adventure, op)


def _resolve_dungeon(adventure: Adventure, dungeon_id: str) -> int:
    """Return the index of the dungeon with `dungeon_id`, or raise the targeting miss."""
    for index, dungeon in enumerate(adventure.dungeons):
        if dungeon.id == dungeon_id:
            return index
    raise OpTargetNotFoundError(f"the document has no dungeon {dungeon_id!r}")


def _resolve_level(adventure: Adventure, dungeon_id: str, level_number: int) -> tuple[int, int]:
    """Return `(dungeon index, level index)` for a level target, or raise the targeting miss."""
    dungeon_index = _resolve_dungeon(adventure, dungeon_id)
    for level_index, level in enumerate(adventure.dungeons[dungeon_index].levels):
        if level.number == level_number:
            return dungeon_index, level_index
    raise OpTargetNotFoundError(f"dungeon {dungeon_id!r} has no level {level_number}")


def _resolve_area(level: LevelSpec, dungeon_id: str, area_id: str) -> int:
    """Return the index of the first area with `area_id` (osrlib's own first-match order)."""
    for index, area in enumerate(level.areas):
        if area.id == area_id:
            return index
    raise OpTargetNotFoundError(f"dungeon {dungeon_id!r} level {level.number} has no area {area_id!r}")


def _replace_dungeon(adventure: Adventure, dungeon_index: int, dungeon: DungeonSpec) -> Adventure:
    """Rebuild the adventure with one dungeon replaced."""
    dungeons = (*adventure.dungeons[:dungeon_index], dungeon, *adventure.dungeons[dungeon_index + 1 :])
    return adventure.model_copy(update={"dungeons": dungeons})


def _replace_level(adventure: Adventure, dungeon_index: int, level_index: int, level: LevelSpec) -> Adventure:
    """Rebuild the adventure with one level replaced inside its dungeon."""
    dungeon = adventure.dungeons[dungeon_index]
    levels = (*dungeon.levels[:level_index], level, *dungeon.levels[level_index + 1 :])
    return _replace_dungeon(adventure, dungeon_index, dungeon.model_copy(update={"levels": levels}))


def _apply_level_field(
    adventure: Adventure, op: SetWandering | SetEntrance, field: str, value: object
) -> tuple[Adventure, str]:
    """Replace one level field, answering the precise level-scoped pointer."""
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    new_level = level.model_copy(update={field: value})
    pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/{field}"
    return _replace_level(adventure, dungeon_index, level_index, new_level), pointer


_CANONICAL_EDGE_KEY = re.compile(r"^(0|[1-9][0-9]*),(0|[1-9][0-9]*):(north|west)$")
"""The canonical edge-key grammar: north/west side only, non-negative, no leading zeros.

Forge's aliasing guard, tightened to the canonical sides because the editor
authors storage form, not override input — osrlib consults only this form and
renders any other entry as wall without consulting it.
"""


def canonical_edge_cells(key: str) -> tuple[Position, Position] | None:
    """Return a canonical edge key's two incident cells, or `None` for any other string.

    The incident cells are the key's own cell and its north or west neighbour —
    the two cells osrlib's `LevelSpec.edge` joins through this entry.
    """
    match = _CANONICAL_EDGE_KEY.match(key)
    if match is None:
        return None
    x, y = int(match.group(1)), int(match.group(2))
    neighbour = (x, y - 1) if match.group(3) == "north" else (x - 1, y)
    return (x, y), neighbour


def _require_cells_in_bounds(level: LevelSpec, cells: Sequence[Position], forge_mode: bool = False) -> None:
    """The bounds invariant, or under the growth rule its forge-mode substitution.

    Forge-mode geometry admits growth beyond the current extent: dimensions
    are the bounding box forge recomputes over area and corridor cells, so the
    only invariant left is forge's own — nonnegative coordinates.
    """
    if forge_mode:
        for x, y in cells:
            if x < 0 or y < 0:
                raise OpInvariantError(f"cell ({x}, {y}) has a negative coordinate — osrlib grids start at (0, 0)")
        return
    for cell in cells:
        if not level.in_bounds(cell):
            raise OpInvariantError(f"cell {cell} is out of bounds for the {level.width}x{level.height} grid")


def _apply_set_edges(adventure: Adventure, op: SetEdges, forge_mode: bool = False) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    edges = dict(level.edges)
    for key, value in op.edges.items():
        if value is None:
            # Deletion authors no key, so any existing entry — the malformed
            # and non-canonical keys a foreign document legally carries
            # included — stays deletable without weakening the write rule. In
            # forge mode a delete naming no entry is a no-op instead: an
            # absent entry is already the wall the gesture wants, and the
            # translator's semantic diff emits nothing for it.
            if key not in edges:
                if forge_mode:
                    continue
                raise OpInvariantError(f"edge delete names no existing entry {key!r}")
            del edges[key]
            continue
        cells = canonical_edge_cells(key)
        if cells is None:
            raise OpInvariantError(
                f"edge key {key!r} is not canonical — the editor authors only 'x,y:north' and 'x,y:west' keys"
            )
        if forge_mode:
            _require_cells_in_bounds(level, cells, forge_mode=True)
        else:
            for cell in cells:
                if not level.in_bounds(cell):
                    raise OpInvariantError(f"edge key {key!r} references the out-of-bounds cell {cell}")
        if value.kind is EdgeKind.WALL:
            raise OpInvariantError(
                f"edge key {key!r} assigns an explicit wall — delete the entry instead; an absent edge is a wall"
            )
        edges[key] = value
    new_level = level.model_copy(update={"edges": edges})
    pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/edges"
    return _replace_level(adventure, dungeon_index, level_index, new_level), pointer


def _apply_set_entrance(adventure: Adventure, op: SetEntrance, forge_mode: bool = False) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    if op.entrance is not None:
        _require_cells_in_bounds(level, (op.entrance,), forge_mode)
    return _apply_level_field(adventure, op, "entrance", op.entrance)


def _apply_create_area(adventure: Adventure, op: CreateArea, forge_mode: bool = False) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    if not op.area_id:
        raise OpInvariantError("area id must be non-empty")
    if forge_mode and "/" in op.area_id:
        # The address grammar's one reserved character: forge keys area
        # entries by <dungeon>/<level>/<key>, so a slash would break the key.
        raise OpInvariantError(f"area id {op.area_id!r} contains '/' — not addressable in a forge-backed project")
    if any(area.id == op.area_id for area in level.areas):
        raise OpInvariantError(f"dungeon {op.dungeon_id!r} level {op.level_number} already has an area {op.area_id!r}")
    _require_cells_in_bounds(level, op.cells, forge_mode)
    area = AreaSpec(id=op.area_id, name=op.name, description=op.description, cells=op.cells)
    new_level = level.model_copy(update={"areas": (*level.areas, area)})
    pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/areas"
    return _replace_level(adventure, dungeon_index, level_index, new_level), pointer


def _replace_area(
    adventure: Adventure, dungeon_index: int, level_index: int, area_index: int, area: AreaSpec | None
) -> tuple[Adventure, str]:
    """Replace (or with `None`, remove) one area, answering the areas pointer."""
    level = adventure.dungeons[dungeon_index].levels[level_index]
    rest = level.areas[area_index + 1 :]
    areas = (*level.areas[:area_index], area, *rest) if area is not None else (*level.areas[:area_index], *rest)
    new_level = level.model_copy(update={"areas": areas})
    pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/areas"
    return _replace_level(adventure, dungeon_index, level_index, new_level), pointer


def _apply_set_area_cells(adventure: Adventure, op: SetAreaCells, forge_mode: bool = False) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    area_index = _resolve_area(level, op.dungeon_id, op.area_id)
    _require_cells_in_bounds(level, op.cells, forge_mode)
    area = level.areas[area_index].model_copy(update={"cells": op.cells})
    return _replace_area(adventure, dungeon_index, level_index, area_index, area)


def _apply_set_area_field(adventure: Adventure, op: SetAreaField) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    area_index = _resolve_area(level, op.dungeon_id, op.area_id)
    if op.field == "id":
        if not op.value:
            raise OpInvariantError("area id must be non-empty")
        if any(other.id == op.value for index, other in enumerate(level.areas) if index != area_index):
            raise OpInvariantError(
                f"dungeon {op.dungeon_id!r} level {op.level_number} already has an area {op.value!r}"
            )
    area = level.areas[area_index].model_copy(update={op.field: op.value})
    return _replace_area(adventure, dungeon_index, level_index, area_index, area)


def _apply_remove_area(adventure: Adventure, op: RemoveArea) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    area_index = _resolve_area(level, op.dungeon_id, op.area_id)
    return _replace_area(adventure, dungeon_index, level_index, area_index, None)


_RESERVED_FEATURE_ID = "pile"
"""The runtime's drop-pile convention: `TakeTreasure(feature_id="pile")` targets the cell's pile."""


def _apply_set_area_content(
    adventure: Adventure, op: SetEncounter | SetTrap | SetTreasure, field: str, value: object
) -> tuple[Adventure, str]:
    """Replace one area content field, answering the indexed area pointer.

    The indexed pointer (`/areas/<k>`) is deliberately finer than the `/areas`
    the phase 2 area ops answer — a pointer choice per op, not a helper change.
    """
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    area_index = _resolve_area(level, op.dungeon_id, op.area_id)
    area = level.areas[area_index].model_copy(update={field: value})
    new_adventure, _ = _replace_area(adventure, dungeon_index, level_index, area_index, area)
    return new_adventure, f"/dungeons/{dungeon_index}/levels/{level_index}/areas/{area_index}"


def _level_feature_ids(level: LevelSpec) -> list[str]:
    """Collect every feature id on a level — its own and every area's.

    `validate_adventure`'s uniqueness scope spans exactly this union, so the
    duplicate-id invariant checks against it.
    """
    ids = [feature.id for feature in level.features]
    for area in level.areas:
        ids.extend(feature.id for feature in area.features)
    return ids


def _require_feature_id_free(level: LevelSpec, dungeon_id: str, feature_id: str) -> None:
    """Reject an empty, reserved, or already-used feature id (the `AddFeature` id rules)."""
    if not feature_id:
        raise OpInvariantError("feature id must be non-empty")
    if feature_id == _RESERVED_FEATURE_ID:
        raise OpInvariantError("feature id 'pile' is reserved for drop piles")
    if feature_id in _level_feature_ids(level):
        raise OpInvariantError(f"dungeon {dungeon_id!r} level {level.number} already has a feature {feature_id!r}")


def _resolve_feature(features: Sequence[FeatureSpec], container: str, feature_id: str) -> int:
    """Return the index of the first feature with `feature_id` (osrlib's first-match order)."""
    for index, feature in enumerate(features):
        if feature.id == feature_id:
            return index
    raise OpTargetNotFoundError(f"{container} has no feature {feature_id!r}")


def _feature_container(
    adventure: Adventure, op: AddFeature | SetFeature | RemoveFeature
) -> tuple[int, int, int | None, tuple[FeatureSpec, ...], str]:
    """Resolve a feature op's container: indices, the container's features, and its name.

    Returns `(dungeon index, level index, area index or None, features, container name)`;
    an unknown level or area is a targeting miss.
    """
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    if op.area_id is None:
        return dungeon_index, level_index, None, level.features, f"dungeon {op.dungeon_id!r} level {op.level_number}"
    area_index = _resolve_area(level, op.dungeon_id, op.area_id)
    container = f"dungeon {op.dungeon_id!r} level {op.level_number} area {op.area_id!r}"
    return dungeon_index, level_index, area_index, level.areas[area_index].features, container


def _replace_container_features(
    adventure: Adventure,
    dungeon_index: int,
    level_index: int,
    area_index: int | None,
    features: tuple[FeatureSpec, ...],
) -> tuple[Adventure, str]:
    """Install a container's rebuilt features tuple, answering the container's pointer."""
    level = adventure.dungeons[dungeon_index].levels[level_index]
    if area_index is None:
        new_level = level.model_copy(update={"features": features})
        pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/features"
        return _replace_level(adventure, dungeon_index, level_index, new_level), pointer
    area = level.areas[area_index].model_copy(update={"features": features})
    new_adventure, _ = _replace_area(adventure, dungeon_index, level_index, area_index, area)
    return new_adventure, f"/dungeons/{dungeon_index}/levels/{level_index}/areas/{area_index}"


def _apply_add_feature(adventure: Adventure, op: AddFeature) -> tuple[Adventure, str]:
    dungeon_index, level_index, area_index, features, _ = _feature_container(adventure, op)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    _require_feature_id_free(level, op.dungeon_id, op.feature.id)
    if op.feature.cell is not None:
        _require_cells_in_bounds(level, (op.feature.cell,))
    return _replace_container_features(adventure, dungeon_index, level_index, area_index, (*features, op.feature))


def _apply_set_feature(adventure: Adventure, op: SetFeature) -> tuple[Adventure, str]:
    dungeon_index, level_index, area_index, features, container = _feature_container(adventure, op)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    feature_index = _resolve_feature(features, container, op.feature_id)
    current = features[feature_index]
    if op.feature.id != current.id:
        # A rename, under AddFeature's id rules; an unchanged id — reserved or
        # not — carries through, so a foreign 'pile' feature stays editable and
        # its finding stays navigable.
        _require_feature_id_free(level, op.dungeon_id, op.feature.id)
    if op.feature.cell is not None and op.feature.cell != current.cell:
        # The invariant guards *changed* cells only: an unchanged foreign
        # out-of-bounds cell passes through, so the feature never locks.
        _require_cells_in_bounds(level, (op.feature.cell,))
    features = (*features[:feature_index], op.feature, *features[feature_index + 1 :])
    return _replace_container_features(adventure, dungeon_index, level_index, area_index, features)


def _apply_remove_feature(adventure: Adventure, op: RemoveFeature) -> tuple[Adventure, str]:
    dungeon_index, level_index, area_index, features, container = _feature_container(adventure, op)
    feature_index = _resolve_feature(features, container, op.feature_id)
    features = (*features[:feature_index], *features[feature_index + 1 :])
    return _replace_container_features(adventure, dungeon_index, level_index, area_index, features)


def _apply_add_transition(adventure: Adventure, op: AddTransition, forge_mode: bool = False) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    transition = op.transition
    if forge_mode:
        _require_cells_in_bounds(level, (transition.position,), forge_mode=True)
    elif not level.in_bounds(transition.position):
        raise OpInvariantError(
            f"transition source {transition.position} is out of bounds for the {level.width}x{level.height} grid"
        )
    if level.transition_at(transition.position) is not None:
        raise OpInvariantError(
            f"cell {transition.position} already has a transition — osrlib resolves the first match, "
            "so a second entry would be dead data"
        )
    new_level = level.model_copy(update={"transitions": (*level.transitions, transition)})
    pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/transitions"
    return _replace_level(adventure, dungeon_index, level_index, new_level), pointer


def _apply_remove_transition(adventure: Adventure, op: RemoveTransition) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]
    for index, transition in enumerate(level.transitions):
        if transition.position == op.position:
            transitions = (*level.transitions[:index], *level.transitions[index + 1 :])
            new_level = level.model_copy(update={"transitions": transitions})
            pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/transitions"
            return _replace_level(adventure, dungeon_index, level_index, new_level), pointer
    raise OpTargetNotFoundError(f"dungeon {op.dungeon_id!r} level {op.level_number} has no transition at {op.position}")


def _apply_add_dungeon(adventure: Adventure, op: AddDungeon) -> tuple[Adventure, str]:
    if any(dungeon.id == op.dungeon_id for dungeon in adventure.dungeons):
        raise OpInvariantError(f"a dungeon {op.dungeon_id!r} already exists")
    dungeon = DungeonSpec(
        id=op.dungeon_id,
        name=op.name,
        levels=(LevelSpec(number=1, width=op.width, height=op.height, entrance=(0, 0)),),
    )
    return adventure.model_copy(update={"dungeons": (*adventure.dungeons, dungeon)}), "/dungeons"


def _apply_set_dungeon_field(adventure: Adventure, op: SetDungeonField) -> tuple[Adventure, str]:
    dungeon_index = _resolve_dungeon(adventure, op.dungeon_id)
    dungeon = adventure.dungeons[dungeon_index].model_copy(update={op.field: op.value})
    return _replace_dungeon(adventure, dungeon_index, dungeon), f"/dungeons/{dungeon_index}/{op.field}"


def _retarget_transitions(
    dungeon: DungeonSpec, matches: Callable[[TransitionSpec], bool], update: Mapping[str, object]
) -> DungeonSpec:
    """Rebuild a dungeon with every matching transition patched; the original when nothing matches.

    Returning the original object on a miss lets cascade callers detect by
    identity which dungeons a rename or renumber actually touched.
    """
    changed = False
    levels: list[LevelSpec] = []
    for level in dungeon.levels:
        if any(matches(transition) for transition in level.transitions):
            transitions = tuple(
                transition.model_copy(update=dict(update)) if matches(transition) else transition
                for transition in level.transitions
            )
            levels.append(level.model_copy(update={"transitions": transitions}))
            changed = True
        else:
            levels.append(level)
    if not changed:
        return dungeon
    return dungeon.model_copy(update={"levels": tuple(levels)})


def _apply_rename_dungeon(adventure: Adventure, op: RenameDungeon) -> tuple[Adventure, str]:
    dungeon_index = _resolve_dungeon(adventure, op.old_id)
    if not op.new_id:
        raise OpInvariantError("dungeon id must be non-empty")
    if any(dungeon.id == op.new_id for dungeon in adventure.dungeons):
        raise OpInvariantError(f"a dungeon {op.new_id!r} already exists")
    dungeons: list[DungeonSpec] = []
    for index, dungeon in enumerate(adventure.dungeons):
        retargeted = _retarget_transitions(
            dungeon, lambda t: t.to_dungeon_id == op.old_id, {"to_dungeon_id": op.new_id}
        )
        if index == dungeon_index:
            retargeted = retargeted.model_copy(update={"id": op.new_id})
        dungeons.append(retargeted)
    town = adventure.town
    if op.old_id in town.travel_turns:
        # The key renames in place, order preserved. A dangling entry already
        # named new_id (referencing no dungeon until now) is dropped — one
        # dungeon, one entry, the renamed key's authored cost wins.
        travel = {
            (op.new_id if key == op.old_id else key): turns
            for key, turns in town.travel_turns.items()
            if key != op.new_id
        }
        town = town.model_copy(update={"travel_turns": travel})
    # The cascade may touch the town and any dungeon's transitions — the delta
    # is honestly whole-document.
    return adventure.model_copy(update={"dungeons": tuple(dungeons), "town": town}), ""


def _apply_remove_dungeon(adventure: Adventure, op: RemoveDungeon) -> tuple[Adventure, str]:
    dungeon_index = _resolve_dungeon(adventure, op.dungeon_id)
    if len(adventure.dungeons) == 1:
        raise OpInvariantError("the last dungeon cannot be removed — an adventure needs at least one")
    dungeons = (*adventure.dungeons[:dungeon_index], *adventure.dungeons[dungeon_index + 1 :])
    return adventure.model_copy(update={"dungeons": dungeons}), "/dungeons"


def _apply_add_level(adventure: Adventure, op: AddLevel) -> tuple[Adventure, str]:
    dungeon_index = _resolve_dungeon(adventure, op.dungeon_id)
    dungeon = adventure.dungeons[dungeon_index]
    if any(level.number == op.number for level in dungeon.levels):
        raise OpInvariantError(f"dungeon {op.dungeon_id!r} already has a level {op.number}")
    new_level = LevelSpec(number=op.number, width=op.width, height=op.height)
    # Inserted before the first level whose number exceeds it, appended when
    # none does — deterministic over any tuple, ascending-preserving over an
    # ascending one, and never a reorder of existing levels (stored order is
    # rules-visible through the first-entrance-bearing-level rule).
    insert_at = next(
        (index for index, level in enumerate(dungeon.levels) if level.number > op.number), len(dungeon.levels)
    )
    levels = (*dungeon.levels[:insert_at], new_level, *dungeon.levels[insert_at:])
    new_dungeon = dungeon.model_copy(update={"levels": levels})
    return _replace_dungeon(adventure, dungeon_index, new_dungeon), f"/dungeons/{dungeon_index}"


def _apply_renumber_level(adventure: Adventure, op: RenumberLevel) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.old_number)
    dungeon = adventure.dungeons[dungeon_index]
    if any(level.number == op.new_number for level in dungeon.levels):
        raise OpInvariantError(f"dungeon {op.dungeon_id!r} already has a level {op.new_number}")
    renumbered = dungeon.levels[level_index].model_copy(update={"number": op.new_number})
    adventure = _replace_level(adventure, dungeon_index, level_index, renumbered)
    dungeons: list[DungeonSpec] = []
    touched_outside = False
    for index, candidate in enumerate(adventure.dungeons):
        retargeted = _retarget_transitions(
            candidate,
            lambda t: t.to_dungeon_id == op.dungeon_id and t.to_level_number == op.old_number,
            {"to_level_number": op.new_number},
        )
        if retargeted is not candidate and index != dungeon_index:
            touched_outside = True
        dungeons.append(retargeted)
    # The precise pointer holds while the cascade stays inside this dungeon; a
    # cross-dungeon stairs retarget widens it honestly to the whole document.
    pointer = "" if touched_outside else f"/dungeons/{dungeon_index}"
    return adventure.model_copy(update={"dungeons": tuple(dungeons)}), pointer


def _apply_resize_level(adventure: Adventure, op: ResizeLevel) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    level = adventure.dungeons[dungeon_index].levels[level_index]

    def in_new(cell: Position) -> bool:
        return 0 <= cell[0] < op.width and 0 <= cell[1] < op.height

    offenders: list[dict[str, str]] = []
    for area in level.areas:
        outside = [cell for cell in area.cells if not in_new(cell)]
        if outside:
            offenders.append(
                {
                    "address": area_address(op.dungeon_id, op.level_number, area.id),
                    "message": f"area {area.id!r} has {len(outside)} cell(s) outside the new bounds, e.g. {outside[0]}",
                }
            )
        for feature in area.features:
            if feature.cell is not None and not in_new(feature.cell):
                offenders.append(_feature_offender(op, feature.id, feature.cell))
    for feature in level.features:
        if feature.cell is not None and not in_new(feature.cell):
            offenders.append(_feature_offender(op, feature.id, feature.cell))
    for transition in level.transitions:
        if not in_new(transition.position):
            offenders.append(
                {
                    "address": cell_address(op.dungeon_id, op.level_number, transition.position),
                    "message": f"{transition.kind} at {transition.position} is outside the new bounds",
                }
            )
    if level.entrance is not None and not in_new(level.entrance):
        offenders.append(
            {
                "address": cell_address(op.dungeon_id, op.level_number, level.entrance),
                "message": f"the entrance at {level.entrance} is outside the new bounds",
            }
        )
    if offenders:
        raise OpInvariantError(f"resizing to {op.width}x{op.height} would strand existing content", offenders=offenders)
    # Edge entries whose incident cells fall outside the new bounds are pruned:
    # edges are spatial annotation, not content — osrlib treats an out-of-bounds
    # entry as nonexistent, so keeping one would strand an invisible
    # edge_invalid error on a key the map cannot even display. Foreign
    # non-canonical keys have no computable cells and stay (still deletable,
    # still flagged by lint).
    edges = {
        key: edge
        for key, edge in level.edges.items()
        if (cells := canonical_edge_cells(key)) is None or all(in_new(cell) for cell in cells)
    }
    new_level = level.model_copy(update={"width": op.width, "height": op.height, "edges": edges})
    return _replace_level(adventure, dungeon_index, level_index, new_level), f"/dungeons/{dungeon_index}"


def _feature_offender(op: ResizeLevel, feature_id: str, cell: Position) -> dict[str, str]:
    return {
        "address": cell_address(op.dungeon_id, op.level_number, cell),
        "message": f"feature {feature_id!r} sits at {cell}, outside the new bounds",
    }


def _apply_remove_level(adventure: Adventure, op: RemoveLevel) -> tuple[Adventure, str]:
    dungeon_index, level_index = _resolve_level(adventure, op.dungeon_id, op.level_number)
    dungeon = adventure.dungeons[dungeon_index]
    if len(dungeon.levels) == 1:
        raise OpInvariantError(
            f"the last level of dungeon {op.dungeon_id!r} cannot be removed — a dungeon needs at least one"
        )
    levels = (*dungeon.levels[:level_index], *dungeon.levels[level_index + 1 :])
    new_dungeon = dungeon.model_copy(update={"levels": levels})
    return _replace_dungeon(adventure, dungeon_index, new_dungeon), f"/dungeons/{dungeon_index}"


def _coalesce_delta(payload: Mapping[str, object], touched: Sequence[str]) -> tuple[SubtreeChange, ...]:
    """Coalesce touched subtree roots: dedup, drop descendants, extract final values.

    Entries keep first-touched order; no surviving entry's path is a descendant
    of another's, so applying them in order is unambiguous.
    """
    unique: list[str] = []
    for path in touched:
        if path not in unique:
            unique.append(path)
    kept = [path for path in unique if not any(other != path and _is_ancestor(other, path) for other in unique)]
    return tuple(SubtreeChange(path=path, value=_resolve_pointer(payload, path)) for path in kept)


def _is_ancestor(ancestor: str, path: str) -> bool:
    return ancestor == "" or path.startswith(f"{ancestor}/")


def _whole_document_delta(adventure: Adventure) -> tuple[SubtreeChange, ...]:
    return (SubtreeChange(path="", value=adventure.model_dump(mode="json")),)
