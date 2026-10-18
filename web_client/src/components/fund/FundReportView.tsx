import type { CSSProperties, ReactNode } from 'react'
import type {
  Account,
  AccountsSection,
  CertSection,
  FundReport,
  Link as FundLink,
  Notice,
  Section,
  Seg,
  StepsSection,
} from '../../lib/fundCore'

// 펀드 리포트(웹) — fund_report/template.html 의 화면을 React+Tailwind 로 옮긴 것.
// 값은 원본 문자열 그대로(React 이스케이프), 링크는 http(s)만 새 탭으로 연다.
const TONES = ['#7c5cff', '#ff7a45', '#00a5a5', '#4e5968', '#e0a800']
const HERO_KEYS = ['현재평가금', '수익측정가치'] // 계좌 카드에서 크게 보여줄 값(먼저 찾은 것)
const DELTA_KEYS = ['총 손익금', '누적수익율', '연환산수익율'] // 큰 값 아래 요약(앞에서 2개)
const PILL_KEYS = ['초기화/시작일'] // 카드 머리 배지로 옮길 값
const PROGRESS: [string, string] = ['누적송금액', '남은목표금액'] // 둘 다 있으면 진행률 막대

const isMoney = (v: string) => /^-?[\d,]+$/.test(v)
const toNum = (v: string) => Number(v.replace(/[^\d.-]/g, ''))
const won = (v: string) => (isMoney(v) ? `${v}원` : v)
const toneClass = (k: string, v: string) => (toNum(v) < 0 ? 'text-down' : k.includes('손익금') ? 'text-up' : 'text-ink')
const safeHref = (href: string) => (/^https?:\/\//i.test(href) ? href : null)

function Pill({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded-full bg-fill px-2.5 py-0.5 text-xs text-ink-muted">{children}</span>
}

function Links({ links }: { links: FundLink[] }) {
  const items = links.flatMap(([label, href]) => {
    const safe = safeHref(href)
    return safe ? [{ label, href: safe }] : []
  })
  if (!items.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((l, i) => (
        <a
          key={i}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-field bg-brand-soft px-3.5 py-2 text-sm font-semibold text-brand hover:brightness-95"
        >
          {l.label} →
        </a>
      ))}
    </div>
  )
}

const rich = (segs: Seg[]) =>
  segs.map(([t, b], i) =>
    b ? (
      <b key={i} className="text-ink">
        {t}
      </b>
    ) : (
      <span key={i}>{t}</span>
    ),
  )

function NoticeCard({ n }: { n: Notice }) {
  return (
    <div className="rounded-card bg-surface p-5 ring-1 ring-up-soft md:p-6">
      <span className="inline-block rounded-full bg-up-soft px-2.5 py-0.5 text-xs font-bold text-up">{n.label}</span>
      {n.signals.length > 0 && (
        <div className="mb-2.5 mt-3.5 flex flex-wrap gap-2 text-sm text-ink-muted">
          <span className="rounded-field bg-fill px-3 py-1.5">{n.signalsLabel}</span>
          {n.signals.map(([k, v], i) => (
            <span key={i} className="rounded-field bg-fill px-3 py-1.5">
              {k} <b className="text-up">{v}</b>
            </span>
          ))}
        </div>
      )}
      {n.message && <p className="font-semibold text-ink">{n.message}</p>}
      {n.services.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm text-ink-muted">
          <span className="mr-1 font-bold text-ink">{n.servicesLabel}</span>
          {n.services.map((t, i) => (
            <span key={i} className="rounded-full bg-fill px-2.5 py-1">
              {t}
            </span>
          ))}
        </div>
      )}
      <Links links={n.links} />
    </div>
  )
}

