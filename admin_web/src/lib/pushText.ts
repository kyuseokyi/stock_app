/** `{date}` → `M월 D일` (서버 render_push_text 와 같은 규칙). dateIso 는 YYYY-MM-DD */
export function renderPushText(text: string, dateIso: string): string {
  const [, m, d] = dateIso.split('-').map(Number)
  if (!m || !d) return text
  return text.split('{date}').join(`${m}월 ${d}일`)
}

/** 오늘(KST) YYYY-MM-DD */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

/** datetime-local 입력의 최솟값(지금 + 2분, 로컬 시각 문자열) */
export function minScheduleLocal(): string {
  const d = new Date(Date.now() + 2 * 60_000)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
