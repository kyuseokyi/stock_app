import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import {
  addFund,
  displayName,
  fundStatusLine,
  isFundError,
  MAX_NAME,
  newFundId,
  readValidCache,
  removeFund,
  useAutoRefreshStatus,
  type FundEntry,
} from '../lib/fundCore'
import { deleteCache, loadFunds, localCache, saveFunds } from '../lib/fundStore'
import { fundRefresher } from '../lib/fundAutoRefresh'
import { useAuthStore } from '../store/auth'

// 내 펀드 수익(/me/funds) — 이 브라우저에 저장한 fund.ivyro.net 펀드 현황 주소 목록. 서버에는 저장하지 않는다.
export default function FundListPage() {
  const user = useAuthStore((s) => s.user)
  const [funds, setFunds] = useState<FundEntry[]>(() => loadFunds())
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const status = useAutoRefreshStatus(fundRefresher)
  const [lines, setLines] = useState<Record<string, string>>({})

  // 목록 한 줄(기준일·확인 시각) — 목록이 바뀌거나 자동 갱신이 끝날 때마다 캐시를 다시 읽는다
  useEffect(() => {
    let alive = true
    const now = Date.now()
    void Promise.all(
      funds.map(async (f) => [f.id, fundStatusLine(await readValidCache(localCache, f.id), now)] as const),
    ).then((pairs) => {
      if (alive) setLines(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [funds, status.version])

  if (!user) return <Navigate to="/me" replace />

  const handleAdd = (e: FormEvent) => {
    e.preventDefault()
    try {
      const next = addFund(funds, { name, url }, newFundId())
      saveFunds(next)
      setFunds(next)
      setName('')
      setUrl('')
      setError('')
    } catch (err) {
      setError(isFundError(err, 'input') ? err.message : '저장하지 못했어요. 다시 시도해 주세요.')
    }
  }

  const handleRemove = (f: FundEntry) => {
    if (!window.confirm(`${displayName(f)}을(를) 목록에서 지울까요?`)) return
    const next = removeFund(funds, f.id)
    saveFunds(next)
    deleteCache(f.id)
    setFunds(next)
  }

  const inputCls =
    'mt-1 w-full rounded-field bg-fill px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-brand'

  return (
    <div>
      <Link to="/me" className="text-sm text-ink-muted">
        ‹ 내정보
      </Link>
      <h1 className="mb-5 mt-1 text-xl font-bold text-ink">
        내 펀드 수익
        {status.running && <span className="ml-2 text-xs font-normal text-ink-muted">확인 중…</span>}
      </h1>

      <form onSubmit={handleAdd} className="rounded-card bg-surface p-5">
        <label htmlFor="fund-url" className="block text-sm text-ink-muted">
          펀드 현황 주소
        </label>
        <input
          id="fund-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          autoComplete="off"
          placeholder="https://fund.ivyro.net/dataroom/om_data/…"
          className={inputCls}
        />
        <label htmlFor="fund-name" className="mt-3 block text-sm text-ink-muted">
          이름 (선택)
        </label>
        <input
          id="fund-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME}
          placeholder="비우면 투자자 번호로 정해져요"
          className={inputCls}
        />
        {error && <p className="mt-2 text-sm text-up">{error}</p>}
        <Button type="submit" full className="mt-4" disabled={!url.trim()}>
          추가
        </Button>
      </form>

      {funds.length === 0 ? (
        <p className="mt-6 text-center text-sm text-ink-muted">
          등록한 펀드가 없어요. fund.ivyro.net 에서 받은 내 펀드 현황 주소를 붙여 넣어 주세요.
        </p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-card bg-surface">
          {funds.map((f) => (
            <li key={f.id} className="flex items-center border-b border-line last:border-0">
              <Link
                to={`/me/funds/${f.id}`}
                className="flex flex-1 items-center justify-between px-5 py-4 text-ink hover:bg-line"
              >
                <span className="min-w-0">
                  <span className="block">📈 {displayName(f)}</span>
                  {lines[f.id] && (
                    <span className="mt-0.5 block text-xs tabular-nums text-ink-muted">{lines[f.id]}</span>
                  )}
                </span>
                <span className="text-ink-muted">›</span>
              </Link>
              <button
                type="button"
                onClick={() => handleRemove(f)}
                className="px-4 py-4 text-sm text-ink-muted hover:text-up"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
