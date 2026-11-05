import { useCallback, useEffect, useState } from 'react'
import { getAdConfigs, updateAdConfig } from '../api/adConfigs'
import type { AdConfigIn, AdConfigOut, AdProvider } from '../api/adConfigs'
import { apiErrorMessage } from '../lib/apiError'
import { formatDateTime } from '../lib/marketFormat'
import { showToast } from '../lib/toast'

// 광고 설정 — 웹·앱 전체 스위치와 슬롯별 켜기·종류·하우스 배너 문구(명세 docs/ad_monetization_spec_and_plan.md §3).
// 스위치는 누르면 바로 저장한다(긴급 끄기). 입력 중인 문구는 스위치에 섞지 않고 저장 버튼으로만 반영한다.

const GLOBALS: Record<string, { title: string; description: string }> = {
  GLOBAL_WEB: { title: '웹 전체 광고', description: '끄면 웹의 모든 슬롯 광고가 사라져요.' },
  GLOBAL_MOBILE: { title: '앱 전체 광고', description: '끄면 앱의 모든 슬롯 광고가 사라져요.' },
}

const SLOT_GROUPS: { title: string; slots: Record<string, { title: string; description: string; infeed?: boolean }> }[] = [
  {
    title: '웹',
    slots: {
      WEB_HOME_SIDEBAR: { title: '홈 오른쪽 사이드', description: '추천 글 목록 아래, 데스크톱에서만 보여요.' },
      WEB_POST_LIST_INFEED: { title: '커뮤니티 글 목록', description: '글 목록 사이에 끼워 넣어요.', infeed: true },
      WEB_POST_DETAIL_BOTTOM: { title: '글 상세 하단', description: '본문이 끝나고 댓글이 시작되기 전이에요.' },
      WEB_SCREENER_FOOTER: { title: '스크리너 목록 맨 아래', description: '시장·테마·업종 탭 목록 끝이에요. 차트 영역에는 나오지 않아요.' },
    },
  },
  {
    title: '앱',
    slots: {
      MOB_HOME_FEED_NATIVE: { title: '홈 추천 글', description: '추천 글 목록 사이에 카드로 보여요.' },
      MOB_COMMUNITY_INFEED: { title: '커뮤니티 글 목록', description: '글 목록 사이에 끼워 넣어요.', infeed: true },
      MOB_POST_DETAIL_BOTTOM: { title: '글 상세 하단', description: '본문 아래, 댓글 위예요.' },
    },
  },
]

const INFEED_MIN = 4
const INFEED_MAX = 50

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'

const toPayload = (c: AdConfigOut): AdConfigIn => ({
  enabled: c.enabled,
  provider: c.provider,
  infeed_interval: c.infeed_interval,
  house_title: c.house_title,
  house_description: c.house_description,
  house_target_path: c.house_target_path,
})

function Switch({ checked, labelledBy, disabled, onToggle }: {
  checked: boolean
  labelledBy: string
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  )
}

function StatusLabel({ on }: { on: boolean }) {
  return <span className={`ml-2 text-xs font-semibold ${on ? 'text-indigo-600' : 'text-slate-400'}`}>{on ? '켜짐' : '꺼짐'}</span>
}

function lastChanged(c: AdConfigOut): string {
  if (!c.updated_at) return '변경 이력 없음'
  return `${formatDateTime(c.updated_at)}${c.updated_by ? ` · ${c.updated_by}` : ''}`
}

