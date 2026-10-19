import { useCallback, useEffect, useRef, useState } from 'react'
import { addThemeStock, excludeThemeStock, listThemeStocks, updateTheme } from '../../api/marketAdmin'
import { apiErrorMessage } from '../../lib/apiError'
import { formatPct, pctClass } from '../../lib/marketFormat'
import { showToast } from '../../lib/toast'
import type { AdminTheme, ThemeStockRow } from '../../types/marketAdmin'
import StockSearchAdd from './StockSearchAdd'

export const THEME_SAVED_MESSAGE = '저장했어요. 테마 순위는 잠시 뒤 다시 계산돼요'

interface Props {
  theme: AdminTheme
  onChanged: () => void
  onClose: () => void
}

const chgKey = (s: ThemeStockRow): number => s.chg_1d ?? -1e9

export default function ThemeDetail({ theme, onChanged, onClose }: Props) {
  const [name, setName] = useState(theme.name)
  const [description, setDescription] = useState(theme.description ?? '')
  const [stocks, setStocks] = useState<ThemeStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0) // 늦게 온 이전 응답이 최신 목록을 덮어쓰지 않게

  const loadStocks = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const rows = await listThemeStocks(theme.id)
      if (my === seq.current) setStocks(rows)
    } catch (e) {
      if (my === seq.current) showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [theme.id])

  useEffect(() => {
    void loadStocks()
  }, [loadStocks])

  // 바꾸는 요청 공통 — 성공하면 안내·목록 새로고침, 실패하면 오류 토스트. 성공 여부를 돌려준다.
  const act = async (fn: () => Promise<unknown>, reloadStocks = false): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      showToast(THEME_SAVED_MESSAGE)
      onChanged()
      if (reloadStocks) await loadStocks()
      return true
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const dirty = name.trim() !== theme.name || (description.trim() || null) !== (theme.description ?? null)
  const save = () => {
    if (!name.trim()) {
      showToast('테마 이름을 입력하세요', { icon: '⚠️' })
      return
    }
    void act(() => updateTheme(theme.id, { name: name.trim(), description: description.trim() || null }))
  }
  const exclude = (s: ThemeStockRow) => {
    if (!window.confirm(`${s.name ?? s.ticker} 을(를) 이 테마에서 제외할까요?`)) return
    void act(() => excludeThemeStock(theme.id, s.ticker), true)
  }

  const included = stocks.filter((s) => !s.is_excluded)
  const sorted = [...stocks].sort(
    (a, b) => Number(a.is_excluded) - Number(b.is_excluded) || chgKey(b) - chgKey(a),
  )

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-400">
            {theme.source === 'admin' ? '관리자 테마' : `KIS 테마 ${theme.kis_code ?? ''}`}
          </p>
          <h2 className="break-keep text-lg font-bold text-slate-800">{theme.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        >
          ✕
        </button>
      </div>

      <div className="space-y-2">
        <input
          value={name}
          aria-label="테마 이름"
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          value={description}
          aria-label="테마 설명"
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="설명(선택) — 웹 테마 상세에 보여요"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={save}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            저장
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => updateTheme(theme.id, { is_hidden: !theme.is_hidden }))}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {theme.is_hidden ? '다시 보이기' : '숨기기'}
          </button>
        </div>
        {theme.is_hidden && (
          <p className="text-xs text-amber-600">숨긴 테마는 웹 스크리너 테마 순위·트리맵에 나오지 않아요.</p>
        )}
      </div>

      <StockSearchAdd
        disabled={busy}
        existing={included.map((s) => s.ticker)}
        onAdd={(ticker, reason) => act(() => addThemeStock(theme.id, ticker, reason), true)}
      />

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">구성 종목 {included.length}개</p>
        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                  <th className="py-2">종목</th>
                  <th>출처</th>
                  <th className="text-right">1일</th>
                  <th className="pl-3">편입 사유</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.ticker} className={`border-b border-slate-100 ${s.is_excluded ? 'opacity-50' : ''}`}>
                    <td className="break-keep py-2">
                      <span className="font-medium text-slate-800">{s.name ?? s.ticker}</span>{' '}
                      <span className="text-xs text-slate-400">{s.ticker}</span>
                    </td>
                    <td className="text-xs text-slate-500">{s.source === 'admin' ? '관리자' : 'KIS'}</td>
                    <td className={`text-right font-medium ${pctClass(s.chg_1d)}`}>{formatPct(s.chg_1d)}</td>
                    <td className="max-w-[200px] break-keep pl-3 text-xs text-slate-500" title={s.reason ?? ''}>
                      {s.reason ?? '—'}
                    </td>
                    <td className="text-right">
                      {s.is_excluded ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(() => addThemeStock(theme.id, s.ticker, null), true)}
                          className="text-xs font-semibold text-indigo-600 disabled:opacity-40"
                        >
                          복구
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => exclude(s)}
                          className="text-xs font-semibold text-red-500 disabled:opacity-40"
                        >
                          제외
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
