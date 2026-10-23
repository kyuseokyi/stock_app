// 기준일·투자 권유 아님 안내 — 홈 노트·시장·테마·업종 탭 아래. 'YYYY-MM-DD' → '10/22 종가 기준'.
const shortDate = (d: string) => {
  const [, m, day] = d.split('-')
  return m && day ? `${Number(m)}/${Number(day)}` : d
}

export default function BasisNote({ date }: { date: string | null }) {
  return (
    <p className="text-center text-xs text-ink-muted">
      {date ? `${shortDate(date)} 종가 기준 · ` : ''}투자 권유가 아니에요
    </p>
  )
}
