import { useState, type ReactNode } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { chipClass } from '../ui/Chip'
import EduCrowdBar from './EduCrowdBar'
import { formatPct, formatPrice, formatSignedKrw, formatWon, pnlClass } from '../../lib/format'
import {
  actionSummary, eduPanelMode, keepLevelsPreview, ratioLabel, remainingText, settlementLabel, sideLabel, stopTakePreview,
} from '../../lib/eduGame'
import type {
  EduActionRequest, EduLeverage, EduOptions, EduPosition, EduRatio, EduState, EduStopLossPct, EduTakeProfitPct,
} from '../../types/eduGame'

// 하루 1회 의사결정 패널(명세 5.3) — 비로그인(로그인 안내) / 오늘 제출 완료(요약·남은 시간·참여자 비율) /
// 보유 중(유지·50% 청산·전량 청산) / 미보유(상승·하락 진입·관망). 행동을 고른 뒤 제출 버튼을 한 번 더 눌러야 보낸다.

interface Props {
  state: EduState
  submitting: boolean
  error: string | null
  now: Date
  onSubmit: (req: EduActionRequest) => void
  onLogin: () => void
  onOpenAcademy: () => void
}

type FlatChoice = 'ENTER_LONG' | 'ENTER_SHORT' | 'HOLD_WATCH'
type HoldChoice = 'KEEP_POS' | 'PARTIAL_CLOSE' | 'FULL_CLOSE'

const DEFAULT_OPTIONS: EduOptions = {
  ratios: [0.25, 0.5, 1], leverages: [1, 2, 5], stop_loss_pcts: [3, 5, 7], take_profit_pcts: [5, 10, 15],
  leverage_5x_unlocked: false, hold_watch_bonus: 0,
}

/** 목록에 있으면 그 값, 아니면 가운데 값 */
const pick = <T extends number>(list: readonly number[], want: T): T =>
  (list.includes(want) ? want : (list[Math.floor(list.length / 2)] ?? want)) as T

