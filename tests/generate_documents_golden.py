"""Write the committed golden adventure fixture.

Run only on a deliberate regeneration (an intended osrlib document-shape change):
`uv run python tests/generate_documents_golden.py`. The committed bytes are the
osrlib compatibility gate — regenerating them is a reviewed decision, never a fix
for a red test whose cause is not understood.
"""

from osreditor.documents import dump_adventure
from test_documents import GOLDEN_PATH, build_golden_adventure


def main() -> None:
    GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN_PATH.write_bytes(dump_adventure(build_golden_adventure()))
    print(f"wrote {GOLDEN_PATH}")


if __name__ == "__main__":
    main()
