"""The trigger quartet through the service: application, ordering, the id rule, parse-time guards.

The item suite's scaffold over `Adventure.triggers`: add/replace/move/remove
with `/triggers` deltas everywhere (rename included — nothing in the document
references a trigger id), the uniqueness matrix with its carry-through rule,
`MoveTrigger`'s reject-don't-clamp bounds, the sidecar note remap through
undo/redo, and the parse-time rejections osrlib's own validators supply for
free — the gated-slide precedent extended to the trigger shapes.
"""

from pathlib import Path

import pytest
from osrlib.core.items import Coins
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.commands import GrantCoins, SetFlag, SpawnMonsters
from osrlib.crawl.dungeon import AreaSpec, DungeonSpec, LevelSpec
from osrlib.crawl.quests import ObjectiveSpec, QuestSpec, TriggerClause
from osrlib.crawl.triggers import (
    AreaEnteredPattern,
    FlagSetPattern,
    TownEnteredPattern,
    TriggerSpec,
)
from pydantic import ValidationError

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import OpInvariantError, OpTargetNotFoundError
from osreditor.ops import AddTrigger, AnyEditOp, MoveTrigger, OpBatch, RemoveTrigger, SetTrigger
from osreditor.projects import open_project
from osreditor.sidecar import SetNote
from osreditor.store import LocalProjectStore


def trigger(trigger_id: str = "t-1", **overrides: object) -> TriggerSpec:
    values: dict[str, object] = {"id": trigger_id, "when": TownEnteredPattern()}
    values.update(overrides)
    return TriggerSpec.model_validate(values)


def make_level() -> LevelSpec:
    return LevelSpec(number=1, width=3, height=3, entrance=(0, 0), areas=(AreaSpec(id="1", cells=((1, 1),)),))


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def make_project(
    service: DocumentService,
    tmp_path: Path,
    *,
    triggers: tuple[TriggerSpec, ...] = (),
    quests: tuple[QuestSpec, ...] = (),
) -> OpenProject:
    adventure = Adventure(
        name="Fixture",
        town=TownSpec(name=""),
        dungeons=(DungeonSpec(id="d", levels=(make_level(),)),),
        triggers=triggers,
        quests=quests,
    )
    project_dir = tmp_path / "fixture.osr"
    service.store.write_artifact(str(project_dir), "adventure.json", dump_adventure(adventure))
    return open_project(service, project_dir)


def commit(service: DocumentService, project: OpenProject, *ops: AnyEditOp):
    return service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))


def reject(service: DocumentService, project: OpenProject, error: type[Exception], *ops: AnyEditOp) -> Exception:
    before = project.adventure
    with pytest.raises(error) as excinfo:
        commit(service, project, *ops)
    assert project.adventure is before
    assert project.revision == "r1"
    return excinfo.value


def trigger_ids(project: OpenProject) -> list[str]:
    return [entry.id for entry in project.adventure.triggers]


# --- add / replace / remove ------------------------------------------------------


def test_add_appends_in_authored_order_with_the_triggers_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger("first"),))
    result = commit(service, project, AddTrigger(trigger=trigger("second")))
    assert trigger_ids(project) == ["first", "second"]
    assert result.delta[0].path == "/triggers"


def test_set_replaces_whole_value_with_the_triggers_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger(),))
    replacement = trigger(repeatable=True, consequences=(SetFlag(key="k", value=True),))
    result = commit(service, project, SetTrigger(trigger_id="t-1", trigger=replacement))
    assert project.adventure.triggers == (replacement,)
    assert result.delta[0].path == "/triggers"


def test_set_preserves_consequence_order_committed_whole(service: DocumentService, tmp_path: Path) -> None:
    # Consequence reorder needs no op: order rides the whole-value grain.
    ordered = (SetFlag(key="b", value=1), SetFlag(key="a", value=1))
    project = make_project(service, tmp_path, triggers=(trigger(consequences=ordered),))
    reordered = trigger(consequences=(ordered[1], ordered[0]))
    commit(service, project, SetTrigger(trigger_id="t-1", trigger=reordered))
    stored = project.adventure.triggers[0].consequences
    assert [command.key for command in stored if isinstance(command, SetFlag)] == ["a", "b"]


def test_set_targets_the_first_match_among_foreign_duplicates(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger(), trigger(repeatable=True)))
    commit(service, project, SetTrigger(trigger_id="t-1", trigger=trigger(conditions=())))
    assert [entry.repeatable for entry in project.adventure.triggers] == [False, True]


def test_remove_drops_the_trigger_first_match(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger(repeatable=True), trigger()))
    result = commit(service, project, RemoveTrigger(trigger_id="t-1"))
    assert [entry.repeatable for entry in project.adventure.triggers] == [False]
    assert result.delta[0].path == "/triggers"


def test_unknown_targets_are_targeting_misses(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpTargetNotFoundError, SetTrigger(trigger_id="ghost", trigger=trigger("ghost")))
    reject(service, project, OpTargetNotFoundError, RemoveTrigger(trigger_id="ghost"))
    reject(service, project, OpTargetNotFoundError, MoveTrigger(trigger_id="ghost", index=0))


