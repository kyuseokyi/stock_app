import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { displayName, fundStatusLine, readValidCache, useAutoRefreshStatus } from '../../lib/fundCore'
import { fundRefresher } from '../../lib/fundAutoRefresh'
import { FUND_LOGIN_DESCRIPTION, FUNDS_PATH } from '../../lib/fundGate'
import { loadFunds, localCache } from '../../lib/fundStore'
import { homeFundCardState } from '../../lib/homeSections'
import { useAuthStore } from '../../store/auth'
import { openLogin } from '../../store/loginPrompt'
import Button from '../ui/Button'
import Card from '../ui/Card'

// 홈 최상단 '내 펀드' 카드 — 비로그인(로그인 안내) / 로그인 + 펀드 없음(등록 안내) / 펀드 있음(펀드명·기준일 한 줄).
// 펀드 목록은 서버가 아니라 이 브라우저(로그인 계정별)에 있다 — 내 펀드 화면과 같은 lib/fundStore·fundCore 로 읽는다.
// key={uid}: 계정이 바뀌면 목록을 새로 읽는다(이전 계정 펀드가 남지 않게).
export default function HomeFundCard() {
  const uid = useAuthStore((s) => s.user?.id ?? null)
  return <HomeFundCardBody key={uid ?? 'guest'} uid={uid} />
}

const linkBtn =
  'inline-flex h-11 items-center justify-center rounded-btn bg-brand px-4 text-sm font-semibold text-ink transition hover:brightness-95'

function HomeFundCardBody({ uid }: { uid: number | null }) {
  const [funds] = useState(() => loadFunds(uid))
  const state = homeFundCardState(uid, funds)
  const status = useAutoRefreshStatus(fundRefresher)
  const [lines, setLines] = useState<Record<string, string>>({})

  // 한 줄(기준일·확인 시각) — 자동 갱신이 끝날 때마다 캐시를 다시 읽는다(내 펀드 목록과 같은 방식)
  useEffect(() => {
    const s = homeFundCardState(uid, funds)
    if (s.kind !== 'funds') return
    const shown = s.funds
    let alive = true
    const now = Date.now()
    void Promise.all(
      shown.map(async (f) => [f.id, fundStatusLine(await readValidCache(localCache, f.id), now)] as const),
    ).then((pairs) => {
      if (alive) setLines(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [uid, funds, status.version])

  return (
    <section aria-labelledby="home-fund-title">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="home-fund-title" className="text-lg font-bold text-ink">
          내 펀드
          {status.running && state.kind === 'funds' && (
            <span className="ml-2 text-xs font-normal text-ink-muted">확인 중…</span>
          )}
        </h2>
        {state.kind === 'funds' && (
          <Link to={FUNDS_PATH} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">
            {state.more > 0 ? `전체 ${state.funds.length + state.more}개 보기 ›` : '전체 보기 ›'}
          </Link>
        )}
      </div>

      {state.kind === 'guest' && (
        <Card className="bg-sky-soft">
          <p className="font-bold text-ink">
            <span aria-hidden>🔒 </span>내 펀드 수익률 확인하기
          </p>
          <p className="mt-1 text-sm text-ink">로그인하면 내 펀드 수익률과 운용 리포트를 한눈에 볼 수 있어요.</p>
          <Button
            className="mt-4"
            onClick={() => openLogin({ description: FUND_LOGIN_DESCRIPTION, returnTo: FUNDS_PATH })}
          >
            로그인하고 내 펀드 보기 ›
          </Button>
        </Card>
      )}

      {state.kind === 'empty' && (
        <Card className="bg-sky-soft">
          <p className="font-bold text-ink">
            <span aria-hidden>💰 </span>등록된 펀드가 아직 없어요
          </p>
          <p className="mt-1 text-sm text-ink">내 펀드를 등록하고 수익률 리포트를 받아보세요.</p>
          <Link to={FUNDS_PATH} className={`mt-4 ${linkBtn}`}>
            + 내 펀드 등록하기 ›
          </Link>
        </Card>
      )}

      {state.kind === 'funds' && (
        <Card as="ul" padding="none" className="overflow-hidden">
          {state.funds.map((f) => (
            <li key={f.id} className="border-b border-line last:border-0">
              <Link
                to={`${FUNDS_PATH}/${f.id}`}
                className="flex items-center justify-between gap-3 px-5 py-4 text-ink transition hover:bg-line"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    <span aria-hidden>📈 </span>
                    {displayName(f)}
                  </span>
                  <span className="mt-0.5 block text-xs tabular-nums text-ink-muted">
                    {lines[f.id] || '리포트를 열어 최신 수익률을 확인해 보세요'}
                  </span>
                </span>
                <span aria-hidden className="text-ink-muted">›</span>
              </Link>
            </li>
          ))}
        </Card>
      )}
    </section>
  )
}
