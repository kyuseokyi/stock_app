// 기준일·투자 권유 아님 안내 — 시장·테마·업종·일정 탭 아래.
export default function BasisNote({ date }: { date: string | null }) {
  return (
    <p className="text-center text-xs text-ink-muted">
      {date ? `기준일 ${date} 종가 · ` : ''}국내 지수 장중 30초 · 15:40 확정 · 종목·테마·업종 20:30 · 미국 06:30 갱신 · 투자 권유가 아닙니다
    </p>
  )
}
