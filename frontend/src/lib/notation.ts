// Module-notation formatters — the one rendering vocabulary shared by the
// cards' collapsed summaries, the map hover line, and the context menu. Pure
// functions over the generated types; monospace-honest module notation. The
// multiplication form (`3d4 × orc`) deliberately sidesteps English
// pluralization: catalog names are singular, and naive pluralization lies
// ("thiefs").
import type {
  AreaTreasureSpec,
  Coins,
  FeatureSpec,
  KeyedEncounter,
  KeyedMonster,
  MonsterHitDice,
  TrapEffect,
  TrapSpec,
  ValuableSpec,
  WanderingSpec,
} from '@/types'

// The documented dice grammar, mirrored for immediate field feedback: NdS with
// an optional +M/-M modifier and ×K multiplier (x/* aliases), N defaulting 1,
// d% as d100, sides in the closed set, canonical ASCII digits, no leading
// zeros. The mirror is convenience, not authority — the server's parse at
// request validation remains the gate (the phase 2 edge-key-mirror rule).
const DICE_PATTERN =
  /^([1-9][0-9]{0,2})?d(%|[1-9][0-9]{0,2})([+-](?:0|[1-9][0-9]{0,5}))?(?:[x×*]([1-9][0-9]{0,5}))?$/i
const ALLOWED_SIDES = new Set([2, 3, 4, 6, 8, 10, 12, 20, 100])

export interface DiceExpression {
  count: number
  sides: number
  modifier: number
  multiplier: number
}

export function parseDice(text: string): DiceExpression | null {
  const match = DICE_PATTERN.exec(text.trim())
  if (!match) return null
  const sides = match[2] === '%' ? 100 : Number(match[2])
  if (!ALLOWED_SIDES.has(sides)) return null
  return {
    count: match[1] ? Number(match[1]) : 1,
    sides,
    modifier: match[3] ? Number(match[3]) : 0,
    multiplier: match[4] ? Number(match[4]) : 1,
  }
}

// The variant_dice span rule mirrored (osrlib tables.py): the dice must span
// exactly the pool's size with no multiplier. Returns the span, or null when
// the expression doesn't parse or carries a multiplier.
export function variantDiceSpan(text: string): number | null {
  const dice = parseDice(text)
  if (!dice || dice.multiplier !== 1) return null
  return dice.count * (dice.sides - 1) + 1
}

// A count renders the dice string verbatim or the fixed integer.
export function formatCount(
  countDice: string | null | undefined,
  countFixed: number | null | undefined,
): string {
  if (countDice != null) return countDice
  return String(countFixed ?? 1)
}

export function formatMonsterLine(
  line: KeyedMonster,
  nameFor: (templateId: string) => string,
): string {
  return `${formatCount(line.count_dice, line.count_fixed)} × ${nameFor(line.template_id)}`
}

// Monster lines joined with +: `3d4 × orc + 6 × skeleton`.
export function formatEncounter(
  encounter: KeyedEncounter,
  nameFor: (templateId: string) => string,
): string {
  return encounter.monsters.map((line) => formatMonsterLine(line, nameFor)).join(' + ')
}

export function formatTreasure(treasure: AreaTreasureSpec): string {
  if (treasure.unguarded) return 'unguarded'
  if (treasure.letters.length === 1) return `type ${treasure.letters[0]}`
  return `types ${treasure.letters.join(', ')}`
}

const COIN_ORDER = ['pp', 'gp', 'ep', 'sp', 'cp'] as const

export function formatCoins(coins: Coins): string {
  return COIN_ORDER.filter((denomination) => coins[denomination] > 0)
    .map((denomination) => `${coins[denomination]} ${denomination}`)
    .join(', ')
}

// Valuables count by kind: `2 gems, 1 jewellery`.
export function formatValuables(valuables: readonly ValuableSpec[]): string {
  const parts: string[] = []
  const gems = valuables.filter((valuable) => valuable.kind === 'gem').length
  const jewellery = valuables.filter((valuable) => valuable.kind === 'jewellery').length
  if (gems > 0) parts.push(gems === 1 ? '1 gem' : `${gems} gems`)
  if (jewellery > 0) parts.push(`${jewellery} jewellery`)
  return parts.join(', ')
}

function formatSave(effect: TrapEffect): string {
  const save = effect.save
  if (!save) return ''
  const base = `save vs. ${save.category}`
  if (effect.kills) return `${base} or dies`
  if (save.on_save === 'half') return `${base} for half`
  return `${base} negates`
}

