"""Regenerate the committed forge-workdir fixture from its builder.

The fixture is an original mini-module authored directly as osr-forge stage
caches through forge's own contract models, plus a fabricated `run.json` with the
monsters stage `completed` — the zero-network vehicle for phase 5's forge suites
(forge's own test pattern; there is no `is_workdir()` and no staleness detection,
so a hand-authored stage-cache workdir is the right fixture). The content is
built to raise the review vocabulary — `geometry_synthesized`, `monster_custom`,
`monster_unresolved`, `low_confidence`, `connection_ambiguous`,
`transition_guessed`, and `treasure_unparsed` — and to reach a publishable draft
after a scripted set of corrections.

Wholly original content, per the licensing fence; `FixtureProvider` recordings
wait for phase 6, the first phase that runs a model stage. The committed fixture
carries only the inputs forge reads — `run.json`, the `stages/` caches, and two
page renders with text layers — never the build products (`adventure.json`,
`report.json`, `previews/`); tests copy the fixture to a temp directory and let
`assemble()` produce those, keeping the checkout clean.

Run only on a deliberate, reviewed change to the fixture or a forge contract
shape — never as a fix for an ununderstood red test:

    uv run python tests/generate_forge_workdir.py
"""

import struct
import zlib
from datetime import UTC, datetime
from pathlib import Path

from osrforge.contracts.run import RunMeta, Stage, StageStatus, TokenUsage
from osrforge.contracts.stages import (
    AreaConnection,
    AreaContent,
    AreaEncounter,
    LevelContent,
    MonsterResolution,
    MonsterResolutions,
    RawStatBlock,
    StatBlocks,
    SurveyArea,
    SurveyDungeon,
    SurveyIndex,
    SurveyLevel,
    TownInfo,
)
from osrforge.settings import ConversionSettings
from osrforge.workdir import Workdir, write_json_artifact

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "forge_workdir"

DUNGEON_ID = "sunken-vault"

# A deterministic stamp so the fabricated run.json is byte-stable across
# regenerations — run.json is the one artifact allowed to carry timestamps.
_STAMP = datetime(2026, 7, 9, 12, 0, 0, tzinfo=UTC)
_STAMP_END = datetime(2026, 7, 9, 12, 1, 0, tzinfo=UTC)


def _survey() -> SurveyIndex:
    """The survey index: one two-level dungeon, an empty town name (a module-scope flag)."""
    return SurveyIndex(
        title="The Sunken Vault of Ashkar",
        description="A flooded barrow beneath the salt marsh, where a drowned cult still keeps its vigil.",
        hooks=("A pilgrim's charm, lost to the vault, must be recovered before the new moon.",),
        # An empty town name raises a module-scope low_confidence flag at assembly —
        # the review queue's module row, exercised.
        town=TownInfo(name="", description="A shuttered marsh hamlet on stilts.", services=("provisioner",)),
        dungeons=(
            SurveyDungeon(
                id=DUNGEON_ID,
                name="The Sunken Vault",
                levels=(
                    SurveyLevel(
                        number=1,
                        map_pages=(1,),
                        areas=(
                            SurveyArea(key="1", name="Flooded antechamber", kind="room", source_pages=(1,)),
                            SurveyArea(key="2", name="Guardroom", kind="room", source_pages=(1,)),
                            SurveyArea(key="3", name="Silt-choked cell", kind="cave", source_pages=(2,)),
                        ),
                    ),
                    SurveyLevel(
                        number=2,
                        map_pages=(2,),
                        areas=(SurveyArea(key="1", name="The drowned shrine", kind="cave", source_pages=(2,)),),
                    ),
                ),
            ),
        ),
        monster_names=("skeleton", "vault warden", "drowned one"),
    )


def _level_one() -> LevelContent:
    """Level 1: a connected chain plus the ambiguous connection and the unparseable treasure."""
    return LevelContent(
        dungeon_id=DUNGEON_ID,
        level_number=1,
        areas=(
            AreaContent(
                key="1",
                description="Black water laps at a flight of worn steps descending into the dark.",
                encounters=(),
                treasure=(),
                features=("A rusted votive stand, its candles long drowned.",),
                connections=(AreaConnection(to_key="2", direction="east", via="passage"),),
                source_pages=(1,),
                confidence=0.92,
            ),
            AreaContent(
                key="2",
                description="Niches line the walls; a stair spirals down through a hole in the flooded floor.",
                encounters=(AreaEncounter(monster="skeleton", count_fixed=3),),
                treasure=(),
                features=(),
                connections=(
                    AreaConnection(to_key="3", direction="south", via="passage"),
                    # A stairs connection stating only a level, not a keyed area —
                    # geometry guesses the landing → transition_guessed.
                    AreaConnection(to_key=None, to_level=2, direction="down", via="stairs"),
                ),
                source_pages=(1,),
                confidence=0.81,
            ),
            AreaContent(
                key="3",
                description="A cramped cell half-buried in silt; something stirs beneath it.",
                # A count-unstated encounter raises low_confidence for the area.
                encounters=(AreaEncounter(monster="vault warden"),),
                treasure=("assorted oddments of no clear worth",),
                features=(),
                # A connection stating neither a keyed target nor a level →
                # connection_ambiguous:no target stated.
                connections=(AreaConnection(to_key=None, direction="unknown", via="passage"),),
                source_pages=(2,),
                confidence=0.34,
            ),
        ),
    )