def test_atomicity_a_failing_op_rejects_the_whole_batch(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpInvariantError,
        AddTrigger(trigger=trigger("fine")),
        AddTrigger(trigger=trigger("fine")),
    )
    assert project.adventure.triggers == ()


def test_each_gesture_is_one_undo_step(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    commit(service, project, AddTrigger(trigger=trigger("a")), AddTrigger(trigger=trigger("b")))
    commit(service, project, RemoveTrigger(trigger_id="a"))
    assert trigger_ids(project) == ["b"]
    service.undo(project)
    assert trigger_ids(project) == ["a", "b"]
    service.undo(project)
    assert trigger_ids(project) == []


# --- the uniqueness matrix --------------------------------------------------------


def test_add_rejects_a_duplicate_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger(),))
    error = reject(service, project, OpInvariantError, AddTrigger(trigger=trigger()))
    assert "already has a trigger" in str(error)


def test_rename_onto_a_duplicate_rejects(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger("editable"), trigger("taken")))
    reject(service, project, OpInvariantError, SetTrigger(trigger_id="editable", trigger=trigger("taken")))


def test_a_foreign_duplicates_unchanged_id_carries_through(service: DocumentService, tmp_path: Path) -> None:
    # The invariant is "no op ever introduces a collision", not "no duplicated
    # document may be edited": the unchanged id never rejects, other fields
    # edit cleanly, and the finding stays a navigable diagnostic.
    project = make_project(service, tmp_path, triggers=(trigger(), trigger()))
    result = commit(service, project, SetTrigger(trigger_id="t-1", trigger=trigger(repeatable=True)))
    assert project.adventure.triggers[0].repeatable is True
    duplicates = [finding for finding in result.diagnostics.validation if finding.code == "trigger_id_not_unique"]
    assert len(duplicates) == 1
    assert duplicates[0].address == "trigger:t-1"


def test_quest_id_overlap_is_explicitly_legal(service: DocumentService, tmp_path: Path) -> None:
    # Trigger and quest ids are separate namespaces with no cross-check.
    quest = QuestSpec(
        id="shared",
        name="The quest",
        objectives=(ObjectiveSpec(id="visit", when=TriggerClause(pattern=TownEnteredPattern())),),
    )
    project = make_project(service, tmp_path, quests=(quest,))
    result = commit(service, project, AddTrigger(trigger=trigger("shared")))
    assert trigger_ids(project) == ["shared"]
    assert result.diagnostics.validation == ()


def test_an_empty_id_rejects_at_request_parse() -> None:
    with pytest.raises(ValidationError):
        AddTrigger.model_validate(
            {"op": "add_trigger", "trigger": {"id": "", "when": {"pattern_type": "town_entered"}}}
        )


# --- MoveTrigger ------------------------------------------------------------------


def test_move_to_the_front_middle_and_end(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger("a"), trigger("b"), trigger("c")))
    result = commit(service, project, MoveTrigger(trigger_id="c", index=0))
    assert trigger_ids(project) == ["c", "a", "b"]
    assert result.delta[0].path == "/triggers"
    commit(service, project, MoveTrigger(trigger_id="c", index=1))
    assert trigger_ids(project) == ["a", "c", "b"]
    commit(service, project, MoveTrigger(trigger_id="c", index=2))
    assert trigger_ids(project) == ["a", "b", "c"]


def test_a_same_position_move_applies_as_a_no_change_batch(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger("a"), trigger("b")))
    result = commit(service, project, MoveTrigger(trigger_id="a", index=0))
    assert trigger_ids(project) == ["a", "b"]
    assert result.revision == "r2"


def test_an_out_of_range_move_rejects_naming_the_range(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger("a"), trigger("b")))
    error = reject(service, project, OpInvariantError, MoveTrigger(trigger_id="a", index=2))
    assert "positions 0 through 1" in str(error)


def test_a_negative_index_rejects_at_request_parse() -> None:
    with pytest.raises(ValidationError):
        MoveTrigger.model_validate({"op": "move_trigger", "trigger_id": "a", "index": -1})


# --- the rename -------------------------------------------------------------------


def test_rename_keeps_the_triggers_pointer_and_cascades_nowhere(service: DocumentService, tmp_path: Path) -> None:
    # No document field references a trigger id, so a rename's delta stays
    # /triggers — unlike the monster and item renames, whose cascades force
    # whole-document deltas.
    project = make_project(service, tmp_path, triggers=(trigger("old"),))
    result = commit(service, project, SetTrigger(trigger_id="old", trigger=trigger("new")))
    assert trigger_ids(project) == ["new"]
    assert result.delta[0].path == "/triggers"


