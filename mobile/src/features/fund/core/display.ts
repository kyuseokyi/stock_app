// 화면 표시용 순수 함수. web_client/src/lib/fundCore 와 동일.
import type { FundReport } from './types';

/** 기준일 = 첫 자금 현황 섹션의 최종평가일 */
export function evalDateOf(r: FundReport): string {
  for (const s of r.sections) if (s.kind === 'accounts' && s.evalDate) return s.evalDate;
  return '';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 마지막 확인 시각 — 오늘이면 "HH:mm", 아니면 "M/D HH:mm" (Intl 없이) */
export function formatChecked(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
