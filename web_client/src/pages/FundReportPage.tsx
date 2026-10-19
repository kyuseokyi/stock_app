import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import FundReportView from '../components/fund/FundReportView'
import Button from '../components/ui/Button'
import {
  defaultName,
  displayName,
  evalDateOf,
  formatChecked,
  formatValue,
  renameFund,
  useFundReport,
  type FundEntry,
} from '../lib/fundCore'
import { loadFunds, localCache, saveFunds } from '../lib/fundStore'
import { useAuthStore } from '../store/auth'
import { fundRefresher } from '../lib/fundAutoRefresh'

// 펀드 리포트(/me/funds/:id) — 캐시를 먼저 보여주고 열 때마다 원본을 다시 가져온다.
export default function FundReportPage() {
  const { id } = useParams()
  return <FundReportBody key={id} id={id} />
}

// key={id} 로 :id 가 바뀌면 상태를 새로 만든다(다른 펀드 리포트로 이동)
function FundReportBody({ id }: { id: string | undefined }) {
  const user = useAuthStore((s) => s.user)
  const [fund, setFund] = useState<FundEntry | null>(() => loadFunds().find((f) => f.id === id) ?? null)
  const { entry, refreshing, error, refresh, reload } = useFundReport(fund, localCache)

  // 이름 없이 등록한 펀드는 첫 리포트로 기본 이름을 붙여 저장
  useEffect(() => {
    if (!fund || fund.name || !entry) return
    const name = defaultName(entry.report)
    saveFunds(renameFund(loadFunds(), fund.id, name))
    setFund({ ...fund, name })
  }, [fund, entry])

  // 자동 갱신이 이 펀드를 새로 가져왔으면 캐시만 다시 읽어 반영(다시 가져오지 않음)
  useEffect(
    () =>
      fundRefresher.subscribe(() => {
        const s = fundRefresher.getStatus()
        if (!s.running && fund && s.refreshedIds.includes(fund.id)) reload()
      }),
    [fund, reload],
  )

  if (!user) return <Navigate to="/me" replace />
  if (!fund) {
    return (
      <div className="rounded-card bg-surface p-6 text-center">
        <p className="font-semibold text-ink">펀드를 찾을 수 없어요</p>
        <Link to="/me/funds" className="mt-3 inline-block text-sm text-brand">
          목록으로
        </Link>
      </div>
    )
  }

  const evalDate = entry ? formatValue('', evalDateOf(entry.report)).text : '' // YYYY.MM.DD
  return (
    <div className="mx-auto max-w-[680px]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/me/funds" className="text-sm text-ink-muted">
            ‹ 내 펀드
          </Link>
          <h1 className="mt-1 text-xl font-bold text-ink">{displayName(fund)}</h1>
          {entry && (
            <p className="mt-0.5 text-sm text-ink-muted">
              {evalDate ? `기준일 ${evalDate} · ` : ''}마지막 확인 {formatChecked(entry.fetchedAt, Date.now())}
            </p>
          )}
        </div>
        <Button variant="secondary" onClick={refresh} loading={refreshing} loadingText="확인 중…">
          새로고침
        </Button>
      </div>

      {entry && error === 'fetch' && <Banner>최신 정보를 못 가져왔어요. 저장된 내용을 보여드려요.</Banner>}
      {error === 'format' && <Banner sourceUrl={fund.url}>원본 형식이 바뀌어 최신 내용을 읽을 수 없어요.</Banner>}
      {entry && entry.missing.length > 0 && <Banner sourceUrl={fund.url}>일부 항목이 빠졌을 수 있어요.</Banner>}

      {entry ? (
        <FundReportView report={entry.report} />
      ) : error === 'fetch' ? (
        <div className="rounded-card bg-surface p-6 text-center">
          <p className="font-semibold text-ink">펀드 현황을 가져오지 못했어요</p>
          <Button className="mt-4" onClick={refresh}>
            다시 시도
          </Button>
        </div>
      ) : error ? null : (
        <p className="py-16 text-center text-ink-muted">불러오는 중…</p>
      )}
    </div>
  )
}

function Banner({ children, sourceUrl }: { children: ReactNode; sourceUrl?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-field bg-up-soft px-4 py-3 text-sm text-ink">
      <span>{children}</span>
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-up">
          원본 열기 →
        </a>
      )}
    </div>
  )
}
