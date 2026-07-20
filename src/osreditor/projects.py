"""Project-shape detection, native create, the editor sidecar, and open-by-path.

Detection classifies a directory by shape alone — presence, never loadability —
so a native-shaped directory whose document then fails to load surfaces the load
failure itself, not "not a project". The forge check runs first because a forge
workdir *also* contains an assembled `adventure.json` at its root; checking the
native shape first would silently misclassify every workdir. Detection reads
through the [`ProjectStore`][osreditor.store.ProjectStore], never `Path`
directly, which is why the forge predicate is phrased over artifact names — the
store lists files, and directories are layout, not artifacts.
"""

import json
from datetime import UTC, datetime
from importlib import metadata
from pathlib import Path

from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import DungeonSpec, LevelSpec
from osrlib.versioning import engine_version
from pydantic import ValidationError

from osreditor.documents import (
    ADVENTURE_ARTIFACT,
    DocumentService,
    ForgeProjectState,
    LoadedProject,
    OpenProject,
    ProjectType,
    canonical_json_bytes,
    dropped_pointers,
    dump_adventure,
    json_pointer,
    load_adventure,
)
from osreditor.errors import (
    DocumentPayloadInvalidError,
    InvalidProjectError,
    ProjectExistsError,
    ProjectPathNotFoundError,
)
from osreditor.forge import open_workdir_state
from osreditor.sidecar import SIDECAR_ARTIFACT, EditorSidecar, SidecarProvenance, load_sidecar
from osreditor.store import ProjectStore

__all__ = [
    "SIDECAR_ARTIFACT",
    "EditorSidecar",
    "SidecarProvenance",
    "create_native_project",
    "detect_project_type",
    "open_project",
    "starter_adventure",
    "utc_now_iso",
]

_MAX_REPORTED_LOCATIONS = 10


