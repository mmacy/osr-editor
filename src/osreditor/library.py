"""The content library's backend: pack projection, source opens, and the stash capture.

Everything between osrlib's [`ContentPack`][osrlib.crawl.content_pack.ContentPack]
model and the routes lives here. The projection turns an adventure into pack
shape — geometry-free entries under the diagnostics address grammar, the
bundled-monster closure computed — and the source open resolves the derived
habitat's three branches (the current project from memory, a second native
project through the store seam, a forge workdir through the bridge) into one
[`SourceState`][osreditor.library.SourceState] shape, so the panel never cares
where a pack came from. Opening a source writes nothing the editor owns to it
and registers no project; a workdir source's assembly writes are forge's own
derived artifacts, the same rebuild-on-open posture as project open.

The stash capture is the compound act on the `apply_stock` template: one lock
acquisition, the stale-revision refusal before any capture, the sidecar
mutation and persist inside the same critical section — so a stash pack always
records what the destructive batch that follows is about to destroy.
"""

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Literal, cast

from osrlib.core.monsters import MonsterTemplate
from osrlib.crawl.adventure import Adventure
from osrlib.crawl.content_pack import (
    ContentPack,
    ContentPackEntry,
    PackFinding,
    PackSection,
    validate_content_pack,
)
from osrlib.crawl.dungeon import DungeonSpec, LevelSpec, WanderingSpec
from osrlib.data import load_equipment, load_monsters
from pydantic import BaseModel, ConfigDict, JsonValue, ValidationError

from osreditor.addresses import area_address, level_address
from osreditor.aids import key_order
from osreditor.documents import (
    ADVENTURE_ARTIFACT,
    DocumentService,
    OpenProject,
    json_pointer,
    load_adventure,
)
from osreditor.errors import (
    DocumentPayloadInvalidError,
    InvalidProjectError,
    OpTargetNotFoundError,
    ProjectPathNotFoundError,
    StaleRevisionError,
    StashPackNotFoundError,
)
from osreditor.forge import open_workdir_state
from osreditor.projects import classify_artifact_names, utc_now_iso
from osreditor.sidecar import EditorSidecar, StashedPack
from osreditor.store import ProjectStore

__all__ = [
    "SourceState",
    "open_source",
    "open_stash_pack",
    "pack_from_adventure",
    "stash_level",
    "stash_pack_for_level",
    "wandering_is_authored",
]

_MAX_REPORTED_LOCATIONS = 10


def wandering_is_authored(spec: WanderingSpec) -> bool:
    """Report whether a level's wandering spec is authored — the one predicate every consumer shares.

    `WanderingSpec` exists on every level with RAW defaults, so "has a table"
    would silently drop an authored chance-only spec and "always" would offer
    every section a copy that overwrites a target with RAW defaults;
    differs-from-default is the honest authored test. The projection carries a
    section's wandering exactly when this holds, the panel offers the copy
    affordance exactly then, and the fully-used computation counts the
    wandering entry exactly when the capture carried one.

    Args:
        spec: The level's wandering spec.

    Returns:
        True when the spec differs from a default-constructed `WanderingSpec`.
    """
    return spec != WanderingSpec()


def _section_label(dungeon: DungeonSpec, level_number: int) -> str:
    """The level grouping's display label: the dungeon's name when non-empty else its id, then the level."""
    return f"{dungeon.name or dungeon.id} level {level_number}"


def _level_section(dungeon: DungeonSpec, level: LevelSpec) -> PackSection:
    """Project one level into a pack section: entries in key order, wandering when authored.

    Entry ids are the diagnostics address grammar — the same grammar the copies
    map keys speak, with percent-encoding keeping a dungeon id containing `/`
    from rendering two entries' ids ambiguous. A feature's `cell` binding
    strips to `None`: a cell is geometry, geometry never copies, and a
    preserved binding would land on an unrelated or out-of-bounds cell in any
    target. A slide trap's embedded `TransitionSpec` is kept verbatim — the
    standard diagnostics posture for a reference that legitimately arrives
    dangling.
    """
    entries = tuple(
        ContentPackEntry(
            id=area_address(dungeon.id, level.number, area.id),
            name=area.name,
            description=area.description,
            encounter=area.encounter,
            trap=area.trap,
            treasure=area.treasure,
            features=tuple(
                feature.model_copy(update={"cell": None}) if feature.cell is not None else feature
                for feature in area.features
            ),
        )
        for area in key_order(list(level.areas))
    )
    return PackSection(
        id=level_address(dungeon.id, level.number),
        label=_section_label(dungeon, level.number),
        entries=entries,
        wandering=level.wandering if wandering_is_authored(level.wandering) else None,
    )


def _closure(adventure: Adventure, sections: Sequence[PackSection]) -> tuple[MonsterTemplate, ...]:
    """The bundled-monster closure: every adventure template a projected section references.

    Referenced ids that are neither bundled nor shipped stay dangling and
    become panel findings — the honest record of a source that was already
    dangling.
    """
    referenced: set[str] = set()
    for section in sections:
        for entry in section.entries:
            if entry.encounter is not None:
                referenced.update(keyed.template_id for keyed in entry.encounter.monsters)
        if section.wandering is not None and section.wandering.table is not None:
            for row in section.wandering.table.rows:
                if row.entry.kind == "monster":
                    referenced.update(row.entry.monster_ids)
    return tuple(template for template in adventure.monsters if template.id in referenced)


