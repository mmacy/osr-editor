"""Prove the built wheel installs and serves the editor in a clean environment.

Run this with a fresh venv's interpreter after installing the wheel by path
into that venv — never against the repository checkout, and it imports nothing
from `tests/`. It asserts the import resolves under site-packages rather than
a shadowing checkout, that installed metadata matches the expected version,
that the `osreditor.importers` entry-point group survived packaging with
exactly the two bundled converters, that both runtime dependencies resolved
as published artifacts, and then the behavior check this phase exists for:
the installed `osr-editor` console script — the script itself is under test,
not just the package — boots, answers `/api/status` with the expected
versions, and serves the built UI from `/`. A static-less wheel boots
healthy and 404s the UI (the backend mounts static only when the directory
exists, so a dev backend can run unbuilt), which is exactly why fetching `/`
is the one check that catches the packaging failure. Loopback only, no
browser, no network beyond localhost.

Usage:
    <fresh-venv-python> scripts/release/install_smoke.py EXPECTED_VERSION
"""

import argparse
import importlib.metadata
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def check_resolution(expected_version: str) -> None:
    """Assert osreditor resolves from site-packages at the expected version."""
    import osreditor

    location = Path(osreditor.__file__).resolve()
    assert "site-packages" in location.parts, f"osreditor resolved outside site-packages: {location}"
    installed = importlib.metadata.version("osr-editor")
    assert installed == expected_version, f"installed metadata reports {installed}, expected {expected_version}"
    print(f"ok: osreditor {installed} imported from {location.parent}")


def check_importer_entry_points() -> None:
    """Assert the importer seam's registrations survived packaging."""
    entries = sorted(entry.name for entry in importlib.metadata.entry_points(group="osreditor.importers"))
    assert entries == ["project", "watabou-opd"], f"osreditor.importers entry points are {entries}"
    print("ok: the osreditor.importers entry-point group lists exactly project and watabou-opd")


def check_dependencies_resolve() -> None:
    """Assert both runtime dependencies installed as published artifacts."""
    import osrforge  # noqa: F401  — resolving the import is the check

    print(f"ok: osr-forge {importlib.metadata.version('osr-forge')} resolved")

    from osrlib.data import load_monsters

    catalog = load_monsters()
    assert catalog.monsters, "the osrlib monster catalog loaded empty"
    print(f"ok: osrlib {importlib.metadata.version('osrlib')} resolved with {len(catalog.monsters)} monsters")


def free_port() -> int:
    """Learn a free loopback port by binding port 0 and releasing it."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def fetch(url: str, timeout: float = 5.0) -> tuple[int, bytes]:
    """GET a loopback URL, returning status and body."""
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.status, response.read()


def check_editor_serves(expected_version: str) -> None:
    """Boot the installed console script and assert it serves the API and the UI."""
    script = Path(sys.executable).parent / "osr-editor"
    assert script.exists(), f"console script not installed at {script}"
    port = free_port()
    process = subprocess.Popen(
        [str(script), "--no-browser", "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        status: dict[str, object] | None = None
        for _ in range(100):
            if process.poll() is not None:
                output = process.stdout.read().decode("utf-8", errors="replace") if process.stdout else ""
                raise AssertionError(f"osr-editor exited early with code {process.returncode}:\n{output}")
            try:
                code, body = fetch(f"http://127.0.0.1:{port}/api/status")
            except urllib.error.URLError, ConnectionError, TimeoutError:
                time.sleep(0.2)
                continue
            assert code == 200, f"/api/status answered {code}"
            status = json.loads(body)
            break
        assert status is not None, "osr-editor never answered /api/status"
        assert status["editor_version"] == expected_version, f"/api/status reports {status['editor_version']!r}"
        assert status.get("engine_version"), "/api/status carries no engine_version"
        assert status.get("schema_version"), "/api/status carries no schema_version"
        print(f"ok: the console script serves /api/status as osr-editor {expected_version}")

        code, body = fetch(f"http://127.0.0.1:{port}/")
        assert code == 200, f"/ answered {code} — the wheel does not serve the UI"
        page = body.decode("utf-8", errors="replace")
        assert "<!doctype html" in page.lower(), "/ did not answer an HTML document"
        assert "/assets/" in page, "/ serves HTML that references no built Vite assets"
        print("ok: / serves the built frontend from the wheel")
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main() -> int:
    """Run every smoke check in order.

    Returns:
        0 when the installed wheel passes; assertions abort otherwise.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="the expected package version, e.g. 0.1.0")
    args = parser.parse_args()

    check_resolution(args.version)
    check_importer_entry_points()
    check_dependencies_resolve()
    check_editor_serves(args.version)
    print(f"install smoke passed: osr-editor {args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
