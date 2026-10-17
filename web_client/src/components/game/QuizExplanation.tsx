import { parseQuizMarkdown } from '../../lib/quizMarkdown'

/** 퀴즈 해설 — ###/-/> 만 해석해 제목·목록·안내로 보여 준다(텍스트 노드만 — HTML 주입 없음) */
export default function QuizExplanation({ markdown }: { markdown: string }) {
  const blocks = parseQuizMarkdown(markdown)
  return (
    <div className="mt-3 space-y-1.5 rounded-field bg-surface p-3 text-sm text-ink">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return <p key={i} className="font-semibold">{b.text}</p>
          case 'item':
            return (
              <p key={i} className="flex gap-1.5">
                <span aria-hidden="true" className="text-ink-muted">•</span>
                <span>{b.text}</span>
              </p>
            )
          case 'quote':
            return <p key={i} className="border-l-2 border-line pl-2 text-xs text-ink-muted">{b.text}</p>
          default:
            return <p key={i}>{b.text}</p>
        }
      })}
    </div>
  )
}
