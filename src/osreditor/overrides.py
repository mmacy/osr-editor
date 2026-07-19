"""The op→override translator and `overrides.yaml` serialization.

A forge project's document is derived state: the editor never writes
`adventure.json`, only `overrides.yaml`, and re-runs `assemble` to rebuild.
Every editor gesture that would mutate a native document instead translates to a
merged, reasoned override entry here, and this module serializes the resulting
`Overrides` value to the bytes forge's `load_overrides` reads back.

The translator proper — `translate_batch` and its per-op table, the blocked-op
list, the entry-merge algebra, and reason drafting — lands with the forge commit
protocol; this module also owns the deterministic serializer and the
kind-qualified entry keys the sidecar's `auto_reasons` set tracks.
"""

import yaml
from osrforge.contracts.overrides import Overrides

__all__ = [
    "auto_reason_key",
    "serialize_overrides",
]


def serialize_overrides(overrides: Overrides) -> bytes:
    """Serialize an `Overrides` value to the `overrides.yaml` bytes forge accepts.

    pyyaml with `sort_keys=False`, block style, kinds in `Overrides` field order,
    plain strings, trailing newline. `exclude_unset=True` is load-bearing: it
    carries the pinned absent-vs-null semantics through unchanged — a field the
    editor never set is omitted (untouched), an explicitly-`None` field emits
    `null` (clear). Entry order is insertion order (never a sort), the one
    ordering rule `build_draft` and `render_previews` must agree on. Comments in
    a pre-existing hand-authored file are not preserved — the honest
    normalize-on-first-write posture, with the `reason` fields as the record.

    Args:
        overrides: The override value to serialize.

    Returns:
        The UTF-8 YAML bytes, round-tripped by test through forge's own
        `load_overrides`.
    """
    data = overrides.model_dump(mode="json", exclude_unset=True)
    text = yaml.safe_dump(data, sort_keys=False, default_flow_style=False, allow_unicode=True, width=4096)
    return text.encode("utf-8")


def auto_reason_key(kind: str, key: str | None = None) -> str:
    """Build the kind-qualified override-entry key the sidecar's `auto_reasons` set tracks.

    The set records which entries still carry a machine-drafted reason, so a
    human-composed reason survives later merges. `town` and `module` are
    singletons and carry no entry key.

    Args:
        kind: The override kind — `monsters`, `monster_templates`, `areas`,
            `geometry`, `town`, or `module`.
        key: The entry key (an address or normalized name); `None` for the
            `town`/`module` singletons.

    Returns:
        `<kind>` for a singleton, else `<kind>:<key>`.
    """
    return kind if key is None else f"{kind}:{key}"