function formatCondition(effect: TrapEffect): string {
  if (!effect.condition) return ''
  const duration =
    effect.condition_duration_dice ??
    (effect.condition_duration_amount != null ? String(effect.condition_duration_amount) : null)
  if (duration == null) return effect.condition
  const unit = effect.condition_duration_unit ?? 'turn'
  return `${effect.condition} ${duration} ${duration === '1' ? unit : `${unit}s`}`
}

// The populated effect parts in model field order; the manual prose rides
// last, set off with an em dash when structured parts precede it, verbatim
// when it is the only populated field.
export function formatTrapEffect(effect: TrapEffect): string {
  const parts: string[] = []
  if (effect.damage_dice != null) parts.push(effect.damage_dice)
  if (effect.volley_dice != null) parts.push(`volley ${effect.volley_dice}`)
  const save = formatSave(effect)
  if (save) parts.push(save)
  if (effect.kills && !effect.save) parts.push('dies')
  const condition = formatCondition(effect)
  if (condition) parts.push(condition)
  if (effect.fall_feet != null) parts.push(`${effect.fall_feet}' fall`)
  if (effect.transition) {
    parts.push(
      `slide to ${effect.transition.to_dungeon_id} level ${effect.transition.to_level_number}`,
    )
  }
  const structured = parts.join(', ')
  if (effect.manual != null && effect.manual !== '') {
    return structured ? `${structured} — ${effect.manual}` : effect.manual
  }
  return structured
}

export function formatTrap(trap: TrapSpec): string {
  const effect = formatTrapEffect(trap.effect)
  return effect ? `${trap.trigger}: ${effect}` : trap.trigger
}

const FEATURE_KIND_LABELS = {
  treasure_cache: 'cache',
  construction_trick: 'trick',
  custom: 'custom',
} as const

// Kind label plus payload summary: `cache: 120 gp, 2 gems, 1 item — trapped`.
export function formatFeature(feature: FeatureSpec): string {
  const label = FEATURE_KIND_LABELS[feature.kind]
  const parts: string[] = []
  const coins = formatCoins(feature.coins)
  if (coins) parts.push(coins)
  const valuables = formatValuables(feature.valuables)
  if (valuables) parts.push(valuables)
  if (feature.item_ids.length > 0) {
    parts.push(feature.item_ids.length === 1 ? '1 item' : `${feature.item_ids.length} items`)
  }
  let summary = parts.length > 0 ? `${label}: ${parts.join(', ')}` : label
  if (feature.trap) summary += ' — trapped'
  return summary
}

// `1-in-6 every 2 turns`, with `custom table` appended when an inline table
// overrides the compiled band.
export function formatWandering(wandering: WanderingSpec): string {
  const interval =
    wandering.interval_turns === 1 ? 'every turn' : `every ${wandering.interval_turns} turns`
  const base = `${wandering.chance_in_six}-in-6 ${interval}`
  return wandering.table ? `${base}, custom table` : base
}

// Hit dice as the stat block prints them: `3+1*`, `½`, `1hp`.
export function formatHitDice(hitDice: MonsterHitDice): string {
  if (hitDice.count === 0) return hitDice.fixed_hp != null ? `${hitDice.fixed_hp}hp` : '0'
  const count = hitDice.die === 4 ? '½' : String(hitDice.count)
  const modifier =
    hitDice.modifier === 0
      ? ''
      : hitDice.modifier > 0
        ? `+${hitDice.modifier}`
        : String(hitDice.modifier)
  return `${count}${modifier}${'*'.repeat(hitDice.asterisks)}`
}

// The area's one-line contents for the map hover and the context menu header:
// every content kind the area carries, in the cards' order.
export function formatAreaContents(
  area: {
    encounter?: KeyedEncounter | null
    treasure?: AreaTreasureSpec | null
    trap?: TrapSpec | null
    features: readonly FeatureSpec[]
  },
  nameFor: (templateId: string) => string,
): string {
  const parts: string[] = []
  if (area.encounter) parts.push(formatEncounter(area.encounter, nameFor))
  if (area.treasure) parts.push(formatTreasure(area.treasure))
  if (area.trap) parts.push(formatTrap(area.trap))
  for (const feature of area.features) parts.push(formatFeature(feature))
  return parts.join(' · ')
}
