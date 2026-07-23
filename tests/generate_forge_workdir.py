"""Write the committed forge-workdir fixture: an original mini-module as forge stage caches.

The fixture is authored directly through forge's own contract models — the
established generator pattern, with `run.json` fabricated the way forge's own
tests fabricate it (`osr-forge/tests/conftest.py`). The content is wholly
original (the licensing fence) and built to raise the review vocabulary on
first assembly: `geometry_synthesized`, `monster_custom` (the mill wisp's
usable printed block emits a custom template), `monster_unresolved` (the rat
king's explicit-null block marker falls to the stand-in machinery),
`low_confidence` (an unstated encounter count), `connection_ambiguous` (a
target-less connection), `transition_guessed` (a `to_level` stairs mention),
and `treasure_unparsed` (an unparseable treasure string).

Run only on a deliberate regeneration (an intended forge cache-shape change):

    uv run python tests/generate_forge_workdir.py

Tests never run forge operations against the committed tree — assembly writes
artifacts — so every consumer copies it to a temp directory first (the
`forge_workdir` fixture in `conftest.py`).
"""

import shutil
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
from PIL import Image, ImageDraw

FORGE_WORKDIR_PATH = Path(__file__).parent / "fixtures" / "forge_workdir"

DUNGEON_ID = "millstone-warrens"

PAGE_TEXTS = {
    1: (
        "THE MILLSTONE WARRENS - page 1\n"
        "\n"
        "1. GRINDING HALL. The great grindstone stands silent\n"
        "under a shroud of pale dust. The main shaft can still be\n"
        "turned by hand, raising a groan through the whole mill.\n"
        "\n"
        "2. FLOUR CELLAR. Sacks of flour line the walls, and\n"
        "something has gnawed clean through the lot. 1d4 goblins\n"
        "squat among the sacks. A tripwire upends a rack of\n"
        "millstones: save versus paralysis or take 1d6. Treasure\n"
        "type C, plus a tithe of moon-flour, priceless to the\n"
        "right buyer.\n"
    ),
    2: (
        "THE MILLSTONE WARRENS - page 2\n"
        "\n"
        "3. SLUICE GATE. Green water sluices through a rusted\n"
        "grate below the walkway. 120 gp in a tarred satchel\n"
        "hang beneath it. Stairs descend to the undermill.\n"
        "\n"
        "LEVEL 2\n"
        "\n"
        "1. UNDERMILL POOL. A cold pool fills half the cavern;\n"
        "two pale lights bob over the water.\n"
        "\n"
        "MILL WISP. AC 7 [12], HD 2*, hp 9, MV fly 120' (40'),\n"
        "ATT 1 chill touch (1d4 + special), THAC0 17, ML 10,\n"
        "AL Chaotic, NA 1d4 (1d6). Harmed only by silver or\n"
        "magical weapons.\n"
        "\n"
        "2. RAT KING'S COURT. Bones and grain husks carpet a\n"
        "throne of broken millstones. The rat king holds court\n"
        "here, wearing a silver crown worth 400 gp.\n"
    ),
}


def build_survey() -> SurveyIndex:
    """The survey cache: one dungeon of two levels, five keyed areas."""
    return SurveyIndex(
        title="The Millstone Warrens",
        description="A derelict watermill hides a smugglers' warren beneath its grinding floor.",
        hooks=("The miller's ghost is said to walk the sluice gate at dusk.",),
        town=TownInfo(
            name="Bran's Ford",
            description="A ford-side hamlet of eel-catchers and carters.",
            services=("The Wheelhouse inn", "Ferro's smithy"),
        ),
        dungeons=(
            SurveyDungeon(
                id=DUNGEON_ID,
                name="The Millstone Warrens",
                levels=(
                    SurveyLevel(
                        number=1,
                        map_pages=(1,),
                        areas=(
                            SurveyArea(key="1", name="Grinding Hall", kind="room", source_pages=(1,)),
                            SurveyArea(key="2", name="Flour Cellar", kind="room", source_pages=(1,)),
                            SurveyArea(key="3", name="Sluice Gate", kind="room", source_pages=(2,)),
                        ),
                    ),
                    SurveyLevel(
                        number=2,
                        map_pages=(2,),
                        areas=(
                            SurveyArea(key="1", name="Undermill Pool", kind="cave", source_pages=(2,)),
                            SurveyArea(key="2", name="Rat King's Court", kind="cave", source_pages=(2,)),
                        ),
                    ),
                ),
            ),
        ),
        monster_names=("Goblin", "Mill Wisp", "Rat King"),
    )


