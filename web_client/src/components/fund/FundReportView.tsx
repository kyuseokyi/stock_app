import { useMemo, type ReactNode } from 'react'
import {
  toReportView,
  type AccountView,
  type AccountsView,
  type CertView,
  type FundReport,
  type Link as FundLink,
  type NoticeView,
  type StepsView,
  type ViewCell,
  type ViewRow,
} from '../../lib/fundCore'

// 펀드 리포트(웹) — B안 정렬 그리드 카드(docs/superpowers/specs/fund-report-design/).
// 표시 포맷은 core 의 toReportView 가 끝냈다 — 여기선 그리기만. 링크는 http(s)만(core 에서 걸러짐) 새 탭으로.
const TONE: Record<ViewCell['tone'], string> = { up: 'text-up', down: 'text-down', zero: 'text-ink-muted', '': '' }

// 구분선은 칸이 아닌 줄(이름+값 한 줄)에 그린다 — 글자 크기가 달라도 좌우 선이 어긋나지 않는다.
// 값은 줄 오른쪽 끝에 붙어 카드 안 모든 값이 같은 오른쪽 기준선을 쓴다.
const ROW = 'flex items-baseline justify-between gap-4 border-t border-line py-[9px] first:border-t-0 first:pt-0'
const K = 'text-sm text-ink-muted'
const V = 'whitespace-pre text-right tabular-nums' // 굵기는 쓰는 곳에서(유틸 순서상 semibold 가 extrabold 를 덮음)
const CARD = 'mt-2.5 rounded-[18px] bg-surface p-[18px]'
const SUMMARY =
  "cursor-pointer list-none text-[13px] text-ink-muted before:content-['▸_'] group-open:before:content-['▾_'] [&::-webkit-details-marker]:hidden"

function Value({ c, className = '', title }: { c: ViewCell; className?: string; title?: string }) {
  return (
    <span className={`tabular-nums ${TONE[c.tone]} ${className}`} title={title ?? `원본: ${c.raw}`}>
      {c.text}
      {c.unit && <span className="ml-px text-[0.85em] font-medium text-ink-muted">{c.unit}</span>}
    </span>
  )
}

function Row({ r }: { r: ViewRow }) {
  return (
    <div className={ROW}>
      <div className={K}>{r.label}</div>
      <div className={`${V} font-semibold`}>
        <Value c={r.value} className={r.highlight ? 'text-up' : ''} />
      </div>
    </div>
  )
}

function Rows({ rows }: { rows: ViewRow[] }) {
  return (
    <div>
      {rows.map((r, i) => (
        <Row key={i} r={r} />
      ))}
    </div>
  )
}

function Links({ links }: { links: FundLink[] }) {
  return links.map(([label, href], i) => (
    <a
      key={i}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mr-3 mt-2.5 inline-block text-sm font-semibold text-brand hover:underline"
    >
      {label} →
    </a>
  ))
}

function Fold({ title, className = '', children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <details className={`group mt-2 text-[13px] text-ink-muted ${className}`}>
      <summary className={SUMMARY}>{title}</summary>
      {children}
    </details>
  )
}

function Notice({ n }: { n: NoticeView }) {
  return (
    <div className="mt-3 rounded-[14px] bg-up-soft px-3.5 py-2.5 text-sm text-ink">
      <b className="mr-1.5 text-up">{n.label}</b>
      {n.message}
      {n.signals && <span className="mt-0.5 block text-xs text-ink-muted">{n.signals}</span>}
      {n.links.length > 0 && (
        <div>
          <Links links={n.links} />
        </div>
      )}
    </div>
  )
}

function AccountCard({ a }: { a: AccountView }) {
  const hero = a.hero
  return (
    <div className={CARD}>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <b className="text-base text-ink">{a.name}</b>
        {a.since && <span className="whitespace-nowrap text-xs tabular-nums text-ink-muted">{a.since} 시작</span>}
      </div>
      <div>
        {hero && (
          // 대표값 + 요약 한 줄을 묶은 첫 줄(위 선 없음)
          <div className="pb-[9px]">
            <div className="flex items-baseline justify-between gap-4">
              <div className="text-[15px] font-bold text-ink">{hero.label}</div>
              <div className={`${V} text-2xl font-extrabold tracking-tight`}>
                <Value c={hero.value} />
              </div>
            </div>
            {a.summary.length > 0 && (
              <div className="mt-[9px] whitespace-nowrap text-right text-[13px] font-semibold tabular-nums">
                {a.summary.map((r, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    <Value c={r.value} title={`${r.label} · 원본: ${r.value.raw}`} />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {a.rows.map((r, i) => (
          <Row key={i} r={r} />
        ))}
      </div>
      {a.memo && (
        <Fold title={a.memo.title || '메모'}>
          <ol className="mt-1.5 list-decimal pl-[18px]">
            {a.memo.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </Fold>
      )}
      {a.details.length > 0 && (
        <Fold title="상세">
          <div className="mt-2">
            <Rows rows={a.details} />
          </div>
        </Fold>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mx-1 mb-2 mt-[26px] text-sm font-bold text-ink-muted">{children}</h2>
}

function AccountsBlock({ s }: { s: AccountsView }) {
  return (
    <>
      <SectionTitle>
        {s.title}
        {s.group && ` · ${s.group}`}
        {s.evalDate && <span className="font-medium tabular-nums"> · {s.evalDate}</span>}
      </SectionTitle>
      {s.accounts.map((a, i) => (
        <AccountCard key={i} a={a} />
      ))}
      {s.notes.map((n, i) => (
        <Fold key={i} title={`${n.title} (${n.items.length})`} className={CARD}>
          {n.items.map((t, j) => (
            <p key={j} className="mt-2">
              {t}
            </p>
          ))}
          <Links links={n.links} />
        </Fold>
      ))}
    </>
  )
}

function StepsBlock({ s }: { s: StepsView }) {
  return (
    <>
      <SectionTitle>{s.title}</SectionTitle>
      <div className={CARD}>
        <div>
          {s.steps.map((st, i) => (
            <div key={i}>
              <div
                className={`text-sm font-bold text-brand ${i === 0 ? 'pb-[9px]' : 'border-t border-line pb-[9px] pt-3.5'}`}
              >
                {st.no} · {st.name}
              </div>
              {st.rows.map((r, j) => (
                <Row key={j} r={r} />
              ))}
            </div>
          ))}
        </div>
        <Links links={s.links} />
      </div>
    </>
  )
}

function CertBlock({ s }: { s: CertView }) {
  return (
    <Fold title={s.title} className={CARD}>
      {s.company && <p className="mt-2 text-ink">{s.company}</p>}
      <div className="mt-2">
        <Rows rows={s.rows} />
      </div>
    </Fold>
  )
}

export default function FundReportView({ report }: { report: FundReport }) {
  const view = useMemo(() => toReportView(report), [report])
  return (
    <div className="text-[15px] leading-normal tracking-[-0.01em] [word-break:keep-all]">
      {view.notice && <Notice n={view.notice} />}
      {view.sections.map((s, i) => (
        <section key={i}>
          {s.kind === 'accounts' ? (
            <AccountsBlock s={s} />
          ) : s.kind === 'steps' ? (
            <StepsBlock s={s} />
          ) : (
            <CertBlock s={s} />
          )}
        </section>
      ))}
    </div>
  )
}
