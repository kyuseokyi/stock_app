// 재발 방지 — admin_web 은 eslint 가 없어 정적 검사로 인자 없는 스토어 훅 호출(전체 구독)을 막는다.
// node 타입(@types/node)이 없으므로 node:fs 대신 Vite 의 import.meta.glob(?raw)로 src 파일 원문을 읽는다.
import { describe, expect, it } from 'vitest'

const PATTERN = /\buse[A-Z][A-Za-z]*(Store|Sheet)\(\)/

// 키는 이 파일 기준 상대 경로(예: '../components/Sidebar.tsx'), 값은 파일 원문
const SOURCES = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('스토어 전체 구독 금지', () => {
  it('src 파일을 읽어 온다(검사 대상이 비면 규칙이 무력해지므로)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10)
  })

  it('인자 없는 스토어 훅 호출이 없다', () => {
    const hits = Object.entries(SOURCES)
      .filter(([, code]) => PATTERN.test(code))
      .map(([path]) => path.replace(/^\.\.\//, ''))
    expect(hits).toEqual([])
  })
})
