import { useState } from 'react'
import { setAdminTier } from '../../api/adminAccounts'
import { apiErrorMessage } from '../../lib/apiError'
import { showToast } from '../../lib/toast'
import type { AdminAccount, AdminPermissionKey, EditableTier, PermissionMeta, TierPolicy } from '../../types/api'

// 관리자 한 명의 등급·개별 추가 권한 편집(행 아래 펼침). 개별 권한은 등급 권한에 '더하기'만 한다.

export default function AdminTierEditor({
  account,
  tiers,
  permissions,
  onSaved,
  onClose,
}: {
  account: AdminAccount
  tiers: TierPolicy[]
  permissions: PermissionMeta[]
  onSaved: (a: AdminAccount) => void
  onClose: () => void
}) {
  const [tier, setTier] = useState<EditableTier>(
    account.admin_tier && account.admin_tier !== 'SUPER_ADMIN' ? account.admin_tier : 'OPERATOR',
  )
  const [extra, setExtra] = useState<AdminPermissionKey[]>(account.custom_permissions)
  const [saving, setSaving] = useState(false)
  const fromTier = tiers.find((t) => t.tier === tier)?.permissions ?? []

  const save = async () => {
    setSaving(true)
    try {
      onSaved(await setAdminTier(account.id, tier, extra.filter((k) => !fromTier.includes(k))))
      showToast(`'${account.login_id}' 권한을 바꿨어요. 다음 요청부터 바로 적용돼요.`, { icon: '✅' })
      onClose()
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-left">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">등급</span>
        <select value={tier} onChange={(e) => setTier(e.target.value as EditableTier)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
          {tiers.map((t) => (
            <option key={t.tier} value={t.tier}>{t.label}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-600">권한(회색 = 등급에 포함, 나머지는 이 사람에게만 추가)</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {permissions.filter((p) => p.grantable).map((p) => {
            const inTier = fromTier.includes(p.key)
            return (
              <label key={p.key} className={`flex items-center gap-2 text-sm ${inTier ? 'text-slate-400' : 'text-slate-700'}`}>
                <input
                  type="checkbox"
                  checked={inTier || extra.includes(p.key)}
                  disabled={inTier}
                  onChange={() => setExtra((x) => (x.includes(p.key) ? x.filter((k) => k !== p.key) : [...x, p.key]))}
                  className="h-4 w-4 accent-indigo-600"
                />
                {p.label}
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void save()}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs text-white disabled:opacity-50">
          {saving ? '저장 중…' : '저장'}
        </button>
        <button type="button" onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600">취소</button>
      </div>
    </div>
  )
}
