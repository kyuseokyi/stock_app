import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getAppVersions, updateAppVersion } from '../api/appVersions'
import type { AppPlatform, AppVersionIn, AppVersionOut, OtaPolicy } from '../api/appVersions'
import { apiErrorMessage } from '../lib/apiError'
import { compareSemver, isValidSemver } from '../lib/semver'
import { showToast } from '../lib/toast'

// 앱 버전 & 업데이트 — 플랫폼별 점검 모드·스토어 강제/권장·OTA 정책(명세 docs/app_update_management_spec.md §4)

const PLATFORMS: { key: AppPlatform; label: string }[] = [
  { key: 'android', label: '🤖 Android' },
  { key: 'ios', label: '🍎 iOS' },
]

const OTA_OPTIONS: { value: OtaPolicy; label: string; desc: string }[] = [
  {
    value: 'SILENT',
    label: '🟢 무음 적용 (SILENT)',
    desc: '백그라운드로 내려받고 다음 앱 실행 때 자동 적용해요. 알림이 없어요.',
  },
  {
    value: 'OPTIONAL',
    label: '🟡 권장 재시작 (OPTIONAL, 거부 가능)',
    desc: '다운로드 후 안내 창을 띄워요. [나중에 하기] / [지금 재시작] 중 고를 수 있어요.',
  },
  {
    value: 'MANDATORY',
    label: '🔴 강제 즉시 재시작 (MANDATORY, 거부 불가)',
    desc: '다운로드 후 닫을 수 없는 창으로 즉시 재시작을 요구해요. 긴급 패치에만 쓰세요.',
  },
]

// 폼은 문자열 위주(빈 문자열 허용) — 저장할 때 null 로 정리한다
interface FormState {
  latest_version: string
  min_supported_version: string
  force_update_enabled: boolean
  store_url: string
  store_title: string
  store_message: string
  ota_policy: OtaPolicy
  ota_title: string
  ota_message: string
  is_maintenance: boolean
  maintenance_message: string
}

const toForm = (v: AppVersionOut): FormState => ({
  latest_version: v.latest_version,
  min_supported_version: v.min_supported_version,
  force_update_enabled: v.force_update_enabled,
  store_url: v.store_url,
  store_title: v.store_title,
  store_message: v.store_message,
  ota_policy: v.ota_policy,
  ota_title: v.ota_title ?? '',
  ota_message: v.ota_message ?? '',
  is_maintenance: v.is_maintenance,
  maintenance_message: v.maintenance_message ?? '',
})

const toPayload = (f: FormState): AppVersionIn => ({
  latest_version: f.latest_version.trim(),
  min_supported_version: f.min_supported_version.trim(),
  force_update_enabled: f.force_update_enabled,
  store_url: f.store_url.trim(),
  store_title: f.store_title.trim(),
  store_message: f.store_message.trim(),
  ota_policy: f.ota_policy,
  ota_title: f.ota_title.trim() || null,
  ota_message: f.ota_message.trim() || null,
  is_maintenance: f.is_maintenance,
  maintenance_message: f.maintenance_message.trim() || null,
})