def test_rename_remaps_the_sidecar_note_through_undo_and_redo(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, triggers=(trigger("old"),))
    service.apply_sidecar_patch(project, (SetNote(address="trigger:old", text="Ours."),))
    commit(service, project, SetTrigger(trigger_id="old", trigger=trigger("new")))
    assert project.sidecar.notes == {"trigger:new": "Ours."}
    service.undo(project)
    assert trigger_ids(project) == ["old"]
    assert project.sidecar.notes == {"trigger:old": "Ours."}
    service.redo(project)
    assert trigger_ids(project) == ["new"]
    assert project.sidecar.notes == {"trigger:new": "Ours."}


# --- parse-time rejections --------------------------------------------------------
# The model validators arrive free: the batch's mandatory re-validation and
# the request parse both run osrlib's own guards, so these shapes are 422s
# before any op logic runs — the gated-slide precedent.


def when_town() -> dict[str, object]:
    return {"pattern_type": "town_entered"}


def test_a_consuming_condition_is_unrepresentable_at_parse() -> None:
    with pytest.raises(ValidationError, match="a trigger fires, it does not take"):
        AddTrigger.model_validate(
            {
                "op": "add_trigger",
                "trigger": {
                    "id": "t",
                    "when": when_town(),
                    "conditions": [{"condition_type": "has_item", "item_id": "key", "consumes": True}],
                },
            }
        )


def test_a_source_carrying_consequence_is_unrepresentable_at_parse() -> None:
    with pytest.raises(ValidationError, match="the issuing trigger stamps it"):
        AddTrigger.model_validate(
            {
                "op": "add_trigger",
                "trigger": {
                    "id": "t",
                    "when": when_town(),
                    "consequences": [{"command_type": "set_flag", "key": "k", "value": True, "source": "forged"}],
                },
            }
        )


def test_a_tenth_command_type_is_unrepresentable_at_parse() -> None:
    # The union is the enforcement: a lifecycle command outside the closed
    # nine-command consequence vocabulary fails the discriminator.
    with pytest.raises(ValidationError):
        AddTrigger.model_validate(
            {
                "op": "add_trigger",
                "trigger": {
                    "id": "t",
                    "when": when_town(),
                    "consequences": [{"command_type": "mark_trigger_fired", "trigger_id": "t"}],
                },
            }
        )


@pytest.mark.parametrize(
    "spawn",
    [
        {
            "command_type": "spawn_monsters",
            "template_id": "orc",
            "count_dice": "2d4",
            "count_fixed": 3,
            "distance_feet": 30,
        },
        {"command_type": "spawn_monsters", "template_id": "orc", "distance_feet": 30},
    ],
    ids=["both-counts", "neither-count"],
)
def test_a_malformed_spawn_count_is_unrepresentable_at_parse(spawn: dict[str, object]) -> None:
    with pytest.raises(ValidationError, match="exactly one of count_dice or count_fixed"):
        AddTrigger.model_validate(
            {"op": "add_trigger", "trigger": {"id": "t", "when": when_town(), "consequences": [spawn]}}
        )


def test_a_town_placement_carrying_dungeon_fields_is_unrepresentable_at_parse() -> None:
    with pytest.raises(ValidationError, match="a town location carries no dungeon fields"):
        AddTrigger.model_validate(
            {
                "op": "add_trigger",
                "trigger": {
                    "id": "t",
                    "when": when_town(),
                    "consequences": [
                        {
                            "command_type": "place_party",
                            "location": {"kind": "town", "dungeon_id": "d", "level_number": 1},
                        }
                    ],
                },
            }
        )


def test_committed_consequences_round_trip_the_null_source(service: DocumentService, tmp_path: Path) -> None:
    # No form authors a source, and the serialized `source: null` in every
    # dumped command must round-trip untouched.
    project = make_project(service, tmp_path)
    commit(
        service,
        project,
        AddTrigger(
            trigger=trigger(
                consequences=(
                    SetFlag(key="k", value="v"),
                    GrantCoins(character_id="@party", coins=Coins(gp=5)),
                    SpawnMonsters(template_id="orc", count_dice="2d4", distance_feet=30),
                )
            )
        ),
    )
    payload = project.adventure.model_dump(mode="json")
    assert [command["source"] for command in payload["triggers"][0]["consequences"]] == [None, None, None]
    reopened = open_project(DocumentService(LocalProjectStore()), project.path)
    assert reopened.adventure.triggers == project.adventure.triggers


def test_dangling_references_are_diagnostics_not_rejections(service: DocumentService, tmp_path: Path) -> None:
    # The tier rule: dangling pattern references are legal while editing.
    project = make_project(service, tmp_path)
    result = commit(
        service,
        project,
        AddTrigger(trigger=trigger(when=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id="ghost"))),
    )
    assert "trigger_pattern_unknown_area" in [finding.code for finding in result.diagnostics.validation]


def test_a_repeatable_flag_watcher_survives_a_full_round_trip(service: DocumentService, tmp_path: Path) -> None:
    watcher = trigger("watcher", when=FlagSetPattern(key="k"), repeatable=True)
    project = make_project(service, tmp_path)
    commit(service, project, AddTrigger(trigger=watcher))
    reopened = open_project(DocumentService(LocalProjectStore()), project.path)
    assert reopened.adventure.triggers == (watcher,)
