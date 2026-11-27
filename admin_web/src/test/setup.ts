import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest globals 를 끈 상태라 Testing Library 자동 정리가 돌지 않는다 → 테스트마다 화면을 비운다
afterEach(() => cleanup())

// jsdom 에 없는 브라우저 API — Radix 부품 테스트용 최소 대체
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
