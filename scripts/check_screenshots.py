"""Guard the documentation screenshots: docs references, committed files, and the harness agree.

Three directions are checked, because each catches a failure the others cannot:

1. **docs → files.** Every `assets/screenshots/*.png` a page references exists. `mkdocs build
   --strict` already catches this; the script repeats it so a failure is legible without a
   full site build.
2. **files → docs.** Every committed PNG is referenced by at least one page. mkdocs cannot
   see this direction, so without it an orphaned image lingers forever.
3. **harness → docs** (only with `--produced`). The slug set the capture harness just wrote
   equals the slug set the docs reference. Without this direction, deleting a shot's test
   leaves the committed PNG, the docs reference, and mkdocs all perfectly satisfied while
   the shot silently loses its gate.

Run as `uv run python scripts/check_screenshots.py [--produced MANIFEST]`. Every failure is
collected before exiting, so one run reports the whole picture.
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_ROOT = REPO_ROOT / "docs"
SHOTS_DIR = DOCS_ROOT / "assets" / "screenshots"

# The design documents live in docs/ beside the site pages but are not published;
# mkdocs.yml's exclude_docs holds the same set.
UNPUBLISHED = ("spec.md", "backlog.md")

# Derived from measurement, not taste: a full capture of the 26 shots measured 4.4 MB
# (2026-07-25, both themes, deviceScaleFactor 2, four full-window). The ceiling sits
# above that with room for a dozen more shots, and near the repository's own history
# (.git is ~10 MB), so a careless addition trips it rather than quietly doubling the
# clone size. If it ever trips, the levers in order are a per-image ceiling of 400 KB
# and then a lossless `oxipng` pass — not a lower deviceScaleFactor, which is a
# browser-context option and cannot be set per shot without regrouping the spec files.
WEIGHT_BUDGET_BYTES = 10 * 1024 * 1024

# ![alt text](path/to/image.png#only-light)
IMAGE_PATTERN = re.compile(r"!\[(?P<alt>[^\]]*)\]\((?P<target>[^)\s]+)\)")

THEMES = ("light", "dark")


def published_pages() -> list[Path]:
    """Return every published Markdown page under `docs/`."""
    return sorted(
        path for path in DOCS_ROOT.rglob("*.md") if path.name not in UNPUBLISHED and not path.name.startswith("phase-")
    )


def slug_of(png_name: str) -> str | None:
    """Return the shot slug behind a `<slug>-<theme>.png` filename, or None if it is malformed."""
    stem = Path(png_name).stem
    for theme in THEMES:
        if stem.endswith(f"-{theme}"):
            return stem[: -len(theme) - 1]
    return None


def png_size(path: Path) -> tuple[int, int]:
    """Return a PNG's pixel dimensions, read straight from its IHDR chunk.

    Stdlib only, deliberately: the whole script depends on nothing outside the standard
    library, and a size check is not worth a Pillow dependency.
    """
    header = path.read_bytes()[16:24]
    return int.from_bytes(header[:4], "big"), int.from_bytes(header[4:], "big")


def check_references(failures: list[str]) -> set[str]:
    """Check every screenshot reference across the published pages, returning the slugs seen."""
    referenced_slugs: set[str] = set()
    referenced_files: set[Path] = set()

    for page in published_pages():
        rel_page = page.relative_to(REPO_ROOT)
        for match in IMAGE_PATTERN.finditer(page.read_text(encoding="utf-8")):
            target = match.group("target")
            path_part, _, fragment = target.partition("#")
            if "assets/screenshots/" not in path_part:
                continue

            resolved = (page.parent / path_part).resolve()
            referenced_files.add(resolved)

            if not match.group("alt").strip():
                failures.append(f"{rel_page}: '{path_part}' has empty alt text")

            if not resolved.is_file():
                failures.append(f"{rel_page}: references '{path_part}', which does not exist")

            slug = slug_of(resolved.name)
            if slug is None:
                failures.append(f"{rel_page}: '{resolved.name}' does not end in '-light.png' or '-dark.png'")
                continue
            referenced_slugs.add(slug)

            # The theme suffix and the filename must agree, or the reader gets the wrong
            # image in one of the two themes and nothing anywhere complains.
            theme = resolved.stem.rsplit("-", 1)[1]
            if fragment != f"only-{theme}":
                found = f"found '#{fragment}'" if fragment else "found no suffix"
                failures.append(f"{rel_page}: '{resolved.name}' must carry the '#only-{theme}' suffix, {found}")

    for slug in sorted(referenced_slugs):
        twins = {theme: SHOTS_DIR / f"{slug}-{theme}.png" for theme in THEMES}
        for theme, twin in twins.items():
            if not twin.is_file():
                failures.append(f"shot '{slug}' is missing its {theme} twin ({twin.name})")
        if all(twin.is_file() for twin in twins.values()):
            sizes = {theme: png_size(twin) for theme, twin in twins.items()}
            if len(set(sizes.values())) > 1:
                # Material swaps the two by CSS, so a reader toggling theme would
                # see the page reflow around a differently shaped image.
                rendered = ", ".join(f"{theme} {w}x{h}" for theme, (w, h) in sizes.items())
                failures.append(f"shot '{slug}' has mismatched twin dimensions ({rendered})")

    for committed in sorted(SHOTS_DIR.glob("*.png")):
        if committed.resolve() not in referenced_files:
            failures.append(f"{committed.name} is committed but no published page references it")

    return referenced_slugs


def check_weight(failures: list[str]) -> None:
    """Check the screenshot directory against the weight budget."""
    total = sum(path.stat().st_size for path in SHOTS_DIR.glob("*.png"))
    if total > WEIGHT_BUDGET_BYTES:
        failures.append(
            f"screenshots total {total / 1024 / 1024:.1f} MB, over the "
            f"{WEIGHT_BUDGET_BYTES / 1024 / 1024:.0f} MB budget"
        )


def check_produced(manifest: Path, referenced_slugs: set[str], failures: list[str]) -> None:
    """Check that the harness produced exactly the images the docs reference.

    The manifest is what the harness *reported running*, one `<slug>-<theme>` per line, not a
    listing of `docs/assets/screenshots/`. Comparing the directory would be inert: the harness
    writes into it, but it arrives from git already holding every committed PNG, so a deleted
    shot's images are still on disk, still referenced, and the comparison is tautologically green.

    Entries are per theme rather than per slug so a shot skipped under one project only still
    fails, instead of being covered by its twin from the other.
    """
    if not manifest.is_file():
        failures.append(f"--produced manifest does not exist: {manifest}")
        return

    produced = {line.strip() for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()}
    expected = {f"{slug}-{theme}" for slug in referenced_slugs for theme in THEMES}
    for name in sorted(expected - produced):
        failures.append(
            f"'{name}' is referenced by the docs but the harness no longer produces it — "
            "its test was deleted, skipped, or renamed"
        )
    for name in sorted(produced - expected):
        failures.append(f"'{name}' was captured but no published page references it")


def main() -> int:
    parser = argparse.ArgumentParser(description="Guard the documentation screenshots.")
    parser.add_argument(
        "--produced",
        type=Path,
        metavar="MANIFEST",
        help="the manifest of slugs the capture harness reported running, checked against the docs' slug set",
    )
    args = parser.parse_args()

    if not SHOTS_DIR.is_dir():
        print(f"no screenshot directory at {SHOTS_DIR.relative_to(REPO_ROOT)}", file=sys.stderr)
        return 1

    failures: list[str] = []
    referenced_slugs = check_references(failures)
    check_weight(failures)
    if args.produced is not None:
        check_produced(args.produced, referenced_slugs, failures)

    if failures:
        print(f"{len(failures)} screenshot problem(s):", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(f"screenshots OK: {len(referenced_slugs)} shots, both themes, all referenced")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
