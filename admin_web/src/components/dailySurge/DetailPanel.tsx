import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { BoardRow, Direction } from '../../api/dailySurge'
import { screenerQueries } from '../../queries/screenerQueries'
import StockDailyChart from '../../leaders/components/screener/StockDailyChart'
import { fmtDiff, fmtPrice, fmtRate, fmtValue, fmtVolume, rateClass, themeLabel } from '../../lib/dailySurge'
import NaverNewsList from './NaverNewsList'
import NoteEditor from './NoteEditor'

// 오른쪽 상세 — 테마 묶음(메모·성적표·테마 뉴스) 또는 종목(시세·공시·메모·대표 테마 성적표·종목 뉴스·일봉 차트).
export type Selection =
  | { kind: 'theme'; themeId: number; direction: Direction }
  | { kind: 'stock'; ticker: string }

function Board({ title, rows, highlight }: { title: string; rows: BoardRow[]; highlight?: string }) {
  return (
    <section className="flex flex-col gap-2" aria-label="테마 종목 성적표">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {rows.length === 0 && <p className="text-sm text-ink-muted">그날 일봉이 있는 구성 종목이 없습니다.</p>}
      {rows.map((r) => (
        <div key={r.ticker}
          className={`flex items-center justify-between gap-2 rounded-field px-3 py-2 text-sm ${
            highlight === r.ticker ? 'bg-brand-soft' : r.in_group ? 'bg-fill' : 'bg-canvas text-ink-muted'}`}>
          <span className="flex min-w-0 items-center gap-2">
            {r.is_leader && <span className="rounded-sm bg-ink px-1.5 py-0.5 text-xs text-surface">대장</span>}
            <span className="truncate">{r.name}</span>
          </span>
          <span className="flex shrink-0 gap-4">
            <span className={`font-bold ${r.in_group ? rateClass(r.change_rate) : 'text-ink-muted'}`}>{fmtRate(r.change_rate)}</span>
            <span className="w-16 text-right">{fmtValue(r.trading_value)}</span>
          </span>
        </div>
      ))}
      <p className="text-xs text-ink-muted">대장 = 묶음 안 거래대금 1위. 흐린 줄은 같은 테마에서 기준(±10%)에 못 미친 종목.</p>
    </section>
  )
}

