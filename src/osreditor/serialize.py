"""The canonical JSON byte format, in one leaf module.

The canonical form is byte-compatible with osr-forge's `write_json_artifact`:
`json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False)` plus a trailing
newline, UTF-8. `sort_keys=False` is the load-bearing half — pydantic dumps
fields in declaration order and `json.loads` preserves insertion order, so
write → reopen → re-dump is byte-stable with no sorting anywhere.

This lives apart from `documents.py` so both the document layer and the sidecar
layer can share it without an import cycle — the sidecar is written by the forge
commit protocol in `documents.py`, and the document layer never imports the
sidecar.
"""

import json
from collections.abc import Mapping

__all__ = ["canonical_json_bytes"]


def canonical_json_bytes(data: Mapping[str, object]) -> bytes:
    """Serialize a mapping in the canonical byte format.

    Args:
        data: The JSON-ready mapping (typically a stamped document or a sidecar).

    Returns:
        UTF-8 bytes: 2-space indent, `ensure_ascii=False`, keys in insertion
        order, trailing newline.
    """
    return (json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n").encode("utf-8")
