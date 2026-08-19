"""The quest quartet through the service: application, ordering, the id rule, parse-time guards.

The trigger suite's scaffold over `Adventure.quests`: add/replace/move/remove
with `/quests` deltas everywhere (rename included — nothing in the document
references a quest id), the uniqueness matrix with its carry-through rule,
`MoveQuest`'s reject-don't-clamp bounds, the sidecar note remap through
undo/redo, and the parse-time rejections osrlib's own validators supply for
free — the gated-slide precedent extended to the quest shapes: a consuming
clause condition, a source-carrying reward, duplicate objective ids, a reveal
clause on a visible objective, zero objectives, and an empty name all reject
before any op logic runs.
"""

from pathlib import Path

import pytest
from osrlib.core.items import Coins
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.commands import AwardXP, GrantCoins, SetFlag
from osrlib.crawl.dungeon import AreaSpec, DungeonSpec, LevelSpec
from osrlib.crawl.quests import ObjectiveSpec, QuestSpec, TriggerClause
from osrlib.crawl.triggers import (
    AreaEnteredPattern,
    ItemAcquiredPattern,
    TownEnteredPattern,
    TriggerSpec,
)
from pydantic import ValidationError

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import OpInvariantError, OpTargetNotFoundError
from osreditor.ops import AddQuest, AnyEditOp, MoveQuest, OpBatch, RemoveQuest, SetQuest
from osreditor.projects import open_project
from osreditor.sidecar import SetNote
from osreditor.store import LocalProjectStore


def clause(**overrides: object) -> TriggerClause:
    values: dict[str, object] = {"pattern": TownEnteredPattern()}
    values.update(overrides)
    return TriggerClause.model_validate(values)


def objective(objective_id: str = "o-1", **overrides: object) -> ObjectiveSpec:
    values: dict[str, object] = {"id": objective_id, "when": clause()}
    values.update(overrides)
    return ObjectiveSpec.model_validate(values)


def quest(quest_id: str = "q-1", **overrides: object) -> QuestSpec:
    values: dict[str, object] = {"id": quest_id, "name": "The quest", "objectives": (objective(),)}
    values.update(overrides)
    return QuestSpec.model_validate(values)


def make_level() -> LevelSpec:
    return LevelSpec(number=1, width=3, height=3, entrance=(0, 0), areas=(AreaSpec(id="1", cells=((1, 1),)),))


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def make_project(
    service: DocumentService,
    tmp_path: Path,
    *,
    quests: tuple[QuestSpec, ...] = (),
    triggers: tuple[TriggerSpec, ...] = (),
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


def quest_ids(project: OpenProject) -> list[str]:
    return [entry.id for entry in project.adventure.quests]


# --- add / replace / remove ------------------------------------------------------


def test_add_appends_in_authored_order_with_the_quests_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest("first"),))
    result = commit(service, project, AddQuest(quest=quest("second")))
    assert quest_ids(project) == ["first", "second"]
    assert result.delta[0].path == "/quests"


def test_set_replaces_whole_value_with_the_quests_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest(),))
    replacement = quest(concludes_adventure=True, rewards=(SetFlag(key="k", value=True),))
    result = commit(service, project, SetQuest(quest_id="q-1", quest=replacement))
    assert project.adventure.quests == (replacement,)
    assert result.delta[0].path == "/quests"


def test_set_preserves_reward_order_committed_whole(service: DocumentService, tmp_path: Path) -> None:
    # Reward reorder needs no op: order rides the whole-value grain, and
    # rewards issue in authored order.
    ordered = (SetFlag(key="b", value=1), SetFlag(key="a", value=1))
    project = make_project(service, tmp_path, quests=(quest(rewards=ordered),))
    reordered = quest(rewards=(ordered[1], ordered[0]))
    commit(service, project, SetQuest(quest_id="q-1", quest=reordered))
    stored = project.adventure.quests[0].rewards
    assert [command.key for command in stored if isinstance(command, SetFlag)] == ["a", "b"]


