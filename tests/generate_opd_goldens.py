"""Write the committed One Page Dungeon payload goldens.

Run only on a deliberate regeneration (an intended conversion change):
`uv run python tests/generate_opd_goldens.py`. The committed bytes are the
whole-payload record of what the reader makes of each fixture — regenerating
them is a reviewed decision, never a fix for a red test whose cause is not
understood.
"""

from osreditor.documents import canonical_json_bytes
from osreditor.importers.watabou import OPDImporter
from test_importers_watabou import GOLDEN_PATHS, NOMINAL, TORTURE


def main() -> None:
    for name, source in (("nominal", NOMINAL), ("torture", TORTURE)):
        path = GOLDEN_PATHS[name]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(canonical_json_bytes(OPDImporter().load(source).model_dump(mode="json")))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
