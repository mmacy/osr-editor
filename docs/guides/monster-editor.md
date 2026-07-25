# The monster editor

The **Monsters** section (beside Adventure and Town, in both project types) stocks the adventure's bundled monster templates — bespoke stat blocks that join osrlib's shipped catalog for this adventure's sessions, everywhere template ids resolve.

## Creating a template

Create from scratch — a model-valid stock 1-HD block the detail editor then reshapes — or clone-and-modify any catalog monster: "like an orc, but…". The monster picker's create shortcut starts the same flow from an encounter card, so a missing monster never breaks your stocking stride.

## The detail editor

The always-saved detail editor covers the whole stat block: the AC pair gated by the attack-roll toggle, the hit-dice builder, ordered attack routines, movement modes, saves, morale and alternates, alignment, XP notes, dice/fixed/see-below number appearing, the treasure reference, abilities with typed params, defenses, and categories. Dice inputs check locally as you type; the server's parse is the authority. The derive-from-HD buttons fill XP, the THAC0/attack-bonus pair, and the save band from the hit dice — see [authoring aids](authoring-aids.md).

## Identity and references

A template id colliding with the shipped catalog or another bundled template is refused at commit with an inline rename prompt — foreign documents already carrying a collision stay editable, with the finding navigable. Renaming a template rewrites every keyed-encounter line and wandering row that names it in one undo step, and its author note follows. Removing a referenced template warns with the reference count first; the references become ordinary diagnostics, never silent loss.

Bundled templates rank first in every picker and ride publish into osr-web unchanged.

## In forge-backed projects

A forge-backed project derives its monster bundle from the conversion, so the authoring gestures offer [detach](forge-backed-review.md) in place, and the review chrome's **Monster resolution** panel is where conversion-side fixes happen — remap a name to a catalog monster, or correct the printed stat block in the page's own notation.