def test_set_carries_objective_edits_whole(service: DocumentService, tmp_path: Path) -> None:
    # No objective op exists: add, remove, rename, and reorder all ride
    # SetQuest whole — the consequence-list grain.
    project = make_project(service, tmp_path, quests=(quest(objectives=(objective("a"), objective("b"))),))
    reshaped = quest(objectives=(objective("b"), objective("c", hidden=True)))
    commit(service, project, SetQuest(quest_id="q-1", quest=reshaped))
    stored = project.adventure.quests[0].objectives
    assert [entry.id for entry in stored] == ["b", "c"]
    assert stored[1].hidden is True


def test_set_targets_the_first_match_among_foreign_duplicates(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest(), quest(concludes_adventure=True)))
    commit(service, project, SetQuest(quest_id="q-1", quest=quest(completion="any")))
    assert [entry.completion for entry in project.adventure.quests] == ["any", "all"]
    assert [entry.concludes_adventure for entry in project.adventure.quests] == [False, True]


def test_remove_drops_the_quest_first_match(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest(concludes_adventure=True), quest()))
    result = commit(service, project, RemoveQuest(quest_id="q-1"))
    assert [entry.concludes_adventure for entry in project.adventure.quests] == [False]
    assert result.delta[0].path == "/quests"


def test_unknown_targets_are_targeting_misses(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpTargetNotFoundError, SetQuest(quest_id="ghost", quest=quest("ghost")))
    reject(service, project, OpTargetNotFoundError, RemoveQuest(quest_id="ghost"))
    reject(service, project, OpTargetNotFoundError, MoveQuest(quest_id="ghost", index=0))


def test_atomicity_a_failing_op_rejects_the_whole_batch(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpInvariantError,
        AddQuest(quest=quest("fine")),
        AddQuest(quest=quest("fine")),
    )
    assert project.adventure.quests == ()


def test_each_gesture_is_one_undo_step(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    commit(service, project, AddQuest(quest=quest("a")), AddQuest(quest=quest("b")))
    commit(service, project, RemoveQuest(quest_id="a"))
    assert quest_ids(project) == ["b"]
    service.undo(project)
    assert quest_ids(project) == ["a", "b"]
    service.undo(project)
    assert quest_ids(project) == []


# --- the uniqueness matrix --------------------------------------------------------


def test_add_rejects_a_duplicate_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest(),))
    error = reject(service, project, OpInvariantError, AddQuest(quest=quest()))
    assert "already has a quest" in str(error)


def test_rename_onto_a_duplicate_rejects(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest("editable"), quest("taken")))
    reject(service, project, OpInvariantError, SetQuest(quest_id="editable", quest=quest("taken")))


def test_a_foreign_duplicates_unchanged_id_carries_through(service: DocumentService, tmp_path: Path) -> None:
    # The invariant is "no op ever introduces a collision", not "no duplicated
    # document may be edited": the unchanged id never rejects, other fields
    # edit cleanly, and the finding stays a navigable diagnostic.
    project = make_project(service, tmp_path, quests=(quest(), quest()))
    result = commit(service, project, SetQuest(quest_id="q-1", quest=quest(completion="any")))
    assert project.adventure.quests[0].completion == "any"
    duplicates = [finding for finding in result.diagnostics.validation if finding.code == "quest_id_not_unique"]
    assert len(duplicates) == 1
    assert duplicates[0].address == "quest:q-1"


def test_trigger_id_overlap_is_explicitly_legal(service: DocumentService, tmp_path: Path) -> None:
    # Quest and trigger ids are separate namespaces with no cross-check —
    # the mirror of the trigger suite's overlap test.
    shared_trigger = TriggerSpec(id="shared", when=TownEnteredPattern())
    project = make_project(service, tmp_path, triggers=(shared_trigger,))
    result = commit(service, project, AddQuest(quest=quest("shared")))
    assert quest_ids(project) == ["shared"]
    assert result.diagnostics.validation == ()


