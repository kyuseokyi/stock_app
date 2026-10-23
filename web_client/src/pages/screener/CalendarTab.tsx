import { useEffect, useState } from 'react'
import Card from '../../components/ui/Card'
import { chipClass } from '../../components/ui/Chip'
import EmptyState from '../../components/ui/EmptyState'
import BasisNote from '../../components/market/BasisNote'
import EventList from '../../components/market/EventList'
import { getMarketCalendar } from '../../api/market'
import { kstDateString } from '../../lib/format'
import type { CalendarEvent } from '../../types/market'
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
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getMarketCalendar(shift(today, -7), shift(today, 60), category)
      .then((e) => {
        if (cancelled) return
        setEvents(e)
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [category, today])

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
      <BasisNote date={null} />
    </div>
  )
}
