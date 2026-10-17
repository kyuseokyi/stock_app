// 야간 차트 퀴즈 순수 함수(시간 판정·카운트다운). 판정 시각은 인자로 받아 테스트 가능하게 둔다.

const KST_OFFSET_MS = 9 * 3_600_000
const PRIME_START_MIN = 15 * 60 + 30 // KST 15:30 (정규장 마감)

/** 퀴즈 강조 시간 — KST 평일 15:30~24:00, 또는 토/일 종일 */
export function isQuizPrimeTime(now: Date): boolean {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const day = kst.getUTCDay() // 0=일 … 6=토 (KST 기준)
  if (day === 0 || day === 6) return true
  return kst.getUTCHours() * 60 + kst.getUTCMinutes() >= PRIME_START_MIN
}

/** 문제 문구 — 유형·예측 기간별 */
export function quizQuestionText(quiz: { quiz_type: string; horizon_bars: number }): string {
  if (quiz.quiz_type === 'PATTERN') return '마지막 봉에 나타난 신호는?'
  if (quiz.quiz_type === 'RANGE') return `${quiz.horizon_bars}거래일 뒤 등락률은?`
  return `${quiz.horizon_bars}거래일 뒤 주가는?`
}

/** 선택 코드 → 표시 문구. DIRECTION 은 상승/하락, 4지선다는 보기 label(없으면 코드 그대로) */
export function quizChoiceText(choices: { code: string; label: string }[], code: string): string {
  if (code === 'UP') return '📈 상승'
  if (code === 'DOWN') return '📉 하락'
  return choices.find((c) => c.code === code)?.label ?? code
}

/** 남은 초(올림, 0 미만은 0). startedAtMs/nowMs 는 epoch ms. 시작 순간 = limitSec, 정확히 limitSec 경과 = 0 */
export function quizSecondsLeft(startedAtMs: number, limitSec: number, nowMs: number): number {
  const remainMs = startedAtMs + limitSec * 1000 - nowMs
  return remainMs <= 0 ? 0 : Math.ceil(remainMs / 1000)
}
