import '@testing-library/jest-dom/vitest';

// jsdom doesn't ship a ResizeObserver implementation; React Flow's
// internals use one. A minimal no-op mock is enough for tests that
// don't depend on layout dimensions.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// React Flow also references DOMMatrixReadOnly for transform math. jsdom
// doesn't implement it; supply a minimal stub the canvas accepts.
if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
  class DOMMatrixReadOnlyStub {
    m11 = 1;
    m22 = 1;
    constructor(_init?: string | number[]) {}
  }
  globalThis.DOMMatrixReadOnly =
    DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
}
