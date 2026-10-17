// 퀴즈 해설 마크다운(생성기 템플릿이 쓰는 3가지만) → 블록. web lib/quizMarkdown.ts 와 같은 규칙.
// "### 제목" / "- 항목" / "> 인용" / 그 외 문단. 빈 줄은 건너뛴다.

export type QuizMdBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string };

export function parseQuizMarkdown(md: string): QuizMdBlock[] {
  const out: QuizMdBlock[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) out.push({ kind: 'heading', text: heading[1] });
    else if (/^[-*]\s+/.test(line)) out.push({ kind: 'item', text: line.replace(/^[-*]\s+/, '') });
    else if (line.startsWith('>')) out.push({ kind: 'quote', text: line.replace(/^>\s?/, '') });
    else out.push({ kind: 'para', text: line });
  }
  return out;
}