def test_an_empty_id_rejects_at_request_parse() -> None:
    with pytest.raises(ValidationError):
        AddQuest.model_validate(
            {
                "op": "add_quest",
                "quest": {"id": "", "name": "The quest", "objectives": [objective_payload()]},
            }
        )


# --- MoveQuest --------------------------------------------------------------------


def test_move_to_the_front_middle_and_end(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest("a"), quest("b"), quest("c")))
    result = commit(service, project, MoveQuest(quest_id="c", index=0))
    assert quest_ids(project) == ["c", "a", "b"]
    assert result.delta[0].path == "/quests"
    commit(service, project, MoveQuest(quest_id="c", index=1))
    assert quest_ids(project) == ["a", "c", "b"]
    commit(service, project, MoveQuest(quest_id="c", index=2))
    assert quest_ids(project) == ["a", "b", "c"]


def test_a_same_position_move_applies_as_a_no_change_batch(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest("a"), quest("b")))
    result = commit(service, project, MoveQuest(quest_id="a", index=0))
    assert quest_ids(project) == ["a", "b"]
    assert result.revision == "r2"


def test_an_out_of_range_move_rejects_naming_the_range(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest("a"), quest("b")))
    error = reject(service, project, OpInvariantError, MoveQuest(quest_id="a", index=2))
    assert "positions 0 through 1" in str(error)


def test_a_negative_index_rejects_at_request_parse() -> None:
    with pytest.raises(ValidationError):
        MoveQuest.model_validate({"op": "move_quest", "quest_id": "a", "index": -1})


# --- the rename -------------------------------------------------------------------


def test_rename_keeps_the_quests_pointer_and_cascades_nowhere(service: DocumentService, tmp_path: Path) -> None:
    # No document field references a quest id, so a rename's delta stays
    # /quests — unlike the monster and item renames, whose cascades force
    # whole-document deltas.
    project = make_project(service, tmp_path, quests=(quest("old"),))
    result = commit(service, project, SetQuest(quest_id="old", quest=quest("new")))
    assert quest_ids(project) == ["new"]
    assert result.delta[0].path == "/quests"


def test_rename_remaps_the_sidecar_note_through_undo_and_redo(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, quests=(quest("old"),))
    service.apply_sidecar_patch(project, (SetNote(address="quest:old", text="Ours."),))
    commit(service, project, SetQuest(quest_id="old", quest=quest("new")))
    assert project.sidecar.notes == {"quest:new": "Ours."}
    service.undo(project)
    assert quest_ids(project) == ["old"]
    assert project.sidecar.notes == {"quest:old": "Ours."}
    service.redo(project)
    assert quest_ids(project) == ["new"]
    assert project.sidecar.notes == {"quest:new": "Ours."}


# --- parse-time rejections --------------------------------------------------------
# The model validators arrive free: the batch's mandatory re-validation and
# the request parse both run osrlib's own guards, so these shapes are 422s
# before any op logic runs — the gated-slide precedent extended to the quest
# shapes.


def when_town() -> dict[str, object]:
    return {"pattern": {"pattern_type": "town_entered"}}


