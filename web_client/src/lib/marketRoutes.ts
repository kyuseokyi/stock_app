// 스크리너에서 마켓(/market)으로 옮긴 화면의 옛 주소 → 새 주소. 공유 링크·즐겨찾기가 깨지지 않게 쿼리·해시를 그대로 잇는다.
const LEGACY: Record<string, string> = {
  market: '/market',
  themes: '/market/themes',
  sectors: '/market/sectors',
  calendar: '/market/calendar',
}

/** '/screener/themes?x=1#y' → '/market/themes?x=1#y'. 옮긴 화면이 아니면 null */
export function legacyMarketPath(pathname: string, search = '', hash = ''): string | null {
  const [root, tab] = pathname.split('/').filter(Boolean)
  if (root !== 'screener' || !tab || !Object.prototype.hasOwnProperty.call(LEGACY, tab)) return null
  return `${LEGACY[tab]}${search}${hash}`
}