def pack_from_adventure(adventure: Adventure) -> ContentPack:
    """Project an adventure into pack shape — pure; the derived habitat's currency.

    One section per dungeon/level in document order, one entry per area in key
    order. `id` stays empty: a derived pack never persists and takes its
    identity from its source path.

    Args:
        adventure: The adventure to project.

    Returns:
        The projected pack.
    """
    sections = tuple(_level_section(dungeon, level) for dungeon in adventure.dungeons for level in dungeon.levels)
    return ContentPack(
        name=adventure.name,
        description=adventure.description,
        sections=sections,
        monsters=_closure(adventure, sections),
    )


def stash_pack_for_level(
    adventure: Adventure, dungeon_id: str, level_number: int, *, pack_id: str, name: str
) -> ContentPack:
    """Project one level into a single-section pack — the stash act's capture.

    What the capture holds is the level's rooms and its wandering table when
    authored — not its level-scope features, which are cell-bound by validation
    rule and so geometry-bound by nature; undo is the way back for them exactly
    as it is for the geometry. The closure is computed over this section alone.

    Args:
        adventure: The document to capture from.
        dungeon_id: The level's dungeon.
        level_number: The level to capture.
        pack_id: The minted stash id.
        name: The pack's display name (the minted label).

    Returns:
        The captured pack.

    Raises:
        OpTargetNotFoundError: If the dungeon or level is absent.
    """
    dungeon = next((candidate for candidate in adventure.dungeons if candidate.id == dungeon_id), None)
    if dungeon is None:
        raise OpTargetNotFoundError(f"the document has no dungeon {dungeon_id!r}")
    level = next((candidate for candidate in dungeon.levels if candidate.number == level_number), None)
    if level is None:
        raise OpTargetNotFoundError(f"dungeon {dungeon_id!r} has no level {level_number}")
    section = _level_section(dungeon, level)
    return ContentPack(id=pack_id, name=name, sections=(section,), monsters=_closure(adventure, (section,)))


class SourceState(BaseModel):
    """One opened content-library source: identity, pack, and findings, whatever the habitat.

    Routing every habitat through this one shape is what makes the panel never
    care where a pack came from. Identity is pinned per habitat: a derived
    pack's identity is the resolved absolute source path, a stash pack's its
    minted id — the two can never collide, because paths are absolute and
    stash ids are `stash-<n>`. Findings are the pack's self-containment gaps,
    the diagnostics posture: visible, never blocking.
    """

    model_config = ConfigDict(frozen=True)

    identity: str
    label: str
    habitat: Literal["project", "stash"]
    pack: ContentPack
    findings: tuple[PackFinding, ...]


def _vetted(identity: str, label: str, habitat: Literal["project", "stash"], pack: ContentPack) -> SourceState:
    """Wrap a pack in the one source shape, findings computed over the shipped catalogs."""
    return SourceState(
        identity=identity,
        label=label,
        habitat=habitat,
        pack=pack,
        findings=validate_content_pack(pack, load_monsters(), load_equipment()),
    )


def _read_native_adventure(store: ProjectStore, resolved: Path) -> Adventure:
    """Read and load a native source's document through the store seam.

    The seam's first true second-project consumer: the library opens projects
    *as projects*, with the project layer's own loading discipline, and
    therefore reads exactly where the project layer reads — never a raw
    filesystem read. (The geometry importer's `Path.read_bytes()` is a
    different seam with a different nature: importers are format converters
    over arbitrary user-chosen local files, and a project directory is simply
    one file shape among their inputs.)
    """
    data = store.read_artifact(str(resolved), ADVENTURE_ARTIFACT)
    try:
        return load_adventure(data)
    except ValidationError as error:
        reported = [
            {"path": json_pointer(detail["loc"]), "message": detail["msg"]}
            for detail in error.errors()[:_MAX_REPORTED_LOCATIONS]
        ]
        raise DocumentPayloadInvalidError(
            f"the document at {resolved} does not match the installed osrlib's models", errors=reported
        ) from error


