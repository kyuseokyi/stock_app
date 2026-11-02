import { useEffect, useRef, useState } from 'react'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import BasisNote from '../../components/market/BasisNote'
import GroupControls, { type GroupControlValue } from '../../components/market/GroupControls'
import GroupDetailView from '../../components/market/GroupDetailView'
import GroupList from '../../components/market/GroupList'
import { GROUP_PAGE, getMarketGroups } from '../../api/market'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useReturnRefresh } from '../../hooks/useReturnRefresh'
import { closeBasisLabel } from '../../lib/format'
import type { GroupItem, GroupKind } from '../../types/market'
import PageHeader from '../../components/ui/PageHeader'
import { ListSkeleton } from '../../components/ui/Skeleton'
import Button from '../../components/ui/Button'

const TEXT: Record<GroupKind, { title: string; desc: string; empty: string }> = {
  theme: {
    title: '테마',
    desc: '테마에 속한 종목들의 평균 등락률로 순위를 매겨요. 3종목 이상인 테마만 순위에 들어가요.',
    empty: '순위에 든 테마가 없어요',
  },
  sector: {
    title: '업종',
    desc: '업종에 속한 종목들의 평균 등락률로 순위를 매겨요.',
    empty: '업종 데이터가 없어요',
  },
}

// 테마·업종 탭(같은 화면, kind 만 다름) — 넓은 화면은 오른쪽 상세, 좁은 화면은 펼침.
export default function GroupTab({ kind }: { kind: GroupKind }) {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [ctrl, setCtrl] = useState<GroupControlValue>({ period: '1d', sort: 'chg' })
  const [date, setDate] = useState<string | null>(null)
  const [items, setItems] = useState<GroupItem[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const fetchedAt = useRef<number | null>(null) // 마지막 조회가 끝난 시각(복귀 재조회 판정용)
  const loadSeq = useRef(0) // 조건이 바뀌면 진행 중인 복귀 재조회 응답을 버린다

  useEffect(() => {
    let cancelled = false
    loadSeq.current += 1
    setState('loading')
    getMarketGroups(kind, ctrl.period, ctrl.sort)
      .then((r) => {
        if (cancelled) return
        setDate(r.date)
        setItems(r.items)
        setTotal(r.total)
      })
      .then(() => !cancelled && setState('ready'))
      .catch(() => !cancelled && setState('failed'))
      .finally(() => {
        fetchedAt.current = Date.now()
      })
    return () => {
      cancelled = true
    }
  }, [kind, ctrl.period, ctrl.sort])

  // 순위는 기준일(20:30 갱신)이 바뀔 때만 달라진다 — 탭 복귀 때 마지막 조회 후 10분이 지났으면 1회만 조용히 확인하고,
  // 기준일이 같으면 더 불러온 목록을 그대로 둔다
  useReturnRefresh(async () => {
    const seq = loadSeq.current
    try {
      const r = await getMarketGroups(kind, ctrl.period, ctrl.sort)
      if (seq !== loadSeq.current || (state === 'ready' && r.date === date)) return
      setDate(r.date)
      setItems(r.items)
      setTotal(r.total)
      setState('ready')
    } finally {
      fetchedAt.current = Date.now()
    }
  }, fetchedAt)

  const loadMore = () => {
    setLoadingMore(true)
    getMarketGroups(kind, ctrl.period, ctrl.sort, items.length)
      .then((r) => setItems((cur) => [...cur, ...r.items]))
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }

  const empty = items.length === 0
  // 넓은 화면 목록은 1위를 바로 보여준다(좁은 화면은 누를 때만 펼침)
  const shown = selected ?? (wide ? items[0]?.id ?? null : null)
  const onSelect = (id: string) => setSelected((cur) => (!wide && cur === id ? null : id))

  return (
    <div className="space-y-3 sm:space-y-4">
      <PageHeader title={TEXT[kind].title} description={TEXT[kind].desc} />
      <Card>
        <GroupControls value={ctrl} onChange={setCtrl} />
      </Card>

      {state === 'failed' && (
        <Card><EmptyState emoji="⚠️" title="불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." /></Card>
      )}
      {state === 'loading' && <ListSkeleton />}
      {state === 'ready' && date === null && (
        <Card><EmptyState emoji="🛠️" title="시장 데이터를 준비하고 있어요" description="매일 장 마감 후 갱신돼요." /></Card>
      )}
      {state === 'ready' && date !== null && empty && (
        <Card><EmptyState emoji="🔎" title={TEXT[kind].empty} description="다른 기간을 골라 보세요." /></Card>
      )}

      {state === 'ready' && date !== null && !empty && (
        <div className={wide && shown ? 'lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-4' : ''}>
          <Card>
            <p className="mb-1 text-xs text-ink-muted">{total.toLocaleString('ko-KR')}개 {TEXT[kind].title} · {closeBasisLabel(date)}</p>
            <GroupList
              items={items}
              selected={shown}
              onSelect={onSelect}
              showRank={ctrl.period === '1d' && ctrl.sort === 'chg'}
              renderInline={wide ? undefined : (id) => <GroupDetailView kind={kind} id={id} asOf={date} />}
            />
            {items.length < total && (
              <Button variant="tertiary" full className="mt-2" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(GROUP_PAGE, total - items.length)}개)`}
              </Button>
            )}
          </Card>
          {wide && shown && (
            <Card as="aside" className="lg:sticky lg:top-[7.5rem]">
              <GroupDetailView kind={kind} id={shown} asOf={date} />
            </Card>
          )}
        </div>
      )}
      <BasisNote date={date} />
    </div>
  )
}
