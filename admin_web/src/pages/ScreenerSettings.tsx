import { useCallback, useEffect, useState } from 'react'
import { listScreenerFeatures, updateScreenerFeature, type ScreenerFeature, type ScreenerFeatureKey } from '../api/screenerFeatures'
import { apiErrorMessage } from '../lib/apiError'
import { formatDateTime } from '../lib/marketFormat'
import { showToast } from '../lib/toast'

// 스크리너 탭 보이기 — 다듬는 중인 탭을 사용자 화면(웹·앱)에서 숨기거나 다시 연다. 기본은 꺼짐.
// 목록 순서는 서버(KNOWN) 순서 — 종목 찾기 전체가 맨 위. 관리자 화면(주도주·패턴 관리 등)은 이 스위치와 무관하게 항상 보인다.
const META: Record<ScreenerFeatureKey, { title: string; description: string; warning?: string }> = {
  STOCK_FINDER: {
    title: '종목 찾기(사용자 화면)',
    description: '끄면 웹·앱에서 주도주·조건검색·패턴이 모두 숨겨져요(관리자 화면은 그대로)',
  },
  FINDER: {
    title: '조건검색 탭',
    description: '끄면 웹·앱 스크리너의 "종목 찾기"에서 조건검색 탭이 사라지고, 주소로 들어와도 주도주 탭으로 보냅니다.',
  },
  PATTERNS: {
    title: '차트 패턴 탭',
    description: '끄면 "종목 찾기"에서 패턴 탭이 사라집니다. 종목 상세의 차트 패턴 카드와 주도주의 "오늘 볼 10개"는 그대로 보입니다.',
  },
  MARKET_DATA: {
    title: '사용자 시세 노출',
    description:
      '끄면(기본) 서버가 일반 사용자에게 시세(지수·차트·순위·스크리너·대차·급등락 등)를 주지 않아요. 관리자와 회원 관리에서 시세 열람 권한을 준 계정은 계속 볼 수 있어요.',
    warning: '켜려면 KRX/코스콤 라이선스 필요',
  },
}

export default function ScreenerSettings() {
  const [items, setItems] = useState<ScreenerFeature[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pending, setPending] = useState<ScreenerFeatureKey | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    listScreenerFeatures()
      .then((rows) => setItems(rows.filter((f) => f.key in META)))
      .catch((e: unknown) => {
        setLoadFailed(true)
        showToast(apiErrorMessage(e), { icon: '⚠️' })
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (item: ScreenerFeature) => {
    const next = !item.enabled
    // 사용자 시세 노출을 켜면 일반 사용자에게 KIS 시세가 나간다 — 라이선스 없이 켜면 재배포(A안 설계)
    if (item.key === 'MARKET_DATA' && next && !confirm('사용자 시세 노출을 켤까요?\nKRX/코스콤 시세 라이선스가 있어야 켤 수 있어요.')) return
    setPending(item.key)
    setItems((prev) => prev.map((f) => (f.key === item.key ? { ...f, enabled: next } : f)))
    try {
      const saved = await updateScreenerFeature(item.key, next)
      setItems((prev) => prev.map((f) => (f.key === saved.key ? saved : f)))
      showToast(`${META[item.key].title} ${next ? '보이기' : '숨기기'}`, { icon: next ? '✅' : '⏸️' })
    } catch (e) {
      setItems((prev) => prev.map((f) => (f.key === item.key ? { ...f, enabled: item.enabled } : f)))
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-2xl font-bold text-slate-900">스크리너 탭</h2>
      <p className="mb-6 text-sm text-slate-500">
        사용자 화면(웹·앱)의 스크리너에서 보일 탭을 고릅니다. 서버 재시작 없이 최대 30초 안에 반영되고, 웹은 새로고침, 앱은 스크리너 탭에 다시 들어올 때 바뀝니다.
      </p>
      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : loadFailed ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-center">
          <p className="text-sm text-slate-600">설정을 불러오지 못했습니다.</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
            >
              <div>
                <p id={`screener-feature-${item.key}`} className="font-medium text-slate-900">
                  {META[item.key].title}
                  <span className={`ml-2 text-xs font-semibold ${item.enabled ? 'text-indigo-600' : 'text-slate-400'}`}>
                    {item.enabled ? '보이는 중' : '숨김'}
                  </span>
                </p>
                <p className="mt-1 text-sm text-slate-500">{META[item.key].description}</p>
                {META[item.key].warning && (
                  <p className="mt-1 text-sm font-medium text-amber-700">⚠️ {META[item.key].warning}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">마지막 변경: {item.updated_at ? formatDateTime(item.updated_at) : '변경 이력 없음'}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={item.enabled}
                aria-labelledby={`screener-feature-${item.key}`}
                disabled={pending !== null}
                onClick={() => toggle(item)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                  item.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${item.enabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
