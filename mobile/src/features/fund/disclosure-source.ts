// 펀드공시 시트 공유 소스(앱) — 모든 펀드 화면이 같은 결과를 10분 동안 나눠 쓴다. 해독은 앱 전용 CP949 표.
import { createDisclosureSource, fetchDisclosureHtml } from './core';
import { decodeEucKr } from './euc-kr';

export const disclosureSource = createDisclosureSource(() => fetchDisclosureHtml(decodeEucKr), Date.now);
