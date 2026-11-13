// 펀드공시 시트 공유 소스(웹) — 모든 펀드 화면이 같은 결과를 10분 동안 나눠 쓴다.
// 브라우저의 'euc-kr' 디코더는 WHATWG 표준상 CP949(확장 한글 포함)라 그대로 쓴다.
import { createDisclosureSource, fetchDisclosureHtml } from './fundCore'

const eucKr = new TextDecoder('euc-kr')

export const disclosureSource = createDisclosureSource(() => fetchDisclosureHtml((buf) => eucKr.decode(buf)), Date.now)
