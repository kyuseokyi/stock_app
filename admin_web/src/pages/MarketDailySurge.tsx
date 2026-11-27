import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listDates, listGroups, listStocks, rebuild,
  type PageMeta, type SurgeBand, type SurgeDate, type SurgeMode, type SurgeSort, type SurgeStock, type ThemeGroup,
} from '../api/dailySurge'
import Pagination from '../components/Pagination'
import DetailPanel, { type Selection } from '../components/dailySurge/DetailPanel'
import SurgeStockTable from '../components/dailySurge/SurgeStockTable'
import ThemeGroupList from '../components/dailySurge/ThemeGroupList'
import PageHeader from '../leaders/components/ui/PageHeader'
import { useMediaQuery } from '../leaders/hooks/useMediaQuery'
import { chipClass } from '../leaders/components/ui/Chip'
import { apiErrorDetail, apiErrorMessage } from '../lib/apiError'
import { THEME_SOURCE_LABEL, weekday } from '../lib/dailySurge'
import { hasPermission } from '../lib/permissions'
import { showToast } from '../lib/toast'
import { useMeStore } from '../store/me'

// 관리자 '급등락·테마 분석' — 날짜별 급등·급락·거래대금 상위, 같은 테마 동반 급등락 묶음(대장주), 공시, 이유 메모,
// 네이버 뉴스 바로 보기. 설계 docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md
type View = 'groups' | SurgeMode
const STOCK_PAGE_SIZE = 30
const GROUP_PAGE_SIZE = 20
const EMPTY_META: PageMeta = { total: 0, page: 1, page_size: STOCK_PAGE_SIZE, pages: 1 }

const VIEWS: { id: View; label: string; count?: (d: SurgeDate) => number }[] = [
  { id: 'groups', label: '테마 묶음', count: (d) => d.group_count },
  { id: 'surge', label: '급등주 +10~+30%', count: (d) => d.surge_count },
  { id: 'plunge', label: '급락주 -10~-30%', count: (d) => d.plunge_count },
  { id: 'value', label: '거래대금 상위', count: (d) => d.value_count },
  { id: 'surge_value', label: '급등+거래대금' },
  { id: 'plunge_value', label: '급락+거래대금' },
]
const BANDS: { id: SurgeBand; label: string }[] = [
  { id: 'all', label: '전체 10~30%' }, { id: '25_30', label: '±25~30% 상·하한가' },
  { id: '15_25', label: '±15~25%' }, { id: '10_15', label: '±10~15%' },
]
const SORTS: { id: '' | SurgeSort; label: string }[] = [
  { id: '', label: '기본(등락률·거래대금)' }, { id: 'change_rate', label: '등락률' },
  { id: 'trading_value', label: '거래대금' }, { id: 'volume', label: '거래량' },
  { id: 'volume_ratio', label: '거래량 배수' }, { id: 'change_price', label: '전일대비' },
]

