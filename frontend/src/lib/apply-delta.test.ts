import { expect, test } from 'vitest'

import { applyDelta } from '@/lib/apply-delta'
import { makeDocument } from '@/test/fixtures'

test('replaces a top-level scalar subtree', () => {
  const document = makeDocument()
  const next = applyDelta(document, [{ path: '/name', value: 'Renamed' }])
  expect(next.name).toBe('Renamed')
  expect(next.town).toEqual(document.town)
  expect(document.name).toBe('The mill on the moor')
})

test('replaces a nested subtree through array indices', () => {
  const next = applyDelta(makeDocument(), [
    {
      path: '/dungeons/0/levels/0/wandering',
      value: { chance_in_six: 3, interval_turns: 1, table: null },
    },
  ])
  expect(next.dungeons[0].levels[0].wandering.chance_in_six).toBe(3)
})

test('the empty path replaces the whole document', () => {
  const replacement = makeDocument({ name: 'Wholesale' })
  const next = applyDelta(makeDocument(), [{ path: '', value: replacement }])
  expect(next).toEqual(replacement)
})

test('applies entries in order', () => {
  const next = applyDelta(makeDocument(), [
    { path: '/name', value: 'First' },
    { path: '/name', value: 'Second' },
  ])
  expect(next.name).toBe('Second')
})

test('unescapes pointer tokens per RFC 6901', () => {
  const document = makeDocument({
    town: {
      name: '',
      description: '',
      services: [],
      travel_turns: { 'weird/id~x': 1 },
    },
  })
  const next = applyDelta(document, [{ path: '/town/travel_turns/weird~1id~0x', value: 9 }])
  expect(next.town.travel_turns['weird/id~x']).toBe(9)
})

test('an unresolvable path throws instead of corrupting', () => {
  expect(() => applyDelta(makeDocument(), [{ path: '/name/nope', value: 1 }])).toThrow(
    'does not resolve',
  )
})
