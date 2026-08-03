import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom ships no ResizeObserver and computes no layout, so anything that sizes
// itself from its element — the map canvas's backing store, the resizable pane
// group — has nothing to read. The stub answers each observation once with a
// window-sized rect and then stays quiet, which is enough for a component test
// to reach a rendered state; live resizing and splitter drags are what the
// Playwright suite is for.
const STUB_SIZE = { width: 800, height: 600 }

class ResizeObserverStub implements ResizeObserver {
  readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element): void {
    // Both readings of the same rect: the canvas reads `contentRect`, the pane
    // group reads `borderBoxSize`.
    const box = [{ inlineSize: STUB_SIZE.width, blockSize: STUB_SIZE.height }]
    const entry = {
      target,
      contentRect: { ...STUB_SIZE, x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800 },
      borderBoxSize: box,
      contentBoxSize: box,
      devicePixelContentBoxSize: box,
    } as unknown as ResizeObserverEntry
    this.callback([entry], this)
  }

  unobserve(): void {}

  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub

// Without vitest globals, testing-library cannot register its own cleanup —
// do it here so component tests stay isolated.
afterEach(() => {
  cleanup()
})
