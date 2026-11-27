import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  rebuild,
  type GroupPage, type ListResult, type PageMeta, type SurgeBand, type SurgeDate, type SurgeMode, type SurgeSort, type SurgeStock, type ThemeGroup,
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
import { screenerQueries } from '../queries/screenerQueries'
import { FullScreenSheet } from '@/components/ui/full-screen-sheet'

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
  const [date, setDate] = useState<string | null>(null)
  const [view, setView] = useState<View>('groups')
  const [band, setBand] = useState<SurgeBand>('all')
  const [dartOnly, setDartOnly] = useState(false)
  const [sort, setSort] = useState<'' | SurgeSort>('')
  const [selection, setSelection] = useState<Selection | null>(null)
  // 수동 집계 날짜(기본: 보고 있는 날짜, 없으면 오늘 KST)
  const [runDate, setRunDate] = useState<string>(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10))
  const qc = useQueryClient()

  // 집계된 날짜 — 받으면 보고 있던 날짜가 남아 있으면 그대로, 없으면 최신 날짜
  const datesQ = useQuery(screenerQueries.dailySurge.dates())
  const dates: SurgeDate[] = datesQ.data ?? []
  const [seenDates, setSeenDates] = useState<SurgeDate[] | undefined>(undefined)
  if (datesQ.data !== undefined && datesQ.data !== seenDates) {
    const d = datesQ.data
    setSeenDates(d)
    setDate((cur) => (cur && d.some((x) => x.date === cur) ? cur : d[0]?.date ?? null))
  }

  useEffect(() => { if (date) setRunDate(date) }, [date])

  // 목록 — 보기에 따라 테마 묶음 또는 종목 한 쪽(보지 않는 쪽은 요청하지 않음)
  const groupsQ = useQuery(screenerQueries.dailySurge.groups(view === 'groups' ? date : null, page, GROUP_PAGE_SIZE))
  const stocksQ = useQuery(screenerQueries.dailySurge.stocks(view !== 'groups' && date ? {
    date, mode: view, band, dart_only: dartOnly, sort: sort || undefined, page, page_size: STOCK_PAGE_SIZE,
  } : null))
  const listQ = view === 'groups' ? groupsQ : stocksQ
  const listData: GroupPage | ListResult | undefined = listQ.data

  // 마지막으로 받은 새 목록 기준으로 쪽 정보·테마 출처·선택을 맞춘다(쪽 넘김 중 이전 쪽 자리표시에는 돌리지 않음).
  // 넓은 화면만 첫 항목을 미리 열어 둔다(좁은 화면은 누를 때 전체 화면으로) — 화면 폭이 바뀌면 다시 맞춘다
  const [seenList, setSeenList] = useState<{ data: GroupPage | ListResult | undefined; wide: boolean }>({ data: undefined, wide })
  const [meta, setMeta] = useState<PageMeta>(EMPTY_META)
  const [themeSource, setThemeSource] = useState<string | null>(null)
  if (listData !== undefined && !listQ.isPlaceholderData && (listData !== seenList.data || wide !== seenList.wide)) {
    setSeenList({ data: listData, wide })
    setMeta(listData)
    setThemeSource(listData.theme_source)
    if (view === 'groups') {
      const g = (listData as GroupPage).items
      setSelection((cur) => (cur?.kind === 'theme' || !wide ? cur
        : g[0] ? { kind: 'theme', themeId: g[0].theme_id, direction: g[0].direction } : null))
    } else {
      const items = (listData as ListResult).items
      setSelection((cur) => (cur?.kind === 'stock' && items.some((x) => x.ticker === cur.ticker)
        ? cur : wide && items[0] ? { kind: 'stock', ticker: items[0].ticker } : cur))
    }
  }
  const groups: ThemeGroup[] = view === 'groups' ? (groupsQ.data?.items ?? []) : []
  const stocks: SurgeStock[] = view !== 'groups' ? (stocksQ.data?.items ?? []) : []

  // 새로 고침·메모 저장 뒤 다시 받는 동안에는 지금처럼 '불러오는 중…', 쪽 넘김은 이전 쪽을 보여 주며 넘긴다
  const listLoading = !!date && (listQ.isPending || (listQ.isFetching && !listQ.isPlaceholderData))
  // 받은 데이터가 있으면 재조회가 실패해도 그대로 보인다 — 오류 안내는 데이터가 없을 때만
  const failed = (datesQ.isError && !datesQ.isFetching && datesQ.data === undefined)
    || (!!date && listQ.isError && !listQ.isFetching && listQ.data === undefined)
  const state: 'loading' | 'ok' | 'failed' = failed ? 'failed' : datesQ.isPending || listLoading ? 'loading' : 'ok'

  const refreshList = () => { if (date) void listQ.refetch() }
  // 메모 저장·지우기 뒤 — 목록(묶음·종목)만 다시 받는다(날짜·뉴스는 그대로)
  const onChanged = () => { void qc.invalidateQueries({ queryKey: ['screener', 'dailySurge', 'list'] }) }

  // 날짜·보기·거르기·정렬이 바뀌면 첫 쪽부터
  useEffect(() => { setPage(1) }, [date, view, band, dartOnly, sort])

  const open = (next: Selection) => {
    setSelection(next)
    if (!wide) setSheetOpen(true)
  }

  const idx = useMemo(() => dates.findIndex((d) => d.date === date), [dates, date])
  const current = idx >= 0 ? dates[idx] : null
  const go = (next: string) => { setDate(next); setSelection(null) }

  // 수동 집계 — 서버가 1~2분 뒤 끝내므로 목록은 바로 다시 받지 않는다(관리자가 '새로 고침')
  const rebuildM = useMutation({ mutationFn: (d: string) => rebuild(d) })
  const busy = rebuildM.isPending
  const doRebuild = async () => {
    if (!runDate) return
    try {
      await rebuildM.mutateAsync(runDate)
      showToast(`${runDate} 집계를 시작했습니다. 1~2분 뒤 '새로 고침'을 누르세요.`, { icon: '🔄' })
    } catch (e) {
      const code = apiErrorDetail(e)?.code
      showToast(code === 'ALREADY_RUNNING' ? '이미 집계 중입니다.' : apiErrorMessage(e), { icon: '⚠️' })
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
        <button type="button" onClick={() => { void datesQ.refetch(); refreshList() }}
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
              <DetailPanel date={date} selection={selection} onChanged={onChanged} />
            </aside>
          )}
        </div>
      )}

      {!wide && sheetOpen && date && (
        <FullScreenSheet title="상세" onClose={() => setSheetOpen(false)}>
          <DetailPanel date={date} selection={selection} onChanged={onChanged} />
        </FullScreenSheet>
      )}
    </div>
  )
}