function ChipGroup<T extends number | null>({
  label, items, value, onChange, render, disabled,
}: {
  label: string
  items: readonly T[]
  value: T
  onChange: (v: T) => void
  render: (v: T) => ReactNode
  disabled?: (v: T) => boolean
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <button
            key={String(it)}
            type="button"
            role="radio"
            aria-checked={value === it}
            onClick={() => onChange(it)}
            className={`${chipClass(value === it)} ${disabled?.(it) ? 'opacity-60' : ''}`}
          >
            {render(it)}
          </button>
        ))}
      </div>
    </div>
  )
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-12 flex-1 items-center justify-center rounded-btn px-2 text-sm font-bold transition ${
        active ? 'bg-brand-soft text-brand-strong ring-2 ring-brand' : 'bg-fill text-ink hover:brightness-95'
      }`}
    >
      {children}
    </button>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right font-semibold text-ink">{children}</span>
    </div>
  )
}

function PositionSummary({ position }: { position: EduPosition }) {
  return (
    <div className="space-y-1 rounded-card bg-fill p-3">
      <Row label="방향">
        <span className={position.side === 'LONG' ? 'text-up' : 'text-down'}>{sideLabel(position.side)}</span>
        {position.leverage > 1 && ` · ${position.leverage}배`}
      </Row>
      <Row label="진입가">{formatPrice(position.entry_price)}원</Row>
      <Row label="투입 금액">{formatWon(position.size_amount)}</Row>
      <Row label="손절 / 익절">
        {position.stop_loss_price === null ? '-' : formatPrice(position.stop_loss_price)} /{' '}
        {position.take_profit_price === null ? '-' : formatPrice(position.take_profit_price)}
      </Row>
      <Row label="평가손익">
        <span className={pnlClass(position.unrealized_pnl)}>
          {formatSignedKrw(position.unrealized_pnl)} ({formatPct(position.roi_pct)})
        </span>
      </Row>
    </div>
  )
}

export default function EduDailyActionPanel({ state, submitting, error, now, onSubmit, onLogin, onOpenAcademy }: Props) {
  const mode = eduPanelMode(state)
  const opts = state.options ?? DEFAULT_OPTIONS
  const close = state.today?.close ?? null
  const dayIndex = state.season?.current_day_index
  const cash = state.account?.cash_balance ?? state.season?.initial_cash ?? 0
  const position = state.account?.position ?? null

  const [flat, setFlat] = useState<FlatChoice | null>(null)
  const [hold, setHold] = useState<HoldChoice | null>(null)
  const [ratio, setRatio] = useState<EduRatio>(() => pick(opts.ratios, 0.5))
  const [leverage, setLeverage] = useState<EduLeverage>(1)
  const [sl, setSl] = useState<EduStopLossPct>(() => pick(opts.stop_loss_pcts, 5))
  const [tp, setTp] = useState<EduTakeProfitPct>(() => pick(opts.take_profit_pcts, 10))
  const [keepSl, setKeepSl] = useState<EduStopLossPct | null>(null)
  const [keepTp, setKeepTp] = useState<EduTakeProfitPct | null>(null)

  const remain = remainingText(state.next_settlement_at, now)
  const settleAt = settlementLabel(state.next_settlement_at)
  const base = { day_index: dayIndex }

  if (mode === 'login') {
    return (
      <Card>
        <h2 className="text-base font-bold text-ink">로그인하고 오늘의 결정을 내려 보세요</h2>
        <p className="mt-1 text-sm text-ink-muted">
          가상 자금 {formatWon(state.season?.initial_cash ?? 10_000_000)}으로 하루 한 번, 오늘 종가에 상승·하락 진입이나 관망을 고르고 다음 종가 캔들에서 정산돼요.
          실제 돈은 들지 않아요.
        </p>
        <Button full className="mt-3" onClick={onLogin}>로그인</Button>
      </Card>
    )
  }

  if (mode === 'submitted') {
    return (
      <Card>
        <h2 className="text-base font-bold text-ink">✅ 오늘의 트레이딩 결정을 완료했어요!</h2>
        {state.today_action && <p className="mt-2 rounded-card bg-fill p-3 text-sm font-semibold text-ink">{actionSummary(state.today_action)}</p>}
        {position && <div className="mt-3"><PositionSummary position={position} /></div>}
        <p className="mt-3 text-sm text-ink">
          다음 종가 캔들 생성·손익 정산까지 <b>{remain ?? '-'}</b>
          {settleAt && <span className="text-ink-muted"> ({settleAt})</span>}
        </p>
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-ink-muted">다른 참가자들의 오늘 선택</p>
          <EduCrowdBar crowd={state.crowd} />
        </div>
      </Card>
    )
  }

  const submitBtn = (label: string, req: EduActionRequest, disabled = false) => (
    <Button full className="mt-3" loading={submitting} loadingText="제출 중…" disabled={disabled} onClick={() => onSubmit(req)}>
      {label}
    </Button>
  )

  const errorLine = error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>
  const footer = remain && (
    <p className="mt-3 text-xs text-ink-muted">
      오늘 종가로 체결돼요 · 정산까지 {remain}{settleAt && ` (${settleAt})`}
    </p>
  )

  if (mode === 'holding' && position) {
    const keep = close === null ? null : keepLevelsPreview(
      position.side, position.entry_price, { stop: position.stop_loss_price, take: position.take_profit_price }, close, keepSl, keepTp,
    )
    return (
      <Card>
        <h2 className="text-base font-bold text-ink">오늘의 결정 (1일 1회)</h2>
        <div className="mt-2"><PositionSummary position={position} /></div>
        <div className="mt-3 flex gap-1.5">
          <ChoiceButton active={hold === 'KEEP_POS'} onClick={() => setHold('KEEP_POS')}>🔒 유지</ChoiceButton>
          <ChoiceButton active={hold === 'PARTIAL_CLOSE'} onClick={() => setHold('PARTIAL_CLOSE')}>💰 50% 청산</ChoiceButton>
          <ChoiceButton active={hold === 'FULL_CLOSE'} onClick={() => setHold('FULL_CLOSE')}>🚪 전량 청산</ChoiceButton>
        </div>
        {hold === 'KEEP_POS' && (
          <div className="mt-3 space-y-3">
            <ChipGroup<EduStopLossPct | null>
              label="손절 다시 정하기(진입가 기준)"
              items={[null, ...(opts.stop_loss_pcts as EduStopLossPct[])]}
              value={keepSl}
              onChange={setKeepSl}
              render={(v) => (v === null ? '그대로' : `-${v}%`)}
            />
            <ChipGroup<EduTakeProfitPct | null>
              label="익절 다시 정하기(진입가 기준)"
              items={[null, ...(opts.take_profit_pcts as EduTakeProfitPct[])]}
              value={keepTp}
              onChange={setKeepTp}
              render={(v) => (v === null ? '그대로' : `+${v}%`)}
            />
            {keep && (keepSl !== null || keepTp !== null) && (
              <p className={`text-sm ${keep.valid ? 'text-ink' : 'text-danger'}`}>
                예상 손절 {keep.stop === null ? '-' : formatPrice(keep.stop)} · 익절 {keep.take === null ? '-' : formatPrice(keep.take)}
                {!keep.valid && ' — 오늘 종가로 바로 체결되는 값이라 고를 수 없어요'}
              </p>
            )}
            {submitBtn('포지션 유지하기', {
              ...base, action: 'KEEP_POS',
              ...(keepSl !== null && { stop_loss_pct: keepSl }), ...(keepTp !== null && { take_profit_pct: keepTp }),
            }, keep !== null && !keep.valid)}
          </div>
        )}
        {hold === 'PARTIAL_CLOSE' && (
          <>
            <p className="mt-3 text-sm text-ink">오늘 종가{close !== null && `(${formatPrice(close)}원)`}로 절반을 확정하고 나머지 50%는 계속 보유해요.</p>
            {submitBtn('50% 부분 청산하기', { ...base, action: 'PARTIAL_CLOSE' })}
          </>
        )}
        {hold === 'FULL_CLOSE' && (
          <>
            <p className="mt-3 text-sm text-ink">오늘 종가{close !== null && `(${formatPrice(close)}원)`}로 포지션을 모두 정리해요.</p>
            {submitBtn('전량 청산하기', { ...base, action: 'FULL_CLOSE' })}
          </>
        )}
        {errorLine}
        {footer}
      </Card>
    )
  }

  // 미보유
  const enterSide = flat === 'ENTER_LONG' ? 'LONG' : flat === 'ENTER_SHORT' ? 'SHORT' : null
  const preview = enterSide && close !== null ? stopTakePreview(enterSide, close, sl, tp) : null
  const locked5x = leverage === 5 && !opts.leverage_5x_unlocked
  return (
    <Card>
      <h2 className="text-base font-bold text-ink">오늘의 결정 (1일 1회)</h2>
      <p className="mt-0.5 text-sm text-ink-muted">사용 가능 현금 {formatWon(cash)}</p>
      <div className="mt-3 flex gap-1.5">
        <ChoiceButton active={flat === 'ENTER_LONG'} onClick={() => setFlat('ENTER_LONG')}>📈 상승 진입</ChoiceButton>
        <ChoiceButton active={flat === 'ENTER_SHORT'} onClick={() => setFlat('ENTER_SHORT')}>📉 하락 진입</ChoiceButton>
        <ChoiceButton active={flat === 'HOLD_WATCH'} onClick={() => setFlat('HOLD_WATCH')}>👀 오늘 관망</ChoiceButton>
      </div>
      {enterSide && (
        <div className="mt-3 space-y-3">
          <ChipGroup<EduRatio> label="비중" items={opts.ratios as EduRatio[]} value={ratio} onChange={setRatio} render={ratioLabel} />
          <ChipGroup<EduLeverage>
            label="배율"
            items={opts.leverages as EduLeverage[]}
            value={leverage}
            onChange={(v) => (v === 5 && !opts.leverage_5x_unlocked ? onOpenAcademy() : setLeverage(v))}
            render={(v) => (v === 5 && !opts.leverage_5x_unlocked ? `🔒 ${v}x` : `${v}x`)}
            disabled={(v) => v === 5 && !opts.leverage_5x_unlocked}
          />
          {!opts.leverage_5x_unlocked && opts.leverages.includes(5) && (
            <p className="text-xs text-ink-muted">5배는 아카데미 리스크 관리 퀴즈를 통과하면 열려요.</p>
          )}
          <ChipGroup<EduStopLossPct> label="손절" items={opts.stop_loss_pcts as EduStopLossPct[]} value={sl} onChange={setSl} render={(v) => `-${v}%`} />
          <ChipGroup<EduTakeProfitPct> label="익절" items={opts.take_profit_pcts as EduTakeProfitPct[]} value={tp} onChange={setTp} render={(v) => `+${v}%`} />
          <div className="space-y-1 rounded-card bg-fill p-3">
            <Row label="진입 예정가(오늘 종가)">{close === null ? '-' : `${formatPrice(close)}원`}</Row>
            <Row label="투입 금액">{formatWon(Math.floor(cash * ratio))}</Row>
            {preview && <Row label="예상 손절 / 익절">{formatPrice(preview.stop)} / {formatPrice(preview.take)}</Row>}
          </div>
          {submitBtn('오늘의 결정 제출하기 (1일 1회)', {
            ...base, action: flat as 'ENTER_LONG' | 'ENTER_SHORT', ratio, leverage, stop_loss_pct: sl, take_profit_pct: tp,
          }, locked5x)}
        </div>
      )}
      {flat === 'HOLD_WATCH' && (
        <>
          <p className="mt-3 text-sm text-ink">
            위험해 보이는 구간에서 쉬어 가는 것도 중요한 투자 기술이에요. 관망도 오늘 참가로 인정돼 연속 출석이 이어져요
            {opts.hold_watch_bonus > 0 && ` (학습 보너스 +${formatWon(opts.hold_watch_bonus)})`}.
          </p>
          {submitBtn('오늘 하루 관망하기 (출석 인정)', { ...base, action: 'HOLD_WATCH' })}
        </>
      )}
      {errorLine}
      {footer}
    </Card>
  )
}
