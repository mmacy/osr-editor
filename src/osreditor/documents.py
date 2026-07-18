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
import secrets
import threading
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Literal, cast

from osrlib.crawl.adventure import Adventure
from osrlib.versioning import check_document, stamp_document
from pydantic import ValidationError

from osreditor.diagnostics import compute_diagnostics
from osreditor.errors import (
    OpRejectedError,
    OpTargetNotFoundError,
    ProjectNotFoundError,
    RedoStackEmptyError,
    StaleRevisionError,
    UndoStackEmptyError,
)
from osreditor.ops import (
    AnyEditOp,
    Diagnostics,
    OpBatch,
    OpBatchResult,
    SetAdventureField,
    SetTownField,
    SubtreeChange,
)
from osreditor.store import ProjectStore

__all__ = [
    "ADVENTURE_ARTIFACT",
    "DocumentService",
    "OpenProject",
    "ProjectType",
    "canonical_json_bytes",
    "dropped_pointers",
    "dump_adventure",
    "json_pointer",
    "load_adventure",
]

ADVENTURE_ARTIFACT = "adventure.json"
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
    if isinstance(source, Mapping) and isinstance(reserialized, Mapping):
        source_map = cast(Mapping[str, object], source)
        reserialized_map = cast(Mapping[str, object], reserialized)
        for key, value in source_map.items():
            pointer = f"{prefix}/{_escape_pointer_token(key)}"
            if key not in reserialized_map:
                dropped.append(pointer)
            else:
                dropped.extend(dropped_pointers(value, reserialized_map[key], pointer))
    elif (
        isinstance(source, Sequence)
        and not isinstance(source, str | bytes)
        and isinstance(reserialized, Sequence)
        and not isinstance(reserialized, str | bytes)
    ):
        source_seq = cast(Sequence[object], source)
        reserialized_seq = cast(Sequence[object], reserialized)
        for index, value in enumerate(source_seq):
            pointer = f"{prefix}/{index}"
            if index >= len(reserialized_seq):
                dropped.append(pointer)
            else:
                dropped.extend(dropped_pointers(value, reserialized_seq[index], pointer))
    return tuple(dropped)


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
    ) -> None:
        """Bundle a just-loaded project's working state.

        Args:
            project_id: The server-minted opaque id.
            path: The resolved project directory path.
            project_type: The detected project shape.
            adventure: The loaded document.
            dropped_fields: The open-time fidelity diff's pointers.
            diagnostics: The diagnostics computed at open.
        """
        self.id = project_id
        self.path = path
        self.type: ProjectType = project_type
        self.adventure = adventure
        self.dropped_fields = dropped_fields
        self.diagnostics = diagnostics
        self.revision_number = 1
        self.undo_stack: list[Adventure] = []
        self.redo_stack: list[Adventure] = []
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

    def get_or_open(
        self, path: Path, loader: Callable[[], tuple[Adventure, ProjectType, tuple[str, ...]]]
    ) -> OpenProject:
        """Return the already-open project for a resolved path, or admit a new one.

        The whole open — `loader` included — runs under the registry lock:
        single-user, milliseconds, simplicity wins. Two tabs opening one path
        get the *same* project and id, hence one document, one revision stream,
        one history.

        Args:
            path: The resolved project directory path (the registry index).
            loader: Classifies and loads the document; called only on a miss.
                Returns the adventure, the project type, and the fidelity diff's
                dropped-field pointers.

        Returns:
            The open project.
        """
        with self._registry_lock:
            existing = self._by_path.get(str(path))
            if existing is not None:
                return existing
            adventure, project_type, dropped = loader()
            project = OpenProject(
                project_id=secrets.token_hex(8),
                path=path,
                project_type=project_type,
                adventure=adventure,
                dropped_fields=dropped,
                diagnostics=compute_diagnostics(adventure),
            )
            self._by_id[project.id] = project
            self._by_path[str(path)] = project
            return project

    def apply_batch(self, project: OpenProject, batch: OpBatch) -> OpBatchResult:
        """Apply one batch atomically: all ops or none, one undo step, one revision.

        Args:
            project: The open project.
            batch: The ops and the revision they were computed against.

        Returns:
            The result: new revision, coalesced delta, refreshed diagnostics.

        Raises:
            StaleRevisionError: If the batch names any revision but the current one.
            OpTargetNotFoundError: If an op names a dungeon or level the document
                does not contain.
            OpRejectedError: If the batch would produce an invalid model — the
                round-trip re-validation is the single enforcement point, because
                `model_copy(update=...)` bypasses every validator in pydantic v2.
        """
        with project.lock:
            if batch.revision != project.revision:
                raise StaleRevisionError(
                    f"batch was computed against revision {batch.revision}, "
                    f"but the current revision is {project.revision}",
                    current_revision=project.revision,
                )
            candidate = project.adventure
            touched: list[str] = []
            for op in batch.ops:
                candidate, pointer = _apply_op(candidate, op)
                touched.append(pointer)
            try:
                validated = Adventure.model_validate(candidate.model_dump())
            except ValidationError as error:
                raise OpRejectedError(
                    "the batch would produce an invalid document and was rejected whole",
                    errors=[
                        {"path": json_pointer(detail["loc"]), "message": detail["msg"]} for detail in error.errors()
                    ],
                ) from error
            project.undo_stack.append(project.adventure)
            if len(project.undo_stack) > MAX_UNDO_DEPTH:
                project.undo_stack.pop(0)
            project.redo_stack.clear()
            self._commit(project, validated)
            payload = validated.model_dump(mode="json")
            delta = _coalesce_delta(payload, touched)
            return self._result(project, delta)

    def undo(self, project: OpenProject) -> OpBatchResult:
        """Revert the latest commit.

        Deliberately revision-free: the stack belongs to the shared project, so
        a second tab's undo legitimately reverts the first tab's latest commit —
        one document, one history, like two windows onto one desktop app. The
        result still bumps the revision, so the other tab's next batch is a 409
        and it resyncs.

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
            project.redo_stack.append(project.adventure)
            self._commit(project, project.undo_stack.pop())
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
            project.undo_stack.append(project.adventure)
            self._commit(project, project.redo_stack.pop())
            return self._result(project, _whole_document_delta(project.adventure))

    def _commit(self, project: OpenProject, document: Adventure) -> None:
        """Install a document: bump the revision, persist, recompute diagnostics.

        Always-saved: every commit, undo, and redo rewrites `adventure.json`
        through the store atomically. No dirty state, no save button.
        """
        project.adventure = document
        project.revision_number += 1
        self.store.write_artifact(str(project.path), ADVENTURE_ARTIFACT, dump_adventure(document))
        project.diagnostics = compute_diagnostics(document)

    def _result(self, project: OpenProject, delta: tuple[SubtreeChange, ...]) -> OpBatchResult:
        return OpBatchResult(
            revision=project.revision,
            diagnostics=project.diagnostics,
            delta=delta,
            can_undo=bool(project.undo_stack),
            can_redo=bool(project.redo_stack),
        )


def _apply_op(adventure: Adventure, op: AnyEditOp) -> tuple[Adventure, str]:
    """Apply one op to a candidate document, returning it and the touched subtree root.

    The rebuild is bottom-up nested `model_copy(update=...)` — the idiom
    osrlib's own tests use pervasively. It bypasses validators, which is why
    the batch round-trip re-validation in `apply_batch` is mandatory.
    """
    if isinstance(op, SetAdventureField):
        return adventure.model_copy(update={op.field: op.value}), json_pointer([op.field])
    if isinstance(op, SetTownField):
        town = adventure.town.model_copy(update={op.field: op.value})
        return adventure.model_copy(update={"town": town}), "/town"
    for dungeon_index, dungeon in enumerate(adventure.dungeons):
        if dungeon.id != op.dungeon_id:
            continue
        for level_index, level in enumerate(dungeon.levels):
            if level.number != op.level_number:
                continue
            new_level = level.model_copy(update={"wandering": op.wandering})
            new_dungeon = dungeon.model_copy(
                update={"levels": (*dungeon.levels[:level_index], new_level, *dungeon.levels[level_index + 1 :])}
            )
            new_dungeons = (*adventure.dungeons[:dungeon_index], new_dungeon, *adventure.dungeons[dungeon_index + 1 :])
            pointer = f"/dungeons/{dungeon_index}/levels/{level_index}/wandering"
            return adventure.model_copy(update={"dungeons": new_dungeons}), pointer
        raise OpTargetNotFoundError(f"dungeon {op.dungeon_id!r} has no level {op.level_number}")
    raise OpTargetNotFoundError(f"the document has no dungeon {op.dungeon_id!r}")


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
