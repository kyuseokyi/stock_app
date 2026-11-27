import '@testing-library/jest-dom/vitest'

// jsdom 에 없는 브라우저 API — Radix 부품 테스트용 최소 대체
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
