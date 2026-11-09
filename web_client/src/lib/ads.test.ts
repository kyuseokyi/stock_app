import { describe, expect, it } from 'vitest'
import type { AdConfig, AdSlot } from '../api/ads'
import { houseAdFor, infeedInterval, isInfeedAfter } from './ads'

const slot = (over: Partial<AdSlot> = {}, house: Partial<AdSlot['house']> = {}): AdSlot => ({
  enabled: true,
  provider: 'HOUSE',
  infeed_interval: 5,
  house: { title: '실시간 차트 트레이딩 게임', description: '가상 자금으로', target_path: '/game', ...house },
  ...over,
})
const config = (s: AdSlot, over: Partial<AdConfig> = {}): AdConfig => ({
  web_enabled: true,
  mobile_enabled: false,
  slots: { WEB_HOME_SIDEBAR: s },
  ...over,
})

describe('houseAdFor', () => {
  it('웹 전체·슬롯이 켜지고 제목·링크가 있으면 하우스 배너', () => {
    expect(houseAdFor(config(slot()), 'WEB_HOME_SIDEBAR')).toEqual({
      title: '실시간 차트 트레이딩 게임',
      description: '가상 자금으로',
      targetPath: '/game',
    })
  })

  it('설정을 못 받았거나(null) 스위치가 꺼지면 숨김', () => {
    expect(houseAdFor(null, 'WEB_HOME_SIDEBAR')).toBeNull()
    expect(houseAdFor(config(slot(), { web_enabled: false }), 'WEB_HOME_SIDEBAR')).toBeNull()
    expect(houseAdFor(config(slot({ enabled: false })), 'WEB_HOME_SIDEBAR')).toBeNull()
    expect(houseAdFor(config(slot()), 'WEB_POST_DETAIL_BOTTOM')).toBeNull() // 응답에 없는 슬롯
  })

  it('앱 스위치만 켜져도 웹은 숨김', () => {
    expect(houseAdFor(config(slot(), { web_enabled: false, mobile_enabled: true }), 'WEB_HOME_SIDEBAR')).toBeNull()
  })

  it('GOOGLE 은 AdSense 연동 전까지 하우스 배너로 대신하고, 문구가 비면 숨김', () => {
    expect(houseAdFor(config(slot({ provider: 'GOOGLE' })), 'WEB_HOME_SIDEBAR')?.targetPath).toBe('/game')
    expect(houseAdFor(config(slot({ provider: 'GOOGLE' }, { title: null })), 'WEB_HOME_SIDEBAR')).toBeNull()
    expect(houseAdFor(config(slot({}, { title: '  ' })), 'WEB_HOME_SIDEBAR')).toBeNull()
    expect(houseAdFor(config(slot({}, { target_path: null })), 'WEB_HOME_SIDEBAR')).toBeNull()
  })

  it('앱 안 경로가 아니면 숨김, 빈 설명은 null', () => {
    expect(houseAdFor(config(slot({}, { target_path: 'https://example.com' })), 'WEB_HOME_SIDEBAR')).toBeNull()
    expect(houseAdFor(config(slot({}, { description: ' ' })), 'WEB_HOME_SIDEBAR')?.description).toBeNull()
  })
})

describe('인피드 위치', () => {
  it('간격은 서버 값, 이상하면 5', () => {
    const c: AdConfig = { web_enabled: true, mobile_enabled: false, slots: { WEB_POST_LIST_INFEED: slot({ infeed_interval: 7 }) } }
    expect(infeedInterval(c, 'WEB_POST_LIST_INFEED')).toBe(7)
    expect(infeedInterval(null, 'WEB_POST_LIST_INFEED')).toBe(5)
    expect(infeedInterval(config(slot({ infeed_interval: 0 })), 'WEB_HOME_SIDEBAR')).toBe(5)
  })

  it('interval 번째 글 뒤에 한 번만, 글이 모자라면 없음', () => {
    const after = (count: number) => Array.from({ length: count }, (_, i) => i).filter((i) => isInfeedAfter(i, count, 5))
    expect(after(10)).toEqual([4])
    expect(after(5)).toEqual([4])
    expect(after(4)).toEqual([])
  })
})
