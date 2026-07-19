"""Write the committed doors-and-transitions torture fixture.

Run only on a deliberate regeneration (an intended osrlib document-shape change):
`uv run python tests/generate_torture_fixture.py`. The committed bytes serve the
lint suite, the round-trip byte-stability suite, the import tests, and phase 5's
forge-parity test — regenerating them is a reviewed decision, never a fix for a
red test whose cause is not understood.
"""

from osreditor.documents import dump_adventure
from test_lint import TORTURE_PATH, build_torture_adventure


def main() -> None:
    TORTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    TORTURE_PATH.write_bytes(dump_adventure(build_torture_adventure()))
    print(f"wrote {TORTURE_PATH}")


if __name__ == "__main__":
    main()