def build_level_one() -> LevelContent:
    """Level 1's content: the ambiguous connection, the trap, and the unparseable treasure."""
    return LevelContent(
        dungeon_id=DUNGEON_ID,
        level_number=1,
        areas=(
            AreaContent(
                key="1",
                description="The great grindstone stands silent under a shroud of pale dust.",
                encounters=(),
                treasure=(),
                features=("The main shaft can be turned by hand, raising a groan through the whole mill.",),
                connections=(
                    AreaConnection(to_key="2", direction="south", via="door"),
                    # No target stated: assembly flags connection_ambiguous.
                    AreaConnection(direction="unknown", via="passage"),
                ),
                source_pages=(1,),
                confidence=0.9,
            ),
            AreaContent(
                key="2",
                description="Sacks of flour line the walls; something has gnawed clean through the lot.",
                encounters=(AreaEncounter(monster="Goblin", count_dice="1d4"),),
                trap="A tripwire among the sacks upends a rack of millstones: save versus paralysis or take 1d6.",
                # The first string parses as a treasure-type letter; the second
                # matches nothing in the grammar and flags treasure_unparsed.
                treasure=("Treasure Type C", "a tithe of moon-flour, priceless to the right buyer"),
                features=(),
                connections=(
                    AreaConnection(to_key="1", direction="north", via="door"),
                    AreaConnection(to_key="3", direction="east", via="secret_door"),
                ),
                source_pages=(1,),
                confidence=0.85,
            ),
            AreaContent(
                key="3",
                description="Green water sluices through a rusted grate below the walkway.",
                encounters=(),
                treasure=("120 gp in a tarred satchel under the walkway",),
                features=(),
                connections=(
                    AreaConnection(to_key="2", direction="west", via="secret_door"),
                    # A level-shaped stairs mention: synthesis lands it on level
                    # 2's first keyed area and flags transition_guessed.
                    AreaConnection(direction="down", via="stairs", to_level=2),
                ),
                source_pages=(2,),
                confidence=0.55,
            ),
        ),
    )


def build_level_two() -> LevelContent:
    """Level 2's content: the custom monster, the unresolved monster, the reciprocal stairs mention."""
    return LevelContent(
        dungeon_id=DUNGEON_ID,
        level_number=2,
        areas=(
            AreaContent(
                key="1",
                description="A cold pool fills half the cavern; two pale lights bob over the water.",
                encounters=(AreaEncounter(monster="Mill Wisp", count_fixed=2),),
                treasure=(),
                features=(),
                connections=(
                    AreaConnection(to_key="2", direction="east", via="passage"),
                    # The reciprocal stairs mention: merges with level 1's into
                    # one guessed reciprocal transition, both areas flagged.
                    AreaConnection(direction="up", via="stairs", to_level=1),
                ),
                source_pages=(2,),
                confidence=0.8,
            ),
            AreaContent(
                key="2",
                description="Bones and grain husks carpet a throne of broken millstones.",
                # No count stated: assembly flags low_confidence.
                encounters=(AreaEncounter(monster="Rat King"),),
                treasure=("a silver crown worth 400 gp",),
                features=(),
                connections=(AreaConnection(to_key="1", direction="west", via="passage"),),
                source_pages=(2,),
                confidence=0.75,
            ),
        ),
    )


