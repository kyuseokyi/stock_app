// 펀드공시(원금보존 추구형 위탁운용자금 일일 수익분석) — 모든 펀드 리포트에 공통인 엑셀 내보내기 페이지.
// 리포트 기준일과 같은 날짜의 일간 통계 줄에서 "당일 연환산 수익률"과 "장중 거래내용"만 꺼낸다.
// 원본은 EUC-KR(CP949)이고 서버가 문자셋을 알려 주지 않아, 바이트 → 문자열 해독은 플랫폼이 주입한다.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { tokenize } from './grid';

/** 프레임 껍데기(operating_margin(v3.0).htm)가 아닌 실제 표가 든 시트 파일 */
export const DISCLOSURE_URL = 'https://fund.ivyro.net/dataroom/operating_margin(v3.0).files/sheet001.htm';

export type DisclosureDay = { date: string; annual: string; note: string };

// 일간 통계 한 줄: 날짜 | 요일 | 누적일수 | 당일 일일수익율 | 당일 연환산 | 누적 수익률 | 누적 연환산 | 주가등락 | 지수대비 | 시장패턴 | 진폭/주기 | 설계파동대비 | 장중 거래내용
const COL = { date: 0, annual: 4, note: 12 } as const;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const PCT_RE = /^-?\d+(\.\d+)?%$/;
const KO_DATE_RE = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/;

/** 리포트 기준일 원본('2026년 11월 12일') → '2026-11-12'. 모양이 다르면 '' */
export function isoOfEvalDate(raw: string): string {
  const m = KO_DATE_RE.exec(raw.trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

/**
 * 시트에서 날짜가 정확히 같은 줄 하나. 이번 달·지난 달 일간 표를 함께 찾는다(월간·연간 표는 날짜 모양이 달라 안 걸림).
 * 숨김 줄(#DIV/0! 찌꺼기)은 tokenize 가 버린다. 줄 모양이 기대와 다르면 null — 틀린 값을 보이느니 안 보인다.
 */
export function findDisclosureDay(html: string, isoDate: string): DisclosureDay | null {
  if (!ISO_RE.test(isoDate)) return null;
  for (const row of tokenize(html).rows) {
    if (row[COL.date]?.text !== isoDate) continue;
    const annual = row[COL.annual]?.text ?? '';
    if (row.length <= COL.note || !PCT_RE.test(annual)) return null;
    return { date: isoDate, annual, note: row[COL.note].text.replace(/\s*\n\s*/g, ' ') };
  }
  return null;
}

/** 시트를 바이트로 받아 decode 로 해독한다(앱: CP949 표, 웹: TextDecoder('euc-kr')) */
export async function fetchDisclosureHtml(
  decode: (buf: ArrayBuffer) => string,
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(DISCLOSURE_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`공시 응답 ${res.status}`);
    return decode(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export type DisclosureSource = { get: () => Promise<string>; invalidate: () => void };

/** 모든 펀드가 같은 페이지를 쓴다 — 받은 결과(진행 중 요청 포함)를 ttl 동안 나눠 쓰고, 실패는 기억하지 않는다.
 *  invalidate: 받은 시트에 원하는 날짜가 없을 때(공시가 리포트보다 늦게 갱신) 다음 get 이 다시 받게 한다 */
export function createDisclosureSource(load: () => Promise<string>, now: () => number, ttlMs = 10 * 60_000): DisclosureSource {
  let cached: { at: number; p: Promise<string> } | null = null;
  return {
    get() {
      if (cached && now() - cached.at < ttlMs) return cached.p;
      const p = load();
      const mine = { at: now(), p };
      cached = mine;
      p.catch(() => {
        if (cached === mine) cached = null;
      });
      return p;
    },
    invalidate() {
      cached = null;
    },
  };
}
