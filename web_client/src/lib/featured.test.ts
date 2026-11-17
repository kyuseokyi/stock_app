import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import FeaturedBoard from '../components/market/FeaturedBoard'
import {
  currentFeaturedTab,
  featuredCaption,
  featuredEmptyText,
  featuredMoreText,
  featuredTabText,
  featuredTabs,
  hasFeatured,
  viMeta,
  type FeaturedTab,
} from './featured'
import { normalizeFeatured } from './marketRest'
import type { Featured } from '../types/marketRest'

const EMPTY: Featured = normalizeFeatured({})

const RAW = {
  date: '2026-11-16',
  highs: { count: 35, items: [{ ticker: '000660', name: 'SK하이닉스', market: 'KOSPI', close: 200000, change_rate: 5.123 }] },
  lows: { count: 0, items: [] },
  vi: {
    date: '2026-11-17',
    updated_at: '2026-11-17T10:05:00+09:00',
    count: 1,
    items: [{ ticker: '005930', name: '삼성전자', time: '09:15:03', kind: '동적', direction: 'up', price: 67000, rate: 3.3, count: 2 }],
  },
}

const render = (f: Featured, initialTab?: FeaturedTab) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FeaturedBoard, { featured: f, initialTab })))

describe('normalizeFeatured', () => {
  it('빈 응답·잘못된 값은 빈 모양, vi 는 null', () => {
    expect(EMPTY).toEqual({ date: null, highs: { count: 0, items: [] }, lows: { count: 0, items: [] }, vi: null })
    expect(normalizeFeatured({ highs: 'x', lows: { items: [1, {}], count: 'a' }, vi: [] })).toEqual(EMPTY)
  })
  it('필드를 camelCase 로, 개수는 목록보다 작으면 목록 길이로', () => {
    const f = normalizeFeatured(RAW)
    expect(f.highs.items[0]).toEqual({ ticker: '000660', name: 'SK하이닉스', market: 'KOSPI', close: 200000, changeRate: 5.123 })
    expect(f.highs.count).toBe(35)
    expect(f.vi?.items[0]).toEqual({ ticker: '005930', name: '삼성전자', time: '09:15:03', kind: '동적', direction: 'up', price: 67000, rate: 3.3, count: 2 })
    expect(f.vi?.updatedAt).toBe('2026-11-17T10:05:00+09:00')
    expect(normalizeFeatured({ highs: { count: 0, items: [{ ticker: 'A' }] } }).highs.count).toBe(1)
  })
})

describe('화면 규칙', () => {
  const f = normalizeFeatured(RAW)
  it('VI 칸은 데이터가 있을 때만, 사라지면 신고가로', () => {
    expect(featuredTabs(f)).toEqual(['highs', 'lows', 'vi'])
    expect(featuredTabs({ ...f, vi: null })).toEqual(['highs', 'lows'])
    expect(currentFeaturedTab('vi', { ...f, vi: null })).toBe('highs')
    expect(currentFeaturedTab('lows', f)).toBe('lows')
  })
  it('카드는 신고저가나 VI 중 하나라도 있을 때만', () => {
    expect(hasFeatured(EMPTY)).toBe(false)
    expect(hasFeatured(null)).toBe(false)
    expect(hasFeatured({ ...EMPTY, date: '2026-11-16' })).toBe(true)
    expect(hasFeatured({ ...EMPTY, vi: { date: null, updatedAt: null, count: 0, items: [] } })).toBe(true)
  })
  it('빈 상태 문구·탭 글자·기준·더 보기', () => {
    expect(featuredEmptyText('highs', f)).toBe('오늘 신고가 종목이 없어요')
    expect(featuredEmptyText('lows', f)).toBe('오늘 신저가 종목이 없어요')
    expect(featuredEmptyText('highs', EMPTY)).toContain('장 마감 뒤 계산')
    expect(featuredEmptyText('vi', f)).toBe('오늘 VI 발동 종목이 아직 없어요')
    expect(featuredTabText('highs', f)).toBe('신고가 35')
    expect(featuredTabText('lows', f)).toBe('신저가')
    expect(featuredCaption('highs', f)).toBe('11/16 종가 기준')
    expect(featuredCaption('highs', f, '2026-11-16')).toBe('11/16 종가 기준')
    expect(featuredCaption('highs', f, '2026-11-17')).toBe('전 거래일 11/16 종가 기준')
    expect(featuredCaption('vi', f)).toBe('11.17 10:05 기준')
    expect(featuredMoreText(35, 20)).toBe('전체 35종목 중 20종목')
    expect(featuredMoreText(5, 5)).toBeNull()
    expect(viMeta(f.vi!.items[0])).toBe('동적 · 상승 · 2회')
  })
})

describe('FeaturedBoard 렌더', () => {
  const f = normalizeFeatured(RAW)
  it('신고가 목록 — 종목 상세 링크·등락률·전체 개수', () => {
    const html = render(f)
    expect(html).toContain('SK하이닉스')
    expect(html).toContain('href="/stock/000660"')
    expect(html).toContain('+5.1%')
    expect(html).toContain('전체 35종목 중 1종목')
    expect(html).toContain('VI 발동')
  })
  it('빈 상태 문구', () => {
    expect(render(f, 'lows')).toContain('오늘 신저가 종목이 없어요')
  })
  it('VI 탭 — 발동 시각·구분·괴리율', () => {
    const html = render(f, 'vi')
    expect(html).toContain('09:15')
    expect(html).toContain('동적 · 상승 · 2회')
    expect(html).toContain('괴리 +3.3%')
  })
  it('vi 가 null 이면 VI 칩을 숨기고 VI 로 열어도 신고가를 보인다', () => {
    const html = render({ ...f, vi: null }, 'vi')
    expect(html).not.toContain('VI 발동')
    expect(html).toContain('SK하이닉스')
  })
})