def utc_now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string.

    Returns:
        The timestamp, e.g. `2026-07-18T17:03:21.123456+00:00`.
    """
    return datetime.now(UTC).isoformat()


def detect_project_type(store: ProjectStore, project_id: str) -> ProjectType | None:
    """Classify a project directory by shape alone.

    Forge markers first — `run.json` plus at least one artifact under `stages/`
    — because a forge workdir also contains an assembled `adventure.json` at its
    root. A workdir with an *empty* `stages/` directory classifies as not a
    project, an unreachable state for any workdir forge has actually written
    into, because directories are layout, not artifacts.

    Args:
        store: The store to read through.
        project_id: The project to classify.

    Returns:
        `"forge"`, `"native"`, or `None` when the directory is not a project.
    """
    artifacts = store.list_artifacts(project_id)
    if "run.json" in artifacts and any(name.startswith("stages/") for name in artifacts):
        return "forge"
    if ADVENTURE_ARTIFACT in artifacts:
        return "native"
    return None


def starter_adventure(name: str) -> Adventure:
    """Build the starter document a new native project scaffolds.

    osrlib requires at least one dungeon with at least one level at
    construction, and `validate_adventure` requires an in-bounds entrance per
    dungeon — the default entrance makes a fresh project validate clean from
    birth, since phase 1 has no map tool to place one. 30x30 is a graph-paper
    page; the map editor resizes and re-places freely in phase 2.

    Args:
        name: The adventure name the user chose.

    Returns:
        The starter adventure.
    """
    return Adventure(
        name=name,
        description="",
        hooks=(),
        town=TownSpec(name=""),
        dungeons=(
            DungeonSpec(
                id="dungeon-1",
                name="",
                levels=(LevelSpec(number=1, width=30, height=30, entrance=(0, 0)),),
            ),
        ),
    )


def create_native_project(store: ProjectStore, project_id: str, name: str) -> Adventure:
    """Create a native project: the starter document plus the editor sidecar.

    Args:
        store: The store to write through.
        project_id: The absolute project directory path.
        name: The adventure name.

    Returns:
        The starter adventure just written.

    Raises:
        ProjectExistsError: If the directory exists and is not empty — refused
            before anything is written.
    """
    if store.project_exists(project_id) and store.list_artifacts(project_id):
        raise ProjectExistsError(f"directory {project_id} already exists and is not empty")
    adventure = starter_adventure(name)
    sidecar = EditorSidecar(
        provenance=SidecarProvenance(
            created_by=f"osr-editor {metadata.version('osr-editor')}",
            osrlib_version=engine_version(),
            created_at=utc_now_iso(),
        )
    )
    store.write_artifact(project_id, ADVENTURE_ARTIFACT, dump_adventure(adventure))
    store.write_artifact(project_id, SIDECAR_ARTIFACT, canonical_json_bytes(sidecar.model_dump(mode="json")))
    return adventure


def _load_native(store: ProjectStore, resolved: Path) -> LoadedProject:
    """Load a native project: the document, the fidelity diff, the sidecar."""
    store_key = str(resolved)
    data = store.read_artifact(store_key, ADVENTURE_ARTIFACT)
    try:
        adventure = load_adventure(data)
    except ValidationError as error:
        reported = [
            {"path": json_pointer(detail["loc"]), "message": detail["msg"]}
            for detail in error.errors()[:_MAX_REPORTED_LOCATIONS]
        ]
        raise DocumentPayloadInvalidError(
            f"the document at {resolved} does not match the installed osrlib's models", errors=reported
        ) from error
    source_payload = json.loads(data)["payload"]
    dropped = dropped_pointers(source_payload, adventure.model_dump(mode="json"))
    return LoadedProject(
        adventure=adventure,
        project_type="native",
        dropped_fields=dropped,
        sidecar=load_sidecar(store, store_key),
        forge=None,
    )


def _load_forge(store: ProjectStore, resolved: Path) -> LoadedProject:
    """Load a forge-backed project: materialize, gate, assemble.

    The open-time fidelity guard does not apply — the document arrives as
    forge's in-memory models, not a foreign parse, so `dropped_fields` is
    `()` for forge projects. The materialization happens once, here; the
    resulting local workdir path lives on the project state for every later
    forge operation (the seam rule: only the bridge touches it).
    """
    store_key = str(resolved)
    workdir = store.materialize(store_key)
    state = open_workdir_state(workdir)
    return LoadedProject(
        adventure=state.adventure,
        project_type="forge",
        dropped_fields=(),
        sidecar=load_sidecar(store, store_key),
        forge=ForgeProjectState(
            workdir=state.workdir,
            run=state.run,
            report=state.report,
            overrides=state.overrides,
            overrides_bytes=state.overrides_bytes,
        ),
    )


def open_project(service: DocumentService, path: Path) -> OpenProject:
    """Open a project by path: resolve, classify, load, register.

    The resolved path (symlinks and all) is both the registry index and the
    recents dedup key, so two routes to one directory share one
    [`OpenProject`][osreditor.documents.OpenProject] — one document, one
    revision stream, which is what makes the 409 contract meaningful.

    Opening a *native* project never writes: normalization of an older-engine
    document happens on the first committed op. Opening a *forge-backed*
    project re-assembles, and that writes — but the write is forge's own
    (stage tracking in `run.json`, byte-stable artifacts), never the editor's;
    the artifacts on disk may be stale against a hand-edited `overrides.yaml`,
    and forge pins "no automatic staleness detection", so rebuilding on open
    is the correctness-first posture.

    Args:
        service: The document service holding the open-project registry.
        path: The project directory, absolute.

    Returns:
        The open project — the same object for the same resolved path.

    Raises:
        ProjectPathNotFoundError: If the path names no directory.
        InvalidProjectError: If the directory matches neither project shape.
        ForgeWorkdirInvalidError: If a workdir's `run.json` does not parse, or
            assembly finds a missing or stale stage cache.
        ForgeWorkdirIncompleteError: If a workdir's conversion never
            completed; phase 6 turns this refusal into the pipeline view.
        ForgeOverrideInvalidError: If a workdir's `overrides.yaml` cannot load
            or an entry cannot take effect.
        osrlib.errors.SaveVersionError: If the document's schema is newer than
            the installed osrlib understands.
        osrlib.errors.ContentValidationError: If the document envelope is
            malformed.
        DocumentPayloadInvalidError: If the document payload (or the editor
            sidecar) fails model validation, with the offending locations
            attached.
    """
    resolved = path.resolve()

    def load() -> LoadedProject:
        store = service.store
        store_key = str(resolved)
        if not store.project_exists(store_key):
            raise ProjectPathNotFoundError(f"no directory at {resolved}")
        project_type = detect_project_type(store, store_key)
        if project_type is None:
            raise InvalidProjectError(f"{resolved} is not a project: no adventure.json and no forge workdir markers")
        if project_type == "forge":
            return _load_forge(store, resolved)
        return _load_native(store, resolved)

    return service.get_or_open(resolved, load)
