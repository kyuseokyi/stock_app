// 기준일·갱신 주기·투자 권유 아님 안내 — 홈 노트·시장·테마·업종 탭 아래(앱 BasisNote 와 같은 문구).
const shortDate = (d: string) => {
  const [, m, day] = d.split('-')
  return m && day ? `${Number(m)}/${Number(day)}` : d
}

export default function BasisNote({ date }: { date: string | null }) {
  return (
    <p className="text-center text-xs text-ink-muted">
      {date ? `기준일 ${shortDate(date)} · ` : ''}국내 지수 장중 30초 · 15:40 확정 · 종목·테마·업종 20:30 · 미국 06:30 갱신 · 투자 권유가 아니에요
    </p>
  )
}
