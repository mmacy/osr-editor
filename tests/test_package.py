"""The package imports and carries its typing marker."""

from importlib import resources

import osreditor


def test_package_imports() -> None:
    assert osreditor.__doc__ is not None


def test_py_typed_ships() -> None:
    assert resources.files("osreditor").joinpath("py.typed").is_file()