def build_monsters() -> MonsterResolutions:
    """The monsters cache: one exact-resolving name, two unresolved."""
    return MonsterResolutions(
        resolutions={
            "goblin": MonsterResolution(template_id="goblin", method="exact"),
            "mill wisp": MonsterResolution(template_id=None, method="unresolved"),
            "rat king": MonsterResolution(template_id=None, method="unresolved"),
        }
    )


def build_statblocks() -> StatBlocks:
    """The stat-block cache: a usable printed block for the mill wisp, the explicit null marker for the rat king.

    The null must be the contract's explicit absent marker, not a missing
    entry: under `custom_monsters: emit` a cached-unresolved name with no
    `blocks` entry is a stale cache that hard-errors in `assemble()`.
    """
    return StatBlocks(
        custom_monsters="emit",
        blocks={
            "mill wisp": RawStatBlock(
                ac="7 [12]",
                ac_notation="dual",
                thac0="17",
                hit_dice="2*",
                hp=9,
                attacks=("1 chill touch (1d4 + special)",),
                movement="fly 120' (40')",
                saves="D12 W13 P14 B15 S16",
                morale=10,
                alignment="Chaotic",
                number_appearing="1d4 (1d6)",
                special=("Harmed only by silver or magical weapons.",),
                confidence=0.8,
                source_pages=(2,),
            ),
            "rat king": None,
        },
    )


def build_run() -> RunMeta:
    """A fabricated `run.json`: model stages completed with usage, geometry and assemble pending."""
    started = datetime(2026, 7, 19, 12, 0, 0, tzinfo=UTC)

    def completed(minutes: int, usage: TokenUsage | None = None) -> StageStatus:
        return StageStatus(
            status="completed",
            started_at=started.replace(minute=minutes),
            finished_at=started.replace(minute=minutes + 1),
            usage=usage,
        )

    stages = {stage: StageStatus() for stage in Stage}
    stages[Stage.PREPROCESS] = completed(0)
    stages[Stage.SURVEY] = completed(2, TokenUsage(input_tokens=1200, output_tokens=300))
    stages[Stage.CONTENT] = completed(4, TokenUsage(input_tokens=5400, output_tokens=900))
    stages[Stage.MONSTERS] = completed(6, TokenUsage(input_tokens=800, output_tokens=120))
    return RunMeta(
        source_sha256="6d" * 32,
        source_bytes=2048,
        page_count=2,
        settings=ConversionSettings(),
        provider="FixtureProvider",
        model_id="fixture-model-1",
        stages=stages,
    )


def write_page(workdir: Workdir, number: int, text: str) -> None:
    """One committed page: a small white render with the printed text, plus its text layer."""
    image = Image.new("RGB", (480, 400), "white")
    draw = ImageDraw.Draw(image)
    draw.multiline_text((16, 16), text, fill="black")
    image.save(workdir.page_png(number))
    workdir.page_txt(number).write_text(text, encoding="utf-8")


def main() -> None:
    """Write the whole fixture tree, replacing any previous generation."""
    if FORGE_WORKDIR_PATH.exists():
        shutil.rmtree(FORGE_WORKDIR_PATH)
    workdir = Workdir(FORGE_WORKDIR_PATH)
    workdir.stages_dir.mkdir(parents=True)
    workdir.pages_dir.mkdir()
    workdir.write_run(build_run())
    write_json_artifact(workdir.survey_json, build_survey())
    write_json_artifact(workdir.areas_json(DUNGEON_ID, 1), build_level_one())
    write_json_artifact(workdir.areas_json(DUNGEON_ID, 2), build_level_two())
    write_json_artifact(workdir.monsters_json, build_monsters())
    write_json_artifact(workdir.statblocks_json, build_statblocks())
    for number, text in PAGE_TEXTS.items():
        write_page(workdir, number, text)
    print(f"wrote {FORGE_WORKDIR_PATH}")


if __name__ == "__main__":
    main()
