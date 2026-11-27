import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { NewsResult } from '../../api/dailySurge'
import { screenerQueries } from '../../queries/screenerQueries'
import { SLOT_CLASS, SLOT_LABEL, slotTime } from '../../lib/dailySurge'

// 네이버 뉴스 검색 결과 — 받은 순서·개수 그대로, 기사마다 시각 배지만(약관 N1~N8, docs/naver-search-api-terms-issue.md).
// 이 목록을 다시 정렬·필터하거나 AI 문장과 섞지 않는다. 저장도 하지 않는다(서버가 5분만 캐시).
export default function NaverNewsList({ kind, date, target }: { kind: 'stock' | 'theme'; date: string; target: string }) {
  const q = useQuery(screenerQueries.dailySurge.news(kind, date, target))
  // 마지막으로 받은 결과 — 대상이 바뀌어 다시 받는 동안에도 머리글 검색어는 직전 값(지금 동작)
  const [data, setData] = useState<NewsResult | null>(null)
  if (q.data !== undefined && q.data !== data) setData(q.data)
  // 받은 결과가 있으면 재조회가 실패해도 그대로 보인다 — 실패 안내는 결과가 없을 때만
  const state: 'loading' | 'ok' | 'failed' = q.isPending ? 'loading' : q.isError && q.data === undefined ? 'failed' : 'ok'

  return (
    <section className="flex flex-col gap-2" aria-label="네이버 뉴스 검색 결과">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">
          네이버 뉴스 검색 결과
          {data && <span className="ml-1 font-normal text-ink-muted">'{data.query}' · 최신순</span>}
        </h3>
        <span className="text-xs font-bold text-naver">NAVER</span>
      </div>
      {state === 'loading' && <p className="text-sm text-ink-muted">뉴스를 불러오는 중…</p>}
      {(state === 'failed' || (state === 'ok' && data?.unavailable)) && (
        <p className="text-sm text-ink-muted">뉴스가 없거나 불러오지 못했습니다.</p>
      )}
      {state === 'ok' && data && !data.unavailable && (
        <ul className="flex flex-col">
          {data.items.map((n, i) => (
            <li key={`${i}-${n.url}`} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-ink">
                  <span className={`mr-1 rounded-sm px-1.5 py-0.5 text-xs font-medium ${SLOT_CLASS[n.time_slot]}`}>
                    {SLOT_LABEL[n.time_slot]}
                  </span>
                  {n.title}
                </p>
                <span className="text-xs text-ink-muted">{n.press_domain} · {slotTime(n.published_at)}</span>
              </div>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-brand-strong hover:underline">
                원문 보기
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">
        받은 순서 그대로 보여 주고 저장하지 않습니다. 배지: 장전 = 직전 거래일 15:30~09:00, 장중 = 09:00~15:30, 장후 = 15:30 이후.
      </p>
    </section>
  )
}