def _level_two() -> LevelContent:
    """Level 2: the shrine, reached by the guessed stair, keying the null-block monster."""
    return LevelContent(
        dungeon_id=DUNGEON_ID,
        level_number=2,
        areas=(
            AreaContent(
                key="1",
                description="A drowned altar rises from black water; a single drowned acolyte keeps its watch.",
                encounters=(AreaEncounter(monster="drowned one", count_fixed=1),),
                treasure=(),
                features=(),
                connections=(AreaConnection(to_key=None, to_level=1, direction="up", via="stairs"),),
                source_pages=(2,),
                confidence=0.7,
            ),
        ),
    )


def _monsters() -> MonsterResolutions:
    """One exact-resolving name and two unresolved (keys normalized, sorted on validation)."""
    return MonsterResolutions(
        resolutions={
            "drowned one": MonsterResolution(template_id=None, method="unresolved"),
            "skeleton": MonsterResolution(template_id="skeleton", method="exact"),
            "vault warden": MonsterResolution(template_id=None, method="unresolved"),
        }
    )


def _statblocks() -> StatBlocks:
    """Under `emit`: a usable printed block for the custom monster, an explicit null for the other.

    The null marker is the contract's `monster_unresolved` stand-in — *not* an
    absent entry, which under `emit` is a stale cache that hard-errors in
    `assemble()`.
    """
    return StatBlocks(
        custom_monsters="emit",
        blocks={
            "drowned one": None,
            "vault warden": RawStatBlock(
                ac="4",
                ac_notation="descending",
                hit_dice="4+1",
                hp=19,
                attacks=("1 slam (1d8)",),
                movement="90' (30')",
                saves="D10 W11 P12 B13 S14 (4)",
                morale=10,
                alignment="Chaotic",
                xp=125,
                number_appearing="1 (1)",
                special=("Immune to sleep and charm; regenerates 2 hp per round in water.",),
                source_pages=(2,),
            ),
        },
    )


def _run() -> RunMeta:
    """A fabricated `run.json`: preprocess/survey/content/monsters completed, custom_monsters: emit."""
    completed = StageStatus(
        status="completed",
        started_at=_STAMP,
        finished_at=_STAMP_END,
        usage=TokenUsage(input_tokens=1000, output_tokens=200),
    )
    stages = {stage: StageStatus() for stage in Stage}
    for stage in (Stage.PREPROCESS, Stage.SURVEY, Stage.CONTENT, Stage.MONSTERS):
        stages[stage] = completed
    return RunMeta(
        source_sha256="ab" * 32,
        source_bytes=204_800,
        page_count=2,
        settings=ConversionSettings(custom_monsters="emit"),
        provider="FixtureProvider",
        model_id="fixture-stub-1",
        stages=stages,
    )


def _page_png(page_number: int) -> bytes:
    """Build a tiny deterministic PNG for one page — a solid tint keyed to the page number.

    Real PNG bytes so the source-pages pane renders, tiny so the fixture stays
    light; the page content is immaterial to the automated suites.
    """
    width, height = 16, 24
    tint = 235 - (page_number % 3) * 20
    row = b"\x00" + bytes((tint, tint, 245)) * width
    raw = row * height
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def build_forge_workdir(root: Path) -> Workdir:
    """Write the whole fixture workdir under `root` and return the bound `Workdir`.

    Args:
        root: The workdir root to populate.

    Returns:
        The bound workdir.
    """
    workdir = Workdir(root)
    workdir.stages_dir.mkdir(parents=True, exist_ok=True)
    workdir.pages_dir.mkdir(parents=True, exist_ok=True)

    workdir.write_run(_run())
    write_json_artifact(workdir.survey_json, _survey())
    write_json_artifact(workdir.areas_json(DUNGEON_ID, 1), _level_one())
    write_json_artifact(workdir.areas_json(DUNGEON_ID, 2), _level_two())
    write_json_artifact(workdir.monsters_json, _monsters())
    write_json_artifact(workdir.statblocks_json, _statblocks())

    for page in (1, 2):
        workdir.page_png(page).write_bytes(_page_png(page))
        workdir.page_txt(page).write_text(f"Printed text of page {page} of The Sunken Vault of Ashkar.\n", "utf-8")
    return workdir


def main() -> None:
    """Regenerate the committed fixture in place."""
    if FIXTURE_ROOT.exists():
        for path in sorted(FIXTURE_ROOT.rglob("*"), reverse=True):
            if path.is_file() or path.is_symlink():
                path.unlink()
            else:
                path.rmdir()
    FIXTURE_ROOT.mkdir(parents=True, exist_ok=True)
    build_forge_workdir(FIXTURE_ROOT)
    print(f"wrote {FIXTURE_ROOT}")


if __name__ == "__main__":
    main()
