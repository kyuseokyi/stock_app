import { LETTER_KEYS, LETTER_NAMES, letterBadgeClass, letterStatusText } from '../../lib/canslim'
import type { CanslimLetters } from '../../types/screener'

// C A N S L I M 배지 7개 — 통과(채움)·미달(빈 테두리)·부족/준비 중(점선). 화면 읽기에는 묶음 하나의 요약 이름으로 읽힌다(글자 span 에 단 이름은 무시되므로).
export default function LetterBadges({ letters, compact = false }: { letters: CanslimLetters; compact?: boolean }) {
  const size = compact ? 'h-5 w-5 text-xs' : 'h-6 w-6 text-xs'
  const passed = LETTER_KEYS.filter((k) => letters[k] === 1).length
  const summary = `CANSLIM 7개 중 ${passed}개 통과: ${LETTER_KEYS.map((k) => `${LETTER_NAMES[k]} ${letterStatusText(letters[k])}`).join(', ')}`
  return (
    <span role="img" aria-label={summary} className="inline-flex gap-1">
      {LETTER_KEYS.map((k) => (
        <span
          key={k}
          title={`${LETTER_NAMES[k]} ${letterStatusText(letters[k])}`}
          aria-hidden
          className={`inline-flex items-center justify-center rounded-md font-bold ${size} ${letterBadgeClass(letters[k])}`}
        >
          {k.toUpperCase()}
        </span>
      ))}
    </span>
  )
}
