import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Without vitest globals, testing-library cannot register its own cleanup —
// do it here so component tests stay isolated.
afterEach(() => {
  cleanup()
})
