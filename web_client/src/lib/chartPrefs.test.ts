import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CHART_PREFS, loadChartPrefs, parseChartPrefs, saveChartPrefs } from './chartPrefs'

describe('차트 설정 저장값', () => {
  it('없거나 깨진 값은 기본(관리자 기본 단위 · 이동평균 켜짐 · 볼린저·매물대 꺼짐)', () => {
    expect(parseChartPrefs(null)).toEqual(DEFAULT_CHART_PREFS)
    expect(parseChartPrefs('{oops')).toEqual(DEFAULT_CHART_PREFS)
    expect(DEFAULT_CHART_PREFS).toEqual({ interval: null, ma: true, bb: false, vp: false, sr: true })
  })

  it('저장한 그대로 복원', () => {
    const prefs = { interval: '1m' as const, ma: false, bb: true, vp: true, sr: false }
    // 웹은 serializeChartPrefs 대신 saveChartPrefs → localStorage → loadChartPrefs
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    })
    try {
      saveChartPrefs(prefs)
      expect(loadChartPrefs()).toEqual(prefs)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('localStorage 를 못 쓰면 기본값(저장 실패는 무시)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    try {
      expect(() => saveChartPrefs(DEFAULT_CHART_PREFS)).not.toThrow()
      expect(loadChartPrefs()).toEqual(DEFAULT_CHART_PREFS)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('형식이 틀린 필드만 기본값으로', () => {
    expect(parseChartPrefs('{"interval":"3m","ma":"yes","bb":true}')).toEqual({ interval: null, ma: true, bb: true, vp: false, sr: true })
  })

  it('옛 저장값(sr 없음)은 지지·저항 켜짐', () => {
    expect(parseChartPrefs('{"interval":"1m","ma":false,"bb":false,"vp":true}').sr).toBe(true)
  })
})
