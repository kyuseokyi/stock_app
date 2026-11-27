import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import BasisNote from '../../components/market/BasisNote'
import GroupControls, { type GroupControlValue } from '../../components/market/GroupControls'
import GroupDetailView from '../../components/market/GroupDetailView'
import GroupList from '../../components/market/GroupList'
import { GROUP_PAGE, getMarketGroups } from '../../api/market'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useReturnRefresh } from '../../hooks/useReturnRefresh'
import { useQueryFetchedAt } from '../../hooks/useQueryFetchedAt'
import { marketQueries } from '../../queries/marketQueries'
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const qc = useQueryClient()
  // 첫 쪽은 Query, '더 보기'로 이어 붙인 쪽은 화면이 들고 있다(조건이 바뀌면 비운다)
  const groups = marketQueries.groups(kind, ctrl.period, ctrl.sort)
  const query = useQuery(groups)
  const condKey = groups.queryKey.join('|')
  const [more, setMore] = useState<{ key: string; items: GroupItem[] }>({ key: condKey, items: [] })
  if (more.key !== condKey) setMore({ key: condKey, items: [] })
  const date = query.data?.date ?? null
  const total = query.data?.total ?? 0
  const items = query.data ? (more.key === condKey ? [...query.data.items, ...more.items] : query.data.items) : []
  const state: 'loading' | 'ready' | 'failed' = query.isPending ? 'loading' : query.isError ? 'failed' : 'ready'
  const fetchedAt = useQueryFetchedAt(query) // 마지막 조회가 끝난 시각(복귀 재조회 판정용)

  // 순위는 기준일(20:30 갱신)이 바뀔 때만 달라진다 — 탭 복귀 때 마지막 조회 후 10분이 지났으면 1회만 조용히 확인하고,
  // 기준일이 같으면 더 불러온 목록을 그대로 둔다. 실패는 삼키고 보이던 값을 둔다(그래서 refetch 대신 직접 받아 캐시에 넣는다)
  useReturnRefresh(async () => {
    try {
      const r = await getMarketGroups(kind, ctrl.period, ctrl.sort)
      const cur = qc.getQueryState(groups.queryKey)
      if (cur?.status === 'success' && r.date === cur.data?.date) return
      qc.setQueryData(groups.queryKey, r)
      setMore((m) => (m.key === condKey ? { key: condKey, items: [] } : m))
    } finally {
      fetchedAt.current = Date.now()
    }
  }, fetchedAt)

  const loadMore = () => {
    const key = condKey
    setLoadingMore(true)
    getMarketGroups(kind, ctrl.period, ctrl.sort, items.length)
      // 조건이 바뀐 뒤 늦게 온 응답은 새 목록에 붙이지 않는다
      .then((r) => setMore((m) => (m.key === key ? { key, items: [...m.items, ...r.items] } : m)))
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