function SlotCard({ config, meta, busy, onSave, onToggle }: {
  config: AdConfigOut
  meta: { title: string; description: string; infeed?: boolean }
  busy: boolean
  onSave: (payload: AdConfigIn) => Promise<void>
  onToggle: () => void
}) {
  const [provider, setProvider] = useState<AdProvider>(config.provider)
  const [interval, setIntervalValue] = useState(String(config.infeed_interval))
  const [title, setTitle] = useState(config.house_title ?? '')
  const [description, setDescription] = useState(config.house_description ?? '')
  const [path, setPath] = useState(config.house_target_path ?? '')
  const labelId = `ad-slot-${config.slot_key}`

  const intervalNum = Number(interval)
  const intervalOk = Number.isInteger(intervalNum) && intervalNum >= INFEED_MIN && intervalNum <= INFEED_MAX
  const dirty =
    provider !== config.provider ||
    intervalNum !== config.infeed_interval ||
    title !== (config.house_title ?? '') ||
    description !== (config.house_description ?? '') ||
    path !== (config.house_target_path ?? '')

  const save = () =>
    onSave({
      enabled: config.enabled,
      provider,
      infeed_interval: intervalNum,
      house_title: title,
      house_description: description,
      house_target_path: path,
    })

  return (
    <li className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p id={labelId} className="font-medium text-slate-900">
            {meta.title}
            <StatusLabel on={config.enabled} />
          </p>
          <p className="mt-1 text-sm text-slate-500">{meta.description}</p>
        </div>
        <Switch checked={config.enabled} labelledBy={labelId} disabled={busy} onToggle={onToggle} />
      </div>

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <label className="block text-sm text-slate-700">
          <span className="mb-1 block font-medium">광고 종류</span>
          <select className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value as AdProvider)}>
            <option value="HOUSE">하우스 배너(자체 안내)</option>
            <option value="GOOGLE">Google 광고</option>
          </select>
        </label>
        {meta.infeed && (
          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">몇 번째 글마다</span>
            <input
              className={inputClass}
              type="number"
              min={INFEED_MIN}
              max={INFEED_MAX}
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
            />
            {!intervalOk && <span className="mt-1 block text-xs text-rose-600">{INFEED_MIN}~{INFEED_MAX} 사이로 입력하세요.</span>}
          </label>
        )}
        <label className="block text-sm text-slate-700 sm:col-span-2">
          <span className="mb-1 block font-medium">배너 제목</span>
          <input className={inputClass} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm text-slate-700 sm:col-span-2">
          <span className="mb-1 block font-medium">배너 설명</span>
          <input className={inputClass} maxLength={255} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block text-sm text-slate-700 sm:col-span-2">
          <span className="mb-1 block font-medium">눌렀을 때 이동할 경로</span>
          <input className={inputClass} maxLength={255} placeholder="/game" value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">마지막 변경: {lastChanged(config)}</p>
        <button
          type="button"
          disabled={busy || !dirty || !intervalOk}
          onClick={save}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </li>
  )
}

export default function AdSettingsPage() {
  const [items, setItems] = useState<AdConfigOut[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    getAdConfigs()
      .then(setItems)
      .catch((e: unknown) => {
        setLoadFailed(true)
        showToast(apiErrorMessage(e), { icon: '⚠️' })
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (slotKey: string, payload: AdConfigIn, message: string) => {
    setPending(slotKey)
    try {
      const saved = await updateAdConfig(slotKey, payload)
      setItems((prev) => prev.map((c) => (c.slot_key === saved.slot_key ? saved : c)))
      showToast(message, { icon: '✅' })
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setPending(null)
    }
  }

  const toggle = (c: AdConfigOut, title: string) =>
    save(c.slot_key, { ...toPayload(c), enabled: !c.enabled }, `${title} ${c.enabled ? '끔' : '켬'}`)

  const byKey = new Map(items.map((c) => [c.slot_key, c]))

  return (
    <div>
      <h2 className="mb-2 text-2xl font-bold text-slate-900">광고 설정</h2>
      <p className="mb-3 text-sm text-slate-500">
        전체 스위치와 슬롯이 모두 켜져야 그 자리에 광고가 나옵니다. 배포 없이 바로 저장되고, 차트와 게임 화면에는 광고를 넣지 않습니다.
      </p>
      <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        아직 웹·앱 화면에 광고 자리가 연결되지 않아, 여기서 켜도 사용자에게는 아무것도 보이지 않습니다. Google 광고는 AdSense·AdMob 승인 후에 고르세요.
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
        <div className="space-y-8">
          <section>
            <h3 className="mb-3 text-lg font-semibold text-slate-900">전체 스위치</h3>
            <ul className="space-y-3">
              {Object.entries(GLOBALS).map(([key, meta]) => {
                const c = byKey.get(key)
                if (!c) return null
                const labelId = `ad-slot-${key}`
                return (
                  <li key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
                    <div>
                      <p id={labelId} className="font-medium text-slate-900">
                        {meta.title}
                        <StatusLabel on={c.enabled} />
                      </p>
                      <p className="mt-1 text-sm text-slate-500">{meta.description}</p>
                      <p className="mt-1 text-xs text-slate-400">마지막 변경: {lastChanged(c)}</p>
                    </div>
                    <Switch checked={c.enabled} labelledBy={labelId} disabled={pending !== null} onToggle={() => toggle(c, meta.title)} />
                  </li>
                )
              })}
            </ul>
          </section>
          {SLOT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-3 text-lg font-semibold text-slate-900">{group.title} 슬롯</h3>
              <ul className="space-y-3">
                {Object.entries(group.slots).map(([key, meta]) => {
                  const c = byKey.get(key)
                  if (!c) return null
                  return (
                    <SlotCard
                      key={key}
                      config={c}
                      meta={meta}
                      busy={pending !== null}
                      onToggle={() => toggle(c, meta.title)}
                      onSave={(payload) => save(key, payload, `${meta.title} 저장`)}
                    />
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