def objective_payload(objective_id: str = "o-1", **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {"id": objective_id, "when": when_town()}
    payload.update(overrides)
    return payload


def quest_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {"id": "q", "name": "The quest", "objectives": [objective_payload()]}
    payload.update(overrides)
    return payload


def test_a_consuming_clause_condition_is_unrepresentable_at_parse() -> None:
    with pytest.raises(ValidationError, match="a quest observes, it does not take"):
        AddQuest.model_validate(
            {
                "op": "add_quest",
                "quest": quest_payload(
                    activation={
                        "pattern": {"pattern_type": "town_entered"},
                        "conditions": [{"condition_type": "has_item", "item_id": "key", "consumes": True}],
                    }
                ),
            }
        )


def test_a_source_carrying_reward_is_unrepresentable_at_parse() -> None:
    with pytest.raises(ValidationError, match="the issuing quest stamps it"):
        AddQuest.model_validate(
            {
                "op": "add_quest",
                "quest": quest_payload(
                    rewards=[{"command_type": "set_flag", "key": "k", "value": True, "source": "forged"}]
                ),
            }
        )


def test_duplicate_objective_ids_are_unrepresentable_at_parse() -> None:
    with pytest.raises(ValidationError, match="objective ids must be unique within the quest"):
        AddQuest.model_validate(
            {
                "op": "add_quest",
                "quest": quest_payload(objectives=[objective_payload("twin"), objective_payload("twin")]),
            }
        )


def test_a_reveal_clause_on_a_visible_objective_is_unrepresentable_at_parse() -> None:
    with pytest.raises(ValidationError, match="is not hidden, so reveal_when would never be read"):
        AddQuest.model_validate(
            {
                "op": "add_quest",
                "quest": quest_payload(objectives=[objective_payload(hidden=False, reveal_when=when_town())]),
            }
        )


def test_zero_objectives_are_unrepresentable_at_parse() -> None:
    # An objective-less quest under the all rule would be born complete.
    with pytest.raises(ValidationError):
        AddQuest.model_validate({"op": "add_quest", "quest": quest_payload(objectives=[])})


def test_an_empty_name_is_unrepresentable_at_parse() -> None:
    # A quest's name is mandatory, unlike an objective's.
    with pytest.raises(ValidationError):
        AddQuest.model_validate({"op": "add_quest", "quest": quest_payload(name="")})


def test_a_hidden_objective_without_a_reveal_clause_is_a_normal_shape(service: DocumentService, tmp_path: Path) -> None:
    # It surfaces by completing — no guard fires and the commit lands.
    project = make_project(service, tmp_path)
    commit(service, project, AddQuest(quest=quest(objectives=(objective(hidden=True),))))
    assert project.adventure.quests[0].objectives[0].hidden is True
    assert project.adventure.quests[0].objectives[0].reveal_when is None


def test_committed_rewards_round_trip_the_null_source(service: DocumentService, tmp_path: Path) -> None:
    # No form authors a source, and the serialized `source: null` in every
    # dumped command must round-trip untouched.
    project = make_project(service, tmp_path)
    commit(
        service,
        project,
        AddQuest(
            quest=quest(
                rewards=(
                    GrantCoins(character_id="@party", coins=Coins(gp=100)),
                    AwardXP(character_id="@party", amount=200),
                )
            )
        ),
    )
    payload = project.adventure.model_dump(mode="json")
    assert [command["source"] for command in payload["quests"][0]["rewards"]] == [None, None]
    reopened = open_project(DocumentService(LocalProjectStore()), project.path)
    assert reopened.adventure.quests == project.adventure.quests


def test_dangling_references_are_diagnostics_not_rejections(service: DocumentService, tmp_path: Path) -> None:
    # The tier rule: dangling clause references are legal while editing.
    project = make_project(service, tmp_path)
    dangling = quest(
        activation=clause(pattern=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id="ghost")),
        objectives=(objective(when=clause(pattern=ItemAcquiredPattern(item_id="ghost-idol"))),),
    )
    result = commit(service, project, AddQuest(quest=dangling))
    codes = [finding.code for finding in result.diagnostics.validation]
    assert "quest_pattern_unknown_area" in codes
    assert "quest_pattern_unknown_item" in codes


def test_a_standing_charge_survives_a_full_round_trip(service: DocumentService, tmp_path: Path) -> None:
    # activation=None is the standing charge — active from the session's
    # first moment, serialized and reloaded unchanged.
    standing = quest("standing", completion="any")
    assert standing.activation is None
    project = make_project(service, tmp_path)
    commit(service, project, AddQuest(quest=standing))
    reopened = open_project(DocumentService(LocalProjectStore()), project.path)
    assert reopened.adventure.quests == (standing,)
