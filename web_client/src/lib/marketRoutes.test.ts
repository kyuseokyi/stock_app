import { describe, expect, it } from 'vitest'
import { legacyMarketPath } from './marketRoutes'

describe('legacyMarketPath', () => {
  it('옮긴 네 화면을 새 주소로', () => {
    expect(legacyMarketPath('/screener/market')).toBe('/market')
    expect(legacyMarketPath('/screener/themes')).toBe('/market/themes')
    expect(legacyMarketPath('/screener/sectors')).toBe('/market/sectors')
    expect(legacyMarketPath('/screener/calendar')).toBe('/market/calendar')
  })
  it('쿼리·해시·끝 슬래시', () => {
    expect(legacyMarketPath('/screener/themes', '?a=1', '#top')).toBe('/market/themes?a=1#top')
    expect(legacyMarketPath('/screener/market/', '?a=1')).toBe('/market?a=1')
  })
  it('스크리너에 남는 화면·다른 주소는 null', () => {
    for (const p of ['/screener', '/screener/leaders', '/screener/finder', '/screener/patterns', '/market', '/', '/screener/constructor']) {
      expect(legacyMarketPath(p)).toBeNull()
    }
  })
})
