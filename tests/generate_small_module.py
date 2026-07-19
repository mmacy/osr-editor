"""Regenerate the committed small-module fixture from its builder.

Run only on a deliberate, reviewed osrlib document-shape change — never as a
fix for an ununderstood red test:

    uv run python tests/generate_small_module.py
"""

from osreditor.documents import dump_adventure
from test_small_module import SMALL_MODULE_PATH, build_small_module


def main() -> None:
    """Write the fixture bytes."""
    SMALL_MODULE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SMALL_MODULE_PATH.write_bytes(dump_adventure(build_small_module()))
    print(f"wrote {SMALL_MODULE_PATH}")


if __name__ == "__main__":
    main()
