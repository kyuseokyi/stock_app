// 등록 가능한 펀드 현황 주소 — https://fund.ivyro.net/dataroom/om_data/<파일>.htm 만(입력한 http 는 https 로 바꿔 받는다).
// RN 의 URL 구현은 hostname 등이 불완전해 정규식 하나로 검사한다.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { fundError } from './types';

const FUND_URL_RE = /^https:\/\/fund\.ivyro\.net\/dataroom\/om_data\/[^/?#\s]+\.htm$/;
const MAX_URL = 200;

/** 다듬은(trim) 주소가 등록 가능한 펀드 현황 주소인지 */
export function isFundUrl(url: string): boolean {
  return url.length <= MAX_URL && FUND_URL_RE.test(url);
}

export function normalizeFundUrl(input: string): string {
  // 원본 사이트(공지·링크)가 http 주소를 주기도 한다 — 같은 내용이 https 로도 나오므로 https 로 바꿔 저장한다.
  // http 그대로는 못 쓴다: https 웹페이지는 http 요청을 막고(mixed content), Android 앱도 평문 http 를 막는다.
  const url = input.trim().replace(/^http:\/\//i, 'https://');
  if (!isFundUrl(url)) throw fundError('input', 'fund.ivyro.net 펀드 현황 주소만 등록할 수 있어요.');
  return url;
}
