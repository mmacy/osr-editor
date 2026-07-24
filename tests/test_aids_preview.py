"""The preview route: XOR validation, seeded determinism, resolution, and derived goldens.

Previews are pure reads: no revision, no document mutation. The sampling kinds take
an optional seed so the goldens are deterministic; the statblock kind is derived
straight from the shipped tables.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from osreditor.app import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture
def project(client: TestClient, tmp_path: Path) -> dict:
    return client.post("/api/projects", json={"path": str(tmp_path / "p.osr"), "name": "Demo"}).json()


def preview(client: TestClient, pid: str, body: dict):
    return client.post(f"/api/projects/{pid}/aids/preview", json=body)


class TestTreasurePreview:
    def test_letters_xor_unguarded_is_enforced(self, client: TestClient, project: dict) -> None:
        both = preview(client, project["id"], {"kind": "treasure", "letters": ["A"], "unguarded_level": 3})
        assert both.status_code == 422 and both.json()["error"]["code"] == "request_invalid"
        neither = preview(client, project["id"], {"kind": "treasure"})
        assert neither.status_code == 422

    def test_seeded_samples_are_deterministic(self, client: TestClient, project: dict) -> None:
        body = {"kind": "treasure", "letters": ["A"], "tier": "expert", "samples": 3, "seed": "99"}
        first = preview(client, project["id"], body).json()
        second = preview(client, project["id"], body).json()
        assert first == second
        assert len(first["samples"]) == 3
        # A total-gp line rides every sample, and coins carry the five denominations.
        assert all("total_gp" in sample for sample in first["samples"])
        assert set(first["samples"][0]["coins"]) == {"pp", "gp", "ep", "sp", "cp"}

    def test_magic_items_carry_resolved_names(self, client: TestClient, project: dict) -> None:
        # Scan seeds for a sample that generated a magic item, then assert its name resolved.
        for seed in range(30):
            body = {"kind": "treasure", "letters": ["A"], "tier": "expert", "samples": 1, "seed": str(seed)}
            sample = preview(client, project["id"], body).json()["samples"][0]
            if sample["magic_items"]:
                item = sample["magic_items"][0]
                assert item["name"] and item["name"] != item["template_id"]
                return
        raise AssertionError("no magic item generated within the seed budget")

    def test_unguarded_band_previews(self, client: TestClient, project: dict) -> None:
        response = preview(client, project["id"], {"kind": "treasure", "unguarded_level": 5, "samples": 2, "seed": "1"})
        assert response.status_code == 200 and len(response.json()["samples"]) == 2

    def test_samples_are_bounded(self, client: TestClient, project: dict) -> None:
        too_many = preview(client, project["id"], {"kind": "treasure", "letters": ["A"], "samples": 11})
        assert too_many.status_code == 422


class TestEncounterPreview:
    def test_lines_resolve_and_sample(self, client: TestClient, project: dict) -> None:
        encounter = {"monsters": [{"template_id": "goblin", "count_dice": "2d4"}]}
        body = {"kind": "encounter", "encounter": encounter, "samples": 3, "seed": "5"}
        response = preview(client, project["id"], body).json()
        line = response["lines"][0]
        assert line["resolution"] == "shipped" and line["name"] == "Goblin"
        assert line["thac0"] == 19 and line["hit_dice"] is not None
        assert len(line["sampled_counts"]) == 3 and all(1 <= count <= 8 for count in line["sampled_counts"])
        # Per-sample XP totals track the goblin's 5 XP times the sampled counts.
        assert response["sample_xp_totals"] == [count * 5 for count in line["sampled_counts"]]

    def test_a_dangling_id_previews_as_unresolved(self, client: TestClient, project: dict) -> None:
        encounter = {"monsters": [{"template_id": "no_such_monster", "count_fixed": 2}]}
        response = preview(client, project["id"], {"kind": "encounter", "encounter": encounter}).json()
        line = response["lines"][0]
        assert line["resolution"] == "unresolved" and line["thac0"] is None
        assert line["sampled_counts"] == [2, 2, 2]  # fixed count, samples default 3

    def test_a_bundled_template_resolves_as_bundled(self, client: TestClient, project: dict) -> None:
        template = {
            "id": "bespoke-1",
            "name": "Bespoke horror",
            "page": "",
            "ac": 5,
            "ac_ascending": 14,
            "hit_dice": {"count": 3, "die": 8},
            "attacks": [{"attacks": [{"name": "claw", "by_weapon": False, "damage_dice": "1d6"}]}],
            "thac0": 17,
            "attack_bonus": 2,
            "movement": [{"rate_feet": 120, "encounter_rate_feet": 40}],
            "saves": {
                "values": {"death": 12, "wands": 13, "paralysis": 14, "breath": 15, "spells": 16},
                "save_as": "3",
            },
            "morale": 9,
            "alignment": {"options": ["chaotic"]},
            "xp": 50,
            "number_appearing": {"dungeon": {"dice": "1d4"}, "lair": {"dice": "1d6"}},
        }
        added = client.post(
            f"/api/projects/{project['id']}/ops",
            json={"revision": project["revision"], "ops": [{"op": "add_monster_template", "template": template}]},
        )
        assert added.status_code == 200
        encounter = {"monsters": [{"template_id": "bespoke-1", "count_fixed": 1}]}
        response = preview(client, project["id"], {"kind": "encounter", "encounter": encounter}).json()
        assert response["lines"][0]["resolution"] == "bundled" and response["lines"][0]["name"] == "Bespoke horror"


class TestStatblockPreview:
    def test_derives_from_hit_dice(self, client: TestClient, project: dict) -> None:
        # 2+2** derives against the shipped combat tables.
        body = {"kind": "statblock", "hit_dice": {"count": 2, "die": 8, "modifier": 2, "asterisks": 1}}
        response = preview(client, project["id"], body).json()
        assert response["xp"] == 35
        assert response["thac0"] == 17 and response["attack_bonus"] == 2
        assert response["save_band"] == "1–3"
        assert response["saves"] == {"death": 12, "wands": 13, "paralysis": 14, "breath": 15, "spells": 16}

    def test_matches_a_shipped_monster(self, client: TestClient, project: dict) -> None:
        # The goblin's own hit dice derive its printed THAC0/attack-bonus pair.
        goblin = client.get("/api/catalogs/monsters/goblin").json()
        body = {"kind": "statblock", "hit_dice": goblin["hit_dice"]}
        response = preview(client, project["id"], body).json()
        assert (response["thac0"], response["attack_bonus"]) == (goblin["thac0"], goblin["attack_bonus"])