def open_source(service: DocumentService, path: Path) -> SourceState:
    """Open a derived source read-only: resolve the habitat's branch and project it.

    Stateless on the server: each open returns the pack, the panel holds it
    client-side, and re-opening refreshes. Nothing the editor owns is written
    to the source and no project registers. The whole open runs under the
    registry lock (`DocumentService.with_registry`), so a source open and a
    project open of one workdir can never interleave two assemblies.

    Args:
        service: The document service (the open registry and the store).
        path: The source directory, absolute.

    Returns:
        The source state: identity, label, pack, findings.

    Raises:
        ProjectPathNotFoundError: If the path names no directory.
        InvalidProjectError: If the directory matches neither project shape.
        ForgeWorkdirIncompleteError: If a workdir source's conversion never
            completed — the first-incomplete-stage remedy, the same refusal as
            review.
        ForgeWorkdirInvalidError: If a workdir's `run.json` does not parse or
            assembly finds a broken cache.
        ForgeOverrideInvalidError: If a workdir's `overrides.yaml` cannot load.
        osrlib.errors.SaveVersionError: If a native source's document is newer
            than the installed osrlib understands.
        osrlib.errors.ContentValidationError: If a native source's envelope is
            malformed.
        DocumentPayloadInvalidError: If a native source's payload fails model
            validation.
    """
    resolved = path.resolve()

    def build(project: OpenProject | None) -> SourceState:
        if project is not None:
            # The current-first branch: no disk read, revision-consistent, the
            # document value read under the project lock. Also how "this
            # project" appears in its own panel.
            with project.lock:
                adventure = project.adventure
            return _vetted(str(resolved), adventure.name or resolved.name, "project", pack_from_adventure(adventure))
        store = service.store
        store_key = str(resolved)
        if not store.project_exists(store_key):
            raise ProjectPathNotFoundError(f"no directory at {resolved}")
        kind = classify_artifact_names(store.list_artifacts(store_key))
        if kind is None:
            raise InvalidProjectError(f"{resolved} is not a project: no adventure.json and no forge workdir markers")
        if kind == "forge":
            # Current-first through the forge bridge: assembly is pure,
            # deterministic, and zero-network, and its writes are forge's own
            # derived artifacts — the rebuild-on-open posture project open pins.
            adventure = open_workdir_state(store.materialize(store_key)).adventure
        else:
            adventure = _read_native_adventure(store, resolved)
        return _vetted(str(resolved), adventure.name or resolved.name, "project", pack_from_adventure(adventure))

    return service.with_registry(resolved, build)


def stash_level(
    service: DocumentService, project: OpenProject, revision: str, dungeon_id: str, level_number: int
) -> EditorSidecar:
    """Bank one level's content in the stash — the compound act before a destructive batch.

    One lock acquisition; the stale-revision 409 before any capture, so a
    stash is always computed against the revision the destructive batch will
    run at; the capture, the counter mint, the append, and `persist_sidecar`
    all inside the same critical section. The client then posts the
    destructive batch as its ordinary guarded self — the two acts are
    deliberately not one: the stash is sidecar, the batch is document, and a
    batch that 409s after a stash leaves an intact level plus a stash pack,
    the same harmless deletable duplicate as undoing the replace.

    Args:
        service: The document service (persists the sidecar).
        project: The open project.
        revision: The revision the capture was computed against.
        dungeon_id: The level's dungeon.
        level_number: The level to capture.

    Returns:
        The updated sidecar.

    Raises:
        StaleRevisionError: If `revision` is not current — before any capture.
        OpTargetNotFoundError: If the dungeon or level is absent.
    """
    with project.lock:
        if revision != project.revision:
            raise StaleRevisionError(
                f"the stash was computed against revision {revision}, but the current revision is {project.revision}",
                current_revision=project.revision,
            )
        adventure = project.adventure
        counter = project.sidecar.stash_counter + 1
        pack_id = f"stash-{counter}"
        now = utc_now_iso()
        dungeon = next((candidate for candidate in adventure.dungeons if candidate.id == dungeon_id), None)
        label = f"{(dungeon.name or dungeon.id) if dungeon else dungeon_id} level {level_number} — {now[:10]}"
        pack = stash_pack_for_level(adventure, dungeon_id, level_number, pack_id=pack_id, name=label)
        wrapper = StashedPack(
            pack_id=pack_id, label=label, created_at=now, document=cast(JsonValue, pack.to_document())
        )
        project.sidecar = project.sidecar.model_copy(
            update={"stash": (*project.sidecar.stash, wrapper), "stash_counter": counter}
        )
        service.persist_sidecar(project)
        return project.sidecar


def open_stash_pack(project: OpenProject, pack_id: str) -> SourceState:
    """Open one stash pack into the same source shape as any derived open.

    The stored envelope is vetted server-side: `ContentPack.from_document`
    under the accepted-older rule, findings included. A pack a newer engine
    stamped surfaces the existing schema-newer error with the upgrade remedy;
    the listing wrapper keeps naming it either way.

    Args:
        project: The open project whose sidecar holds the stash.
        pack_id: The minted stash id.

    Returns:
        The source state, `habitat="stash"`.

    Raises:
        StashPackNotFoundError: If no stash pack has that id.
        osrlib.errors.SaveVersionError: If the pack was stamped by a newer
            schema version.
        osrlib.errors.ContentValidationError: If the stored envelope or
            payload is malformed.
    """
    with project.lock:
        wrapper = next((pack for pack in project.sidecar.stash if pack.pack_id == pack_id), None)
    if wrapper is None:
        raise StashPackNotFoundError(f"the stash has no pack {pack_id!r}")
    pack = ContentPack.from_document(cast(Mapping[str, object], wrapper.document))
    return _vetted(pack_id, wrapper.label, "stash", pack)
