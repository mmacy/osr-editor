import { expect, test } from 'vitest'

import { defaultKind, defaultTargetLevel } from '@/lib/transitions'
import { makeDocument } from '@/test/fixtures'
import type { Adventure } from '@/types'

function withLevels(...numbers: number[]): Adventure {
  const document = makeDocument()
  const [first] = document.dungeons[0].levels
  document.dungeons[0].levels = numbers.map((number) => ({ ...first, number }))
  return document
}

test('the default target is the nearest level below the source', () => {
  expect(defaultTargetLevel(withLevels(1, 2, 3), 'dungeon-1', 1)).toBe(2)
  expect(defaultTargetLevel(withLevels(1, 3, 5), 'dungeon-1', 3)).toBe(5)
})

test('the bottom level defaults to the nearest level above', () => {
  expect(defaultTargetLevel(withLevels(1, 2, 3), 'dungeon-1', 3)).toBe(2)
})

test('a one-level dungeon and an unknown dungeon still answer', () => {
  expect(defaultTargetLevel(withLevels(1), 'dungeon-1', 1)).toBe(1)
  expect(defaultTargetLevel(withLevels(1, 2), 'missing', 1)).toBeNull()
})

test('the default kind follows the travel direction within a dungeon', () => {
  expect(defaultKind(1, 2, true)).toBe('stairs_down')
  expect(defaultKind(3, 2, true)).toBe('stairs_up')
  expect(defaultKind(2, 2, true)).toBe('stairs_down')
})

test('cross-dungeon travel carries no vertical direction', () => {
  expect(defaultKind(3, 1, false)).toBe('stairs_down')
  expect(defaultKind(1, null, true)).toBe('stairs_down')
})
