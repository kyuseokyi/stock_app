import { useEffect, useState } from 'react'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import BasisNote from '../../components/market/BasisNote'
import GroupControls, { type GroupControlValue } from '../../components/market/GroupControls'
import GroupDetailView from '../../components/market/GroupDetailView'
import GroupList from '../../components/market/GroupList'
import Treemap from '../../components/market/Treemap'
import { GROUP_PAGE, getMarketGroups, getMarketTreemap } from '../../api/market'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import type { GroupItem, GroupKind, TreemapGroup } from '../../types/market'

const TEXT: Record<GroupKind, { title: string; desc: string; empty: string }> = {
  theme: {
    title: '테마',
    desc: '테마에 속한 종목들의 평균 등락률로 순위를 매겨요. 3종목 이상인 테마만 순위에 들어가요.',
    empty: '순위에 든 테마가 없어요',
  },
  sector: {
    title: '업종',
    desc: '업종별 평균 등락률과 시가총액 지도를 보여줘요. 타일 색이 진할수록 많이 오르거나 내린 거예요.',
    empty: '업종 데이터가 없어요',
  },
}

// 테마·업종 탭(같은 화면, kind 만 다름) — 목록/트리맵 전환, 넓은 화면은 오른쪽 상세, 좁은 화면은 펼침.
export default function GroupTab({ kind }: { kind: GroupKind }) {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [ctrl, setCtrl] = useState<GroupControlValue>({
    view: kind === 'theme' ? 'list' : 'treemap', period: '1d', sort: 'chg', size: 'mcap',
  })
  const [date, setDate] = useState<string | null>(null)
  const [items, setItems] = useState<GroupItem[]>([])
  const [total, setTotal] = useState(0)
  const [groups, setGroups] = useState<TreemapGroup[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    const load = ctrl.view === 'list'
      ? getMarketGroups(kind, ctrl.period, ctrl.sort).then((r) => {
        if (cancelled) return
        setDate(r.date)
        setItems(r.items)
        setTotal(r.total)
      })
      : getMarketTreemap(kind, ctrl.size, ctrl.period).then((r) => {
        if (cancelled) return
        setDate(r.date)
        setGroups(r.groups)
      })
    load.then(() => !cancelled && setState('ready')).catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [kind, ctrl.view, ctrl.period, ctrl.sort, ctrl.size])

  const loadMore = () => {
    setLoadingMore(true)
    getMarketGroups(kind, ctrl.period, ctrl.sort, items.length)
      .then((r) => setItems((cur) => [...cur, ...r.items]))
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }

  const isList = ctrl.view === 'list'
  const empty = isList ? items.length === 0 : groups.length === 0
  // 넓은 화면 목록은 1위를 바로 보여준다(좁은 화면은 누를 때만 펼침)
  const shown = selected ?? (wide && isList ? items[0]?.id ?? null : null)
  const onSelect = (id: string) => setSelected((cur) => (!wide && isList && cur === id ? null : id))

  return (
    <div className="space-y-3 sm:space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">{TEXT[kind].title}</h1>
        <p className="mt-0.5 text-sm text-ink-muted">{TEXT[kind].desc}</p>
      </div>
      <Card>
        <GroupControls value={ctrl} onChange={setCtrl} />
      </Card>

      {state === 'failed' && (
        <Card><EmptyState emoji="⚠️" title="불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." /></Card>
      )}
      {state === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {state === 'ready' && date === null && (
        <Card><EmptyState emoji="🛠️" title="시장 데이터를 준비하고 있어요" description="매일 장 마감 후 갱신돼요." /></Card>
      )}
      {state === 'ready' && date !== null && empty && (
        <Card><EmptyState emoji="🔎" title={TEXT[kind].empty} description="다른 기간을 골라 보세요." /></Card>
      )}

      {state === 'ready' && date !== null && !empty && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-4">
          <Card>
            {isList ? (
              <>
                <p className="mb-1 text-xs text-ink-muted">{total.toLocaleString('ko-KR')}개 {TEXT[kind].title}</p>
                <GroupList
                  items={items}
                  selected={shown}
                  onSelect={onSelect}
                  showRank={ctrl.period === '1d' && ctrl.sort === 'chg'}
                  renderInline={wide ? undefined : (id) => <GroupDetailView kind={kind} id={id} />}
                />
                {items.length < total && (
                  <button type="button" onClick={loadMore} disabled={loadingMore}
                    className="mt-2 w-full rounded-btn bg-fill py-2.5 text-sm font-medium text-ink disabled:opacity-60">
                    {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(GROUP_PAGE, total - items.length)}개)`}
                  </button>
                )}
              </>
            ) : (
              <Treemap
                groups={groups}
                period={ctrl.period}
                nested={wide}
                height={wide ? 560 : 440}
                onGroupSelect={setSelected}
                note={kind === 'theme' ? '거래대금 상위 30개 테마 · 한 종목이 여러 테마에 겹칠 수 있어요' : undefined}
              />
            )}
          </Card>
          {wide && shown && (
            <Card as="aside" className="lg:sticky lg:top-[7.5rem]">
              <GroupDetailView kind={kind} id={shown} />
            </Card>
          )}
          {!wide && !isList && shown && (
            <Card className="mt-3">
              <GroupDetailView kind={kind} id={shown} />
            </Card>
          )}
        </div>
      )}
      <BasisNote date={date} />
    </div>
  )
}
