import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import LegacyImportModal from '../components/fund/LegacyImportModal'
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
import {
  deleteCache,
  discardLegacyFunds,
  loadFunds,
  localCache,
  previewLegacyImport,
  saveFunds,
  type LegacyPreview,
} from '../lib/fundStore'
import { fundRefresher } from '../lib/fundAutoRefresh'
import { useAuthStore } from '../store/auth'
import { showToast } from '../store/toast'

// 내 펀드 수익(/me/funds) — 이 브라우저에 저장한 fund.ivyro.net 펀드 현황 주소 목록. 서버에는 저장하지 않는다.
// 목록은 로그인 계정별(2026-10-23). key={uid} 로 계정이 바뀌면 화면 상태를 새로 만든다 — 이전 계정 목록이 새 계정에 저장되지 않게.
export default function FundListPage() {
  const uid = useAuthStore((s) => s.user?.id ?? null)
  if (uid === null) return <Navigate to="/me" replace />
  return <FundListBody key={uid} uid={uid} />
}

function FundListBody({ uid }: { uid: number }) {
  const [funds, setFunds] = useState<FundEntry[]>(() => loadFunds(uid))
  // 옛 공용 목록(계정별 저장 전) 가져오기 안내 — 닫으면 이번 방문 동안만 숨김(다음 방문 때 다시)
  const [legacy, setLegacy] = useState<LegacyPreview | null>(() => previewLegacyImport(uid))
  const [legacyClosed, setLegacyClosed] = useState(false)
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

  const handleAdd = (e: FormEvent) => {
    e.preventDefault()
    try {
      const next = addFund(funds, { name, url }, newFundId())
      if (!saveFunds(next, uid)) throw new Error('save failed')
      setFunds(next)
      setLegacy(previewLegacyImport(uid))
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
    if (!saveFunds(next, uid)) {
      showToast('지우지 못했어요. 다시 시도해 주세요.')
      return
    }
    deleteCache(f.id)
    setFunds(next)
    setLegacy(previewLegacyImport(uid)) // 자리가 나면 남겨 둔 옛 펀드를 다시 가져올 수 있다
  }

  const handleLegacyDone = () => {
    setFunds(loadFunds(uid))
    setLegacy(previewLegacyImport(uid))
    setLegacyClosed(true) // 남은 펀드가 있어도 이번 방문엔 다시 띄우지 않는다
    void fundRefresher.run() // 가져온 펀드의 리포트를 받아 둔다(10분 이내 확인한 펀드는 건너뜀)
  }

  // 목록이 꽉 차 하나도 못 가져오는 경우 — 창을 반복해 띄우지 않고 버리기만 제안하는 카드
  const handleLegacyDiscard = () => {
    if (!legacy) return
    if (!window.confirm(`이 브라우저에 저장된 펀드 ${legacy.count}개를 지울까요? 되돌릴 수 없어요.`)) return
    discardLegacyFunds(uid)
    showToast('이 브라우저에 저장된 펀드를 지웠어요.')
    setLegacy(null)
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

      {legacy?.full && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-card bg-surface p-5">
          <p className="text-sm text-ink-muted">
            이 브라우저에 저장된 펀드 {legacy.count}개가 있지만, 이 계정은 등록 한도가 꽉 차서 더 가져올 수 없어요.
          </p>
          <Button variant="secondary" className="shrink-0" onClick={handleLegacyDiscard}>
            버리기
          </Button>
        </div>
      )}
      {legacy && !legacy.full && !legacyClosed && (
        <LegacyImportModal
          uid={uid}
          preview={legacy}
          onClose={() => setLegacyClosed(true)}
          onDone={handleLegacyDone}
        />
      )}

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