/** 서버와 같은 규칙으로 검증 — 문제가 있으면 첫 메시지 */
function validate(f: FormState): string | null {
  const latest = f.latest_version.trim()
  const min = f.min_supported_version.trim()
  if (!isValidSemver(latest)) return '최신 버전은 1.2.3 형식(숫자.숫자.숫자)이어야 합니다.'
  if (!isValidSemver(min)) return '최소 지원 버전은 1.2.3 형식(숫자.숫자.숫자)이어야 합니다.'
  if (compareSemver(min, latest) === 1) return '최소 지원 버전은 최신 버전보다 높을 수 없습니다.'
  const url = f.store_url.trim()
  if (!url) return '스토어 URL을 입력하세요.'
  if (!/^https?:\/\//i.test(url)) return '스토어 URL 은 http:// 또는 https:// 로 시작해야 합니다.'
  if (url.length > 255) return '스토어 URL은 255자 이하여야 합니다.'
  if (!f.store_title.trim()) return '스토어 안내 제목을 입력하세요.'
  if (f.store_title.trim().length > 100) return '스토어 안내 제목은 100자 이하여야 합니다.'
  if (!f.store_message.trim()) return '스토어 안내 문구를 입력하세요.'
  if (f.ota_title.trim().length > 100) return 'OTA 안내 제목은 100자 이하여야 합니다.'
  return null
}

function dangerList(f: FormState): string[] {
  const list: string[] = []
  if (f.is_maintenance) list.push('· 서버 점검 모드 켬 — 앱 진입 시 점검 안내가 떠요')
  if (f.force_update_enabled) list.push('· 스토어 강제 업데이트 켬 — 모든 사용자가 스토어로 이동해야 해요')
  if (f.ota_policy === 'MANDATORY') list.push('· OTA 강제 즉시 재시작 — 새 번들을 받은 사용자는 거부할 수 없어요')
  return list
}

const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-')

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? 'bg-red-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export default function AppVersionsPage() {
  const [platform, setPlatform] = useState<AppPlatform>('android')
  // 플랫폼별 폼을 따로 둔다 — 탭을 바꿔도 입력 중인 값이 사라지지 않게
  const [forms, setForms] = useState<Partial<Record<AppPlatform, FormState>>>({})
  const [saved, setSaved] = useState<Partial<Record<AppPlatform, AppVersionOut>>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getAppVersions()
      .then((list) => {
        const f: Partial<Record<AppPlatform, FormState>> = {}
        const s: Partial<Record<AppPlatform, AppVersionOut>> = {}
        for (const v of list) {
          f[v.platform] = toForm(v)
          s[v.platform] = v
        }
        setForms(f)
        setSaved(s)
      })
      .catch((e) => showToast(apiErrorMessage(e), { icon: '⚠️' }))
      .finally(() => setLoading(false))
  }, [])

  const form = forms[platform]
  const meta = saved[platform]

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForms((prev) => {
      const cur = prev[platform]
      return cur ? { ...prev, [platform]: { ...cur, [key]: value } } : prev
    })

  async function save(): Promise<void> {
    if (!form) return
    const error = validate(form)
    if (error) {
      showToast(error, { icon: '⚠️' })
      return
    }
    const danger = dangerList(form)
    const name = platform === 'android' ? 'Android' : 'iOS'
    if (danger.length && !confirm(`${name} 에 아래 설정을 적용할까요?\n\n${danger.join('\n')}`)) return
    setBusy(true)
    try {
      const out = await updateAppVersion(platform, toPayload(form))
      setForms((prev) => ({ ...prev, [platform]: toForm(out) }))
      setSaved((prev) => ({ ...prev, [platform]: out }))
      showToast(`${name} 설정을 저장했어요.`, { icon: '✅' })
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setBusy(false)
    }
  }

  const latestOk = !form || isValidSemver(form.latest_version.trim())
  const minOk = !form || isValidSemver(form.min_supported_version.trim())
  const orderOk = !form || !latestOk || !minOk || compareSemver(form.min_supported_version.trim(), form.latest_version.trim()) !== 1

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">앱 버전 & 업데이트</h2>

      <div className="mb-4 flex gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            aria-pressed={platform === p.key}
            onClick={() => setPlatform(p.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              platform === p.key ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : !form ? (
        <p className="text-sm text-slate-500">설정을 불러오지 못했어요. 새로고침해 주세요.</p>
      ) : (
        <div className="space-y-6">
          {meta && (
            <p className="text-xs text-slate-400">
              마지막 수정: {fmt(meta.updated_at)} · {meta.updated_by ?? '-'}
            </p>
          )}

          {/* 긴급 조치 */}
          <section className="rounded-xl border border-red-200 bg-red-50/60 p-6">
            <h3 className="mb-4 text-base font-semibold text-red-700">긴급 조치</h3>
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">서버 점검 모드</p>
                  <p className="text-xs text-slate-500">켜면 앱 진입 시 &quot;점검 중&quot; 안내가 떠요.</p>
                </div>
                <Switch checked={form.is_maintenance} onChange={(v) => set('is_maintenance', v)} label="서버 점검 모드" />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">스토어 강제 업데이트</p>
                  <p className="text-xs text-slate-500">버전 비교와 관계없이 모든 사용자에게 스토어 이동을 강제해요.</p>
                </div>
                <Switch
                  checked={form.force_update_enabled}
                  onChange={(v) => set('force_update_enabled', v)}
                  label="스토어 강제 업데이트"
                />
              </div>
              <Field label="점검 안내 문구" hint="점검 모드일 때 앱에 보여줄 문구(시간·사유)">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={form.maintenance_message}
                  onChange={(e) => set('maintenance_message', e.target.value)}
                  placeholder="예: 10월 23일 02:00~04:00 서버 점검 중입니다."
                />
              </Field>
            </div>
          </section>

          <Card title="스토어 버전 설정">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="최신 버전 (latest_version)" hint="이보다 낮으면 업데이트 권장">
                <input
                  className={`${inputClass} ${latestOk ? '' : 'border-red-400'}`}
                  value={form.latest_version}
                  onChange={(e) => set('latest_version', e.target.value)}
                  placeholder="1.0.1"
                />
              </Field>
              <Field label="최소 지원 버전 (min_supported_version)" hint="이보다 낮으면 업데이트 강제(차단)">
                <input
                  className={`${inputClass} ${minOk && orderOk ? '' : 'border-red-400'}`}
                  value={form.min_supported_version}
                  onChange={(e) => set('min_supported_version', e.target.value)}
                  placeholder="1.0.0"
                />
              </Field>
            </div>
            {(!latestOk || !minOk) && <p className="text-xs text-red-500">버전은 1.2.3 형식(숫자.숫자.숫자)으로 입력하세요.</p>}
            {!orderOk && <p className="text-xs text-red-500">최소 지원 버전은 최신 버전보다 높을 수 없어요.</p>}
            <Field label="스토어 URL (store_url)">
              <input className={inputClass} value={form.store_url} onChange={(e) => set('store_url', e.target.value)} />
            </Field>
            <Field label="업데이트 안내 제목 (store_title)">
              <input className={inputClass} value={form.store_title} onChange={(e) => set('store_title', e.target.value)} />
            </Field>
            <Field label="업데이트 안내 문구 (store_message)">
              <textarea
                rows={3}
                className={inputClass}
                value={form.store_message}
                onChange={(e) => set('store_message', e.target.value)}
              />
            </Field>
          </Card>

          <Card title="OTA (EAS Update) 정책">
            <div className="space-y-2" role="radiogroup" aria-label="OTA 정책">
              {OTA_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    form.ota_policy === o.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name={`ota-${platform}`}
                    className="mt-1"
                    checked={form.ota_policy === o.value}
                    onChange={() => set('ota_policy', o.value)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{o.label}</span>
                    <span className="block text-xs text-slate-500">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field label="OTA 안내 제목 (ota_title)">
              <input className={inputClass} value={form.ota_title} onChange={(e) => set('ota_title', e.target.value)} />
            </Field>
            <Field label="OTA 안내 문구 (ota_message)">
              <textarea
                rows={3}
                className={inputClass}
                value={form.ota_message}
                onChange={(e) => set('ota_message', e.target.value)}
              />
            </Field>
          </Card>

          <div className="flex justify-end">
            <button
              onClick={() => void save()}
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? '저장 중…' : '저장하기'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
