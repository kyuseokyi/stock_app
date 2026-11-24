import { useEffect, useState } from 'react'
import { getRolePolicies, updateRolePolicy } from '../../api/adminAccounts'
import { apiErrorMessage } from '../../lib/apiError'
import { showToast } from '../../lib/toast'
import type { AdminPermissionKey, EditableTier, RolePolicies } from '../../types/api'

// 등급별 권한 표 — 행: 권한, 열: 슈퍼 관리자(고정) · 운영 · 분석 · 에디터. 칸을 눌러 바꾸고 등급마다 저장.
// '관리자 계정·등급 관리'는 슈퍼 관리자 고정이라 누를 수 없다.

export default function TierPolicyMatrix({ onLoaded }: { onLoaded?: (p: RolePolicies) => void }) {
  const [data, setData] = useState<RolePolicies | null>(null)
  const [draft, setDraft] = useState<Record<string, AdminPermissionKey[]>>({})
  const [saving, setSaving] = useState<EditableTier | null>(null)
  const [error, setError] = useState('')

  const apply = (p: RolePolicies) => {
    setData(p)
    setDraft(Object.fromEntries(p.tiers.map((t) => [t.tier, t.permissions])))
    onLoaded?.(p)
  }

  useEffect(() => {
    getRolePolicies().then(apply).catch((e) => setError(apiErrorMessage(e, '권한 표를 불러오지 못했어요.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
  if (!data) return <p className="text-sm text-slate-400">권한 표를 불러오는 중…</p>

  const toggle = (tier: EditableTier, key: AdminPermissionKey) =>
    setDraft((d) => {
      const cur = d[tier] ?? []
      return { ...d, [tier]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] }
    })

  const changed = (tier: EditableTier) => {
    const saved = data.tiers.find((t) => t.tier === tier)?.permissions ?? []
    const cur = draft[tier] ?? []
    return saved.length !== cur.length || saved.some((k) => !cur.includes(k))
  }

  const save = async (tier: EditableTier) => {
    setSaving(tier)
    try {
      apply(await updateRolePolicy(tier, draft[tier] ?? []))
      showToast('등급 권한을 저장했어요. 그 등급 관리자에게 바로 적용돼요.', { icon: '✅' })
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">권한</th>
            <th className="px-3 py-2">슈퍼 관리자</th>
            {data.tiers.map((t) => (
              <th key={t.tier} className="px-3 py-2">{t.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.permissions.map((p) => (
            <tr key={p.key} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <p className="font-medium text-slate-800">{p.label}</p>
                <p className="text-xs text-slate-400">{p.description}</p>
              </td>
              <td className="px-3 py-2 text-center text-emerald-600" aria-label="항상 허용">✔</td>
              {data.tiers.map((t) => {
                const on = (draft[t.tier] ?? []).includes(p.key)
                return (
                  <td key={t.tier} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!p.grantable || saving !== null}
                      onChange={() => toggle(t.tier, p.key)}
                      aria-label={`${t.label} — ${p.label}`}
                      className="h-4 w-4 accent-indigo-600 disabled:opacity-40"
                    />
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="border-t border-slate-200 bg-slate-50">
            <td className="px-3 py-2 text-xs text-slate-500">등급마다 저장</td>
            <td />
            {data.tiers.map((t) => (
              <td key={t.tier} className="px-3 py-2 text-center">
                <button
                  type="button"
                  disabled={!changed(t.tier) || saving !== null}
                  onClick={() => void save(t.tier)}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs text-white disabled:opacity-40"
                >
                  {saving === t.tier ? '저장 중…' : '저장'}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