export default function DetailPanel({ date, selection, onChanged }: {
  date: string; selection: Selection | null; onChanged: () => void
}) {
  const qc = useQueryClient()
  const detail = screenerQueries.dailySurge.detail(date, selection)
  const q = useQuery(detail)
  // 고를 때·메모 저장 뒤 다시 받는 동안은 지금처럼 '불러오는 중…'
  const state: 'idle' | 'loading' | 'ok' | 'failed' =
    !selection ? 'idle' : q.isPending || q.isFetching ? 'loading' : q.isError ? 'failed' : 'ok'
  const theme = q.data?.kind === 'theme' ? q.data.theme : null
  const stock = q.data?.kind === 'stock' ? q.data.stock : null

  // 메모 저장·지우기 뒤 — 이 상세를 다시 받고, 목록 갱신은 화면(onChanged)에 맡긴다
  const saved = () => {
    void qc.invalidateQueries({ queryKey: detail.queryKey, exact: true })
    onChanged()
  }

  if (state === 'idle') return <p className="text-sm text-ink-muted">왼쪽에서 테마나 종목을 고르세요.</p>
  if (state === 'loading') return <p className="text-sm text-ink-muted">불러오는 중…</p>
  if (state === 'failed') return <p className="text-sm text-danger">상세를 불러오지 못했습니다.</p>

  if (theme) {
    const g = theme.group
    const tone = g.direction === 'up' ? 'text-up' : 'text-down'
    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <span className="w-fit rounded-full bg-fill px-2 py-0.5 text-xs text-ink-muted">테마</span>
          <h2 className="text-lg font-bold text-ink">{g.theme_name}</h2>
          <p className="text-sm text-ink-muted">
            {g.direction === 'up' ? '급등' : '급락'} {g.stock_count}종목 · 거래대금 합계 {fmtValue(g.value_sum)} · 대장 {g.leader_name}
          </p>
          <p className={`text-2xl font-bold ${tone}`}>평균 {fmtRate(g.avg_change_rate)}</p>
        </header>
        <NoteEditor date={date} scope="theme" target={String(g.theme_id)} value={theme.note} onSaved={saved} />
        <Board title="테마 종목 성적표 (그날)" rows={theme.board} />
        <NaverNewsList kind="theme" date={date} target={String(g.theme_id)} />
      </div>
    )
  }

  if (!stock) return null
  const s = stock.stock
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <span className="w-fit rounded-full bg-fill px-2 py-0.5 text-xs text-ink-muted">종목</span>
        <h2 className="text-lg font-bold text-ink">{s.name} <span className="text-sm font-normal text-ink-muted">{s.ticker} · {s.market}</span></h2>
        <p className="text-sm text-ink-muted">
          종가 {fmtPrice(s.close)} ({fmtDiff(s.change_price)}) · 거래량 {fmtVolume(s.volume)}
          {s.volume_ratio != null && ` (전일의 ${Math.round(s.volume_ratio).toLocaleString('ko-KR')}%)`} · 거래대금 {fmtValue(s.trading_value)}
        </p>
        <p className={`text-2xl font-bold ${rateClass(s.change_rate)}`}>{fmtRate(s.change_rate)}</p>
        <p className="text-sm text-ink-muted">업종 {s.sector_name ?? '-'}</p>
        <Link to={`/market/ai-lab?ticker=${encodeURIComponent(s.ticker)}`}
          className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-brand-strong hover:underline">
          🧠 AI 심층 분석 열기 →
        </Link>
        {s.themes.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="소속 테마">
            {s.themes.map((t) => (
              <span key={t.id} className={`rounded-full px-2 py-0.5 text-xs ${t.moved > 1 ? 'bg-brand-soft text-brand-strong' : 'bg-fill text-ink-muted'}`}>
                {themeLabel(t)}{t.moved > 1 ? ` · 동반 ${t.moved}` : ''} <span className="opacity-70">({t.size})</span>
              </span>
            ))}
          </div>
        )}
      </header>
      <NoteEditor date={date} scope="stock" target={s.ticker} value={stock.notes.stock}
        inherited={stock.notes.theme ? { text: stock.notes.theme, themeName: s.primary_theme_name } : null}
        onSaved={saved} />
      {s.dart_items.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="DART 공시">
          <h3 className="text-sm font-bold text-ink">DART 공시 (전일·당일)</h3>
          {s.dart_items.map((d) => (
            <div key={d.rcept_no} className="flex items-start justify-between gap-3 border-b border-line pb-2 text-sm">
              <p className="text-ink">
                <span className="mr-1 rounded-sm bg-danger-soft px-1.5 py-0.5 text-xs text-danger">{d.when === 'same' ? '당일' : '전일'}</span>
                {d.title}
              </p>
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-brand-strong hover:underline">원문 보기</a>
            </div>
          ))}
          {s.dart_keywords.length > 0 && <p className="text-xs text-ink-muted">{s.dart_keywords.join(' ')}</p>}
        </section>
      )}
      {stock.group ? (
        <Board title={`대표 테마 [${stock.group.theme_name}] 종목 성적표`} rows={stock.board} highlight={s.ticker} />
      ) : (
        <p className="text-sm text-ink-muted">동반 묶음 없음 — 같은 테마에서 함께 ±10% 넘게 움직인 종목이 없습니다(위 소속 테마 참고).</p>
      )}
      <NaverNewsList kind="stock" date={date} target={s.ticker} />
      <StockDailyChart ticker={s.ticker} high52w={null} showMa5Ma20 />
    </div>
  )
}