export default function MarketDailySurge() {
  const canRebuild = hasPermission(useMeStore((s) => s.user), 'DATA_PIPELINE')
  // 넓은 화면은 오른쪽 상세 패널, 좁은 화면(모바일·태블릿)은 누를 때만 전체 화면 상세(목록 위치·거르기 유지)
  const wide = useMediaQuery('(min-width: 1024px)')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState<PageMeta>(EMPTY_META)
  const [dates, setDates] = useState<SurgeDate[]>([])
  const [date, setDate] = useState<string | null>(null)
  const [view, setView] = useState<View>('groups')
  const [band, setBand] = useState<SurgeBand>('all')
  const [dartOnly, setDartOnly] = useState(false)
  const [sort, setSort] = useState<'' | SurgeSort>('')
  const [groups, setGroups] = useState<ThemeGroup[]>([])
  const [stocks, setStocks] = useState<SurgeStock[]>([])
  const [themeSource, setThemeSource] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [busy, setBusy] = useState(false)
  // 수동 집계 날짜(기본: 보고 있는 날짜, 없으면 오늘 KST)
  const [runDate, setRunDate] = useState<string>(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10))

  const reloadDates = useCallback(() => {
    listDates()
      .then((d) => {
        setDates(d)
        setDate((cur) => (cur && d.some((x) => x.date === cur) ? cur : d[0]?.date ?? null))
        if (!d.length) setState('ok')
      })
      .catch(() => setState('failed'))
  }, [])

  useEffect(() => { reloadDates() }, [reloadDates])
  useEffect(() => { if (date) setRunDate(date) }, [date])

  const load = useCallback(async () => {
    if (!date) return
    setState('loading')
    try {
      if (view === 'groups') {
        const r = await listGroups(date, page, GROUP_PAGE_SIZE)
        const g = r.items
        setGroups(g)
        setMeta(r)
        setThemeSource(r.theme_source)
        // 넓은 화면만 첫 항목을 미리 열어 둔다(좁은 화면은 누를 때 전체 화면으로)
        setSelection((cur) => (cur?.kind === 'theme' || !wide ? cur
          : g[0] ? { kind: 'theme', themeId: g[0].theme_id, direction: g[0].direction } : null))
      } else {
        const r = await listStocks({ date, mode: view, band, dart_only: dartOnly, sort: sort || undefined,
          page, page_size: STOCK_PAGE_SIZE })
        setStocks(r.items)
        setMeta(r)
        setThemeSource(r.theme_source)
        setSelection((cur) => (cur?.kind === 'stock' && r.items.some((s) => s.ticker === cur.ticker)
          ? cur : wide && r.items[0] ? { kind: 'stock', ticker: r.items[0].ticker } : cur))
      }
      setState('ok')
    } catch {
      setState('failed')
    }
  }, [date, view, band, dartOnly, sort, page, wide])

  // 날짜·보기·거르기·정렬이 바뀌면 첫 쪽부터
  useEffect(() => { setPage(1) }, [date, view, band, dartOnly, sort])
  useEffect(() => { void load() }, [load])

  const open = (next: Selection) => {
    setSelection(next)
    if (!wide) setSheetOpen(true)
  }

  const idx = useMemo(() => dates.findIndex((d) => d.date === date), [dates, date])
  const current = idx >= 0 ? dates[idx] : null
  const go = (next: string) => { setDate(next); setSelection(null) }

  const doRebuild = async () => {
    if (!runDate) return
    setBusy(true)
    try {
      await rebuild(runDate)
      showToast(`${runDate} 집계를 시작했습니다. 1~2분 뒤 '새로 고침'을 누르세요.`, { icon: '🔄' })
    } catch (e) {
      const code = apiErrorDetail(e)?.code
      showToast(code === 'ALREADY_RUNNING' ? '이미 집계 중입니다.' : apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="급등락·테마 분석"
        description="장 마감 종가 기준. 같은 테마에서 함께 오르거나 내린 종목을 묶고, 공시·이유 메모·네이버 뉴스로 이유를 확인합니다." />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="이전 거래일" disabled={idx < 0 || idx >= dates.length - 1}
          onClick={() => go(dates[idx + 1].date)}
          className="h-11 min-w-[44px] rounded-btn bg-surface px-3 text-ink disabled:opacity-40">‹</button>
        <label htmlFor="surge-date" className="sr-only">거래일</label>
        <select id="surge-date" value={date ?? ''} onChange={(e) => go(e.target.value)}
          className="h-11 rounded-btn bg-surface px-3 text-sm font-medium text-ink">
          {dates.map((d) => <option key={d.date} value={d.date}>{d.date} ({weekday(d.date)})</option>)}
        </select>
        <button type="button" aria-label="다음 거래일" disabled={idx <= 0}
          onClick={() => go(dates[idx - 1].date)}
          className="h-11 min-w-[44px] rounded-btn bg-surface px-3 text-ink disabled:opacity-40">›</button>
        <span className="px-2 text-xs text-ink-muted">
          테마 출처: {themeSource ? THEME_SOURCE_LABEL[themeSource] ?? themeSource : '-'}
        </span>
        <button type="button" onClick={() => { reloadDates(); void load() }}
          className="h-11 rounded-btn bg-surface px-3 text-sm text-ink">새로 고침</button>
        {canRebuild && (
          <div className="ml-auto flex flex-wrap items-center gap-2 rounded-btn bg-surface px-2 py-1">
            <label htmlFor="surge-run-date" className="text-xs text-ink-muted">수동 집계</label>
            <input id="surge-run-date" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)}
              className="h-9 rounded-field bg-fill px-2 text-sm text-ink" />
            <button type="button" onClick={doRebuild} disabled={busy || !runDate}
              className="h-9 rounded-btn bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50">
              집계 실행
            </button>
          </div>
        )}
      </div>

      <div role="tablist" aria-label="보기" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
            onClick={() => { setView(v.id); setSelection(null) }} className={`min-h-[44px] ${chipClass(view === v.id)}`}>
            {v.label}{current && v.count ? <span className="ml-1 opacity-75">{v.count(current)}</span> : null}
          </button>
        ))}
      </div>

      {view !== 'groups' && (
        <div className="flex flex-wrap items-center gap-2 rounded-card bg-surface p-3">
          {view !== 'value' && (
            <>
              <span className="text-xs text-ink-muted">등락 구간</span>
              {BANDS.map((b) => (
                <button key={b.id} type="button" aria-pressed={band === b.id} onClick={() => setBand(b.id)}
                  className={chipClass(band === b.id)}>{b.label}</button>
              ))}
            </>
          )}
          <button type="button" aria-pressed={dartOnly} onClick={() => setDartOnly((x) => !x)} className={chipClass(dartOnly)}>
            공시 있는 종목만
          </button>
          <label htmlFor="surge-sort" className="ml-2 text-xs text-ink-muted">정렬</label>
          <select id="surge-sort" value={sort} onChange={(e) => setSort(e.target.value as '' | SurgeSort)}
            className="h-9 rounded-field bg-fill px-2 text-sm text-ink">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      )}

      {state === 'failed' && <p className="rounded-card bg-danger-soft p-4 text-sm text-danger">자료를 불러오지 못했습니다.</p>}
      {state === 'ok' && dates.length === 0 && (
        <p className="rounded-card bg-surface p-6 text-center text-sm text-ink-muted">
          아직 집계된 날짜가 없습니다. 평일 22:10 에 자동으로 집계됩니다.
          {canRebuild ? ' 지금 보려면 위의 수동 집계에서 날짜를 고르고 \'집계 실행\'을 누른 뒤 1~2분 뒤 \'새로 고침\'을 누르세요.' : ' 수동 집계는 데이터 파이프라인 권한이 있는 관리자가 할 수 있습니다.'}
        </p>
      )}

      {date && (
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-[999_1_560px]">
            {state === 'loading' && <p className="text-sm text-ink-muted">불러오는 중…</p>}
            {state === 'ok' && view === 'groups' && (
              <ThemeGroupList groups={groups}
                selected={selection?.kind === 'theme' ? { themeId: selection.themeId, direction: selection.direction } : null}
                onSelect={(g) => open({ kind: 'theme', themeId: g.theme_id, direction: g.direction })} />
            )}
            {state === 'ok' && view !== 'groups' && (
              <SurgeStockTable items={stocks} selected={selection?.kind === 'stock' ? selection.ticker : null}
                onSelect={(s) => open({ kind: 'stock', ticker: s.ticker })} />
            )}
            {state === 'ok' && (
              <Pagination page={meta.page} pages={meta.pages} total={meta.total}
                unit={view === 'groups' ? '개 묶음' : '종목'}
                onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
            )}
          </div>
          {wide && (
            <aside className="min-w-0 flex-[1_1_420px] rounded-card bg-surface p-4" aria-label="상세">
              <DetailPanel date={date} selection={selection} onChanged={() => void load()} />
            </aside>
          )}
        </div>
      )}

      {!wide && sheetOpen && date && (
        <div role="dialog" aria-modal="true" aria-label="상세"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-canvas">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
            <strong className="text-sm text-ink">상세</strong>
            <button type="button" onClick={() => setSheetOpen(false)} autoFocus
              className="h-11 min-w-[44px] rounded-btn bg-fill px-4 text-sm font-medium text-ink">닫기</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <DetailPanel date={date} selection={selection} onChanged={() => void load()} />
          </div>
        </div>
      )}
    </div>
  )
}
