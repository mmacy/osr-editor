import { expect, test } from 'vitest'

import { INSPECTOR_AREA_DEFAULT, PANE_LIMITS, paneWidth, paneWidthUpdate } from '@/lib/pane-widths'
import { makeProjectState } from '@/test/fixtures'

const view = () => makeProjectState().sidecar.view_state

test('an undragged pane opens at its default, or at the width the caller asks for', () => {
  expect(paneWidth({}, 'library')).toBe(PANE_LIMITS.library.default)
  // The inspector's area width is a default, not an override: it applies only
  // while the pane is unsized.
  expect(paneWidth({}, 'inspector', INSPECTOR_AREA_DEFAULT)).toBe(INSPECTOR_AREA_DEFAULT)
  expect(paneWidth({ inspector: 500 }, 'inspector', INSPECTOR_AREA_DEFAULT)).toBe(500)
})

test('a recorded width outside the limits opens clamped', () => {
  expect(paneWidth({ nav: 20 }, 'nav')).toBe(PANE_LIMITS.nav.min)
  expect(paneWidth({ nav: 9999 }, 'nav')).toBe(PANE_LIMITS.nav.max)
})

test('a drag records whole pixels and leaves the rest of the view state alone', () => {
  const before = { ...view(), review_selection: 'mill/1/3' }
  const after = paneWidthUpdate(before, { library: 331.6, source_pages: 420 })
  expect(after).not.toBeNull()
  expect(after!.pane_widths).toEqual({ library: 332, source_pages: 420 })
  expect(after!.review_selection).toBe('mill/1/3')
  expect(before.pane_widths).toEqual({})
})

test('a report that changes nothing earns no write', () => {
  const sized = paneWidthUpdate(view(), { nav: 300 })!
  expect(paneWidthUpdate(sized, { nav: 300 })).toBeNull()
  // Panes report their size on mount and on every window resize too; only a
  // width that actually moved is worth a sidecar patch.
  expect(paneWidthUpdate(sized, { nav: 300.4 })).toBeNull()
  expect(paneWidthUpdate(sized, { nav: 301 })).not.toBeNull()
})
