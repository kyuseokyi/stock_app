import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Card from '../../components/ui/Card'
import { chipClass } from '../../components/ui/Chip'
import EmptyState from '../../components/ui/EmptyState'
import EventList from '../../components/market/EventList'
import { getMarketCalendar } from '../../api/market'
import { useReturnRefresh } from '../../hooks/useReturnRefresh'
import { useQueryFetchedAt } from '../../hooks/useQueryFetchedAt'
import { marketQueries } from '../../queries/marketQueries'
import { kstDateString } from '../../lib/format'
import PageHeader from '../../components/ui/PageHeader'
import { ListSkeleton } from '../../components/ui/Skeleton'

const CATEGORIES: [string | undefined, string][] = [[undefined, '전체'], ['공모주', '공모주'], ['경제지표', '경제지표']]

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// 일정 탭 — 지난 7일(접힘) + 오늘부터 60일. 공모주 청약·상장, 미국 경제지표 발표.
export default function CalendarTab() {
  const today = kstDateString()
  const [category, setCategory] = useState<string | undefined>(undefined)
  const [showPast, setShowPast] = useState(false)
  const start = shift(today, -7)
  const end = shift(today, 60)
  const qc = useQueryClient()
  const calendar = marketQueries.calendar(start, end, category)
  const query = useQuery(calendar)
  const events = query.data ?? []
  const state: 'loading' | 'ready' | 'failed' = query.isPending ? 'loading' : query.isError ? 'failed' : 'ready'
  const fetchedAt = useQueryFetchedAt(query) // 마지막 조회가 끝난 시각(복귀 재조회 판정용)

  // 일정은 하루 두 번 바뀐다 — 타이머 없이 탭 복귀 때 마지막 조회 후 10분이 지났으면 1회만 조용히 다시 받는다.
  // 실패는 삼키고 보이던 목록을 그대로 둔다(그래서 refetch 대신 직접 받아 캐시에 넣는다 — 분류가 바뀌었으면 그 분류 칸에 들어간다)
  useReturnRefresh(async () => {
    try {
      qc.setQueryData(calendar.queryKey, await getMarketCalendar(start, end, category))
    } finally {
      fetchedAt.current = Date.now()
    }
  }, fetchedAt)

  const past = events.filter((e) => e.date < today)
  const upcoming = events.filter((e) => e.date >= today)

  return (
    <div className="space-y-3 sm:space-y-4">
      <PageHeader title="일정" description="공모주 청약·상장일과 미국 주요 경제지표 발표일이에요." />
      <div className="flex gap-2">
        {CATEGORIES.map(([v, label]) => (
          <button key={label} type="button" aria-pressed={category === v} onClick={() => setCategory(v)} className={chipClass(category === v)}>
            {label}
          </button>
        ))}
      </div>
      {state === 'failed' && <Card><EmptyState emoji="⚠️" title="일정을 불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." /></Card>}
      {state === 'loading' && <ListSkeleton rows={5} label="일정을 불러오고 있어요" />}
      {state === 'ready' && (
        <Card className="space-y-4">
          {past.length > 0 && (
            <div>
              <button type="button" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-ink-muted hover:text-ink">
                {showPast ? '지난 일정 접기 ▲' : `지난 7일 일정 ${past.length}개 보기 ▼`}
              </button>
              {showPast && <div className="mt-3"><EventList events={past} today={today} /></div>}
            </div>
          )}
          {upcoming.length > 0 ? (
            <EventList events={upcoming} today={today} />
          ) : (
            <EmptyState emoji="🗓️" title="앞으로 60일 안에 잡힌 일정이 없어요" description="새 일정은 매일 아침 수집돼요." />
          )}
        </Card>
      )}
    </div>
  )
}
