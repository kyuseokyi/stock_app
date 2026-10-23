import { LETTER_KEYS, LETTER_NAMES, letterBadgeClass, letterStatusText } from '../../lib/canslim'
import type { CanslimLetters } from '../../types/screener'

// C A N S L I M 배지 7개 — 통과(블루)·미달(회색)·부족/준비 중(점선). 스크린리더용 이름·상태 제공.
export default function LetterBadges({ letters, compact = false }: { letters: CanslimLetters; compact?: boolean }) {
  const size = compact ? 'h-5 w-5 text-xs' : 'h-6 w-6 text-xs'
  return (
    <span className="inline-flex gap-1">
      {LETTER_KEYS.map((k) => (
        <span
          key={k}
          title={`${LETTER_NAMES[k]} ${letterStatusText(letters[k])}`}
          aria-label={`${k.toUpperCase()} ${LETTER_NAMES[k]} ${letterStatusText(letters[k])}`}
          className={`inline-flex items-center justify-center rounded-md font-bold ${size} ${letterBadgeClass(letters[k])}`}
        >
          {k.toUpperCase()}
        </span>
      ))}
    </span>
  )
}