function AccountCard({ a }: { a: Account }) {
  const map = new Map(a.values)
  const heroKey = HERO_KEYS.find((k) => map.has(k))
  const heroValue = heroKey ? (map.get(heroKey) ?? '') : ''
  const delta = DELTA_KEYS.filter((k) => map.has(k))
    .slice(0, 2)
    .map((k) => `${k} ${won(map.get(k) ?? '')}`)
    .join(' · ')
  const pills: [string, string][] = [
    ...PILL_KEYS.filter((k) => map.has(k)).map((k): [string, string] => [k, map.get(k) ?? '']),
    ...a.remarks,
  ]
  const metrics = a.values.filter(([k]) => k !== heroKey && !PILL_KEYS.includes(k))
  const [doneKey, leftKey] = PROGRESS
  const done = toNum(map.get(doneKey) ?? '')
  const left = toNum(map.get(leftKey) ?? '')
  const pct = map.has(doneKey) && map.has(leftKey) && done + left > 0 ? (done / (done + left)) * 100 : null

  return (
    <article className="rounded-card bg-surface p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-bold text-ink">{a.name}</span>
        <span className="flex flex-wrap gap-1.5">
          {pills.map(([k, v], i) => (
            <Pill key={i}>
              {k} <b className="tabular-nums text-ink">{v}</b>
            </Pill>
          ))}
        </span>
      </div>
      {heroKey && (
        <div className="mb-4 mt-3.5">
          <div className="text-sm text-ink-muted">{heroKey}</div>
          <div className="text-[clamp(26px,6vw,34px)] font-extrabold leading-tight tracking-tight tabular-nums text-ink">
            {heroValue}
            {isMoney(heroValue) && <small className="ml-0.5 text-[0.5em] font-semibold text-ink-muted">원</small>}
          </div>
          {delta && <div className="mt-1 text-sm font-semibold tabular-nums text-up">{delta}</div>}
        </div>
      )}
      {pct !== null && (
        <div className="mb-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-fill">
            <div className="h-full rounded-full bg-[var(--tone)]" style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-xs text-ink-muted">
            <span>
              {doneKey} {won(map.get(doneKey) ?? '')}
            </span>
            <span>
              {leftKey} {won(map.get(leftKey) ?? '')}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            ※ 진행률 {pct.toFixed(1)}%는 {doneKey} ÷ ({doneKey} + {leftKey})으로 화면에서 계산한 값입니다.
          </p>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] overflow-hidden rounded-2xl bg-fill">
        {metrics.map(([k, v], i) => (
          <div key={i} className="min-w-0 px-3.5 py-3 shadow-[0_0_0_0.5px_#ebe7f7]">
            <div className="text-xs text-ink-muted">{k}</div>
            <div className={`mt-0.5 text-right text-[15px] font-bold tabular-nums ${toneClass(k, v)}`}>{v}</div>
          </div>
        ))}
      </div>
      {a.remarkText && (
        <div className="mt-3.5 rounded-2xl bg-fill px-4 py-3.5 text-sm text-ink-muted">
          {a.remarkText.title && <strong className="mb-1.5 block text-ink">{a.remarkText.title}</strong>}
          <ol className="list-decimal pl-[18px]">
            {a.remarkText.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}

function AccountsBlock({ s }: { s: AccountsSection }) {
  return (
    <>
      <div className={`grid gap-4 ${s.accounts.length > 1 ? 'min-[900px]:grid-cols-2' : ''}`}>
        {s.accounts.map((a, i) => (
          <AccountCard key={i} a={a} />
        ))}
      </div>
      {s.notes.map((n, i) => (
        <div key={i} className="mt-4">
          <h3 className="mb-2.5 ml-1 text-sm font-semibold text-ink-muted">{n.title}</h3>
          <ul className="grid gap-2">
            {n.items.map((segs, j) => (
              <li key={j} className="rounded-field bg-surface px-3.5 py-3 text-sm text-ink-muted">
                {rich(segs)}
              </li>
            ))}
          </ul>
          <Links links={n.links} />
        </div>
      ))}
    </>
  )
}

function StepsBlock({ s }: { s: StepsSection }) {
  return (
    <div className="rounded-card bg-surface p-5 md:p-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        {s.steps.map((st, i) => (
          <div key={i} className="rounded-2xl bg-fill p-4">
            <span className="inline-block rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-[var(--tone)]">
              {st.no}
            </span>
            <h4 className="mb-3 mt-2 text-[15px] font-semibold text-ink">{st.name}</h4>
            <dl className="grid gap-2">
              {st.items.map(([k, v, hl], j) => (
                <div key={j} className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-ink-muted">{k}</dt>
                  <dd className={`text-right font-bold tabular-nums ${hl ? 'text-lg text-up' : 'text-ink'}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <Links links={s.links} />
    </div>
  )
}

function CertBlock({ s }: { s: CertSection }) {
  return (
    <div className="grid gap-4 rounded-card bg-surface p-5 md:grid-cols-[1.3fr_1fr] md:p-6">
      <div>
        <Pill>{s.companyLabel}</Pill>
        {s.company.map((l, i) => (
          <p key={i} className={i === 0 ? 'mt-1.5 text-base font-bold text-ink' : 'mt-1.5 text-sm text-ink-muted'}>
            {l}
          </p>
        ))}
      </div>
      <dl className="grid gap-2.5">
        {s.fields.map(([k, v], i) => (
          <div key={i} className="flex justify-between gap-3 border-b border-dashed border-line pb-2.5 last:border-0 last:pb-0">
            <dt className="text-sm text-ink-muted">{k}</dt>
            <dd
              className={`whitespace-pre-line text-right font-bold tabular-nums ${/^₩/.test(v) ? 'text-xl text-brand' : 'text-ink'}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SectionBody({ s }: { s: Section }) {
  switch (s.kind) {
    case 'accounts':
      return <AccountsBlock s={s} />
    case 'steps':
      return <StepsBlock s={s} />
    case 'cert':
      return <CertBlock s={s} />
  }
}

export default function FundReportView({ report }: { report: FundReport }) {
  return (
    <div>
      {report.notice && <NoticeCard n={report.notice} />}
      {report.sections.map((s, i) => (
        <section key={i} className="mt-7" style={{ '--tone': TONES[i % TONES.length] } as CSSProperties}>
          <div className="mx-1 mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <span className="h-[18px] w-1 flex-none rounded-sm bg-[var(--tone)]" />
              {s.title}
              {s.kind === 'accounts' && s.group && <Pill>{s.group}</Pill>}
            </h2>
            {s.kind === 'accounts' && s.evalDate && (
              <span className="text-sm text-ink-muted">최종평가일 {s.evalDate}</span>
            )}
          </div>
          <SectionBody s={s} />
        </section>
      ))}
    </div>
  )
}
