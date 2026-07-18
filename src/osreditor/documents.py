"""Canonical adventure serialization: the stamped-document load/dump contract.

The canonical form is byte-compatible with osr-forge's `write_json_artifact`:
`json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False)` plus a trailing
newline, UTF-8. `sort_keys=False` is the load-bearing half — pydantic dumps fields
in declaration order and `json.loads` preserves insertion order, so
write → reopen → re-dump is byte-stable with no sorting anywhere.

The byte-identity promise covers documents the editor wrote under the same
installed osrlib: re-stamping under a different engine version changes
`engine_version`, so a foreign or older-engine document normalizes on its first
write — one honest diff, exactly the spec's carve-out.

osrlib owns the envelope and its checking. [`load_adventure`][osreditor.documents.load_adventure]
propagates osrlib's errors untranslated — `SaveVersionError` on a newer
`schema_version`, `ContentValidationError` on a wrong kind or malformed envelope —
and the API layer attaches remedies; the editor never re-implements envelope checking.
"""

import json
from collections.abc import Mapping

from osrlib.crawl.adventure import Adventure
from osrlib.versioning import check_document, stamp_document

__all__ = [
    "canonical_json_bytes",
    "dump_adventure",
    "load_adventure",
]


def canonical_json_bytes(data: Mapping[str, object]) -> bytes:
    """Serialize a mapping in the canonical byte format.

    Args:
        data: The JSON-ready mapping (typically a stamped document).

    Returns:
        UTF-8 bytes: 2-space indent, `ensure_ascii=False`, keys in insertion
        order, trailing newline.
    """
    return (json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n").encode("utf-8")


def dump_adventure(adventure: Adventure) -> bytes:
    """Serialize an adventure to canonical stamped-document bytes.

    Args:
        adventure: The adventure to serialize.

    Returns:
        The stamped `"adventure"` document in canonical bytes, stamped at the
        installed osrlib's current schema and engine versions.
    """
    document = stamp_document("adventure", adventure.model_dump(mode="json"))
    return canonical_json_bytes(document)


def load_adventure(data: bytes) -> Adventure:
    """Load an adventure from stamped-document bytes.

    Args:
        data: The serialized document, as produced by
            [`dump_adventure`][osreditor.documents.dump_adventure] or any
            osrlib-family writer.

    Returns:
        The validated adventure.

    Raises:
        osrlib.errors.ContentValidationError: If the envelope is malformed or the
            kind is not `"adventure"`.
        osrlib.errors.SaveVersionError: If the document's `schema_version` is
            newer than the installed osrlib understands.
        pydantic.ValidationError: If the payload fails model validation.
    """
    document = json.loads(data)
    payload = check_document(document, "adventure")
    return Adventure.model_validate(payload)
