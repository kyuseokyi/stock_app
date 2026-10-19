// 기준일·투자 권유 아님 안내 — 시장·테마·업종·일정 탭 아래.
export default function BasisNote({ date }: { date: string | null }) {
  return (
    <p className="text-center text-xs text-ink-muted">
      {date ? `기준일 ${date} 종가 · ` : ''}매일 장 마감 후 갱신 · 투자 권유가 아닙니다
    </p>
  )
}
