# The item editor

The **Items** section (beside Monsters, in the nav) stocks the adventure's bundled item templates — bespoke equipment that joins osrlib's shipped catalog for this adventure's sessions, everywhere item ids resolve: treasure caches, gates, and the authored layer's triggers and quests as those surfaces arrive.

## Creating a template

Create from scratch — a model-valid stock template of the chosen kind (weapon, armour, gear, or ammunition) the detail form then reshapes — or clone-and-modify any catalog item: "like a torch, but…". A bundled item's id must be free across the full collision domain — shipped equipment, shipped magic items, and the rest of the bundle — because an item id names one thing per session; the clone prefill walks to the next free `<source-id>-<n>` over exactly that domain, so it never lands on a rejection.

![The items section: the bundled item list beside the per-kind detail form](../assets/screenshots/items-section-light.png#only-light)
![The items section: the bundled item list beside the per-kind detail form](../assets/screenshots/items-section-dark.png#only-dark)

## The detail forms

The always-saved detail editor shows one form per kind, covering its whole model:

- **Weapon** — cost, weight, damage (checked locally as you type; the server's parse is the authority), the quality set, and material. Ticking the **missile** quality seeds a neutral three-band range spread in the same gesture, and unticking it clears the ranges — the two travel together because the model requires them together.
- **Armour** — a body/shield choice that swaps the field sets whole: body armour carries the descending and ascending AC pair with an encumbrance category, the shield carries an AC bonus alone. The form makes the wrong combination unrepresentable.
- **Gear** — cost, lot size, optional container capacity, an optional combat facet (the torch-and-holy-water construction: damage, qualities, ranges), and structured params as key/value rows — a value that parses as JSON commits typed, anything else commits as a plain string.
- **Ammunition** — cost, lot size, weight, and material.

![The gear detail form for the miller's brass key: cost, lot size, capacity, the combat facet disclosure, and params](../assets/screenshots/item-detail-light.png#only-light)
![The gear detail form for the miller's brass key: cost, lot size, capacity, the combat facet disclosure, and params](../assets/screenshots/item-detail-dark.png#only-dark)

## Identity and references

An id colliding with shipped equipment, shipped magic, or another bundled template is refused at commit with an inline rename prompt — foreign documents already carrying a collision stay editable, with the finding navigable. Renaming a template rewrites every reference that names it in one undo step: cache item lists, `has_item` conditions on [door and transition gates](map-editor.md#gates), and any authored-layer sites a document carries — and its author note follows. Removing a referenced template warns with the reference count first; the references become ordinary diagnostics, never silent loss.

Bundled items rank first in the pickers that serve their domain — the treasure-cache item picker under a "This adventure" group, and the gate condition picker beside the shipped equipment and magic items — and ride publish into osr-web unchanged.

## In forge-backed projects

A forge-assembled adventure can never carry bundled items: the overrides vocabulary has no authored-layer surface, a deliberate gap recorded at [osr-forge#39](https://github.com/mmacy/osr-forge/issues/39). The Items entry stays present and navigates to that explanation, with [detach](forge-backed-review.md) offered in place — there is no list to render, so the explanation is the honest section body.
