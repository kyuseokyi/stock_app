import type { ReactNode } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { formatKstShort, formatWon } from '../../lib/format'
import {
  entryRoiText, feeText, leverageExample, leverageUnlockList, liquidationMovesText, marginCallText,
  signedPct, streakMilestones, tradingWindowsText,
} from '../../lib/gameRules'
import type { GameRulesState } from '../../hooks/useGameRules'
import type { GameRules, Season } from '../../types/game'

interface GameRulesModalProps {
  rulesState: GameRulesState
  season: Pick<Season, 'period' | 'end_at'> | null
  onClose: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card bg-surface p-4">
      <h3 className="mb-2 text-base font-bold text-ink">{title}</h3>
      <div className="space-y-1.5 text-sm leading-relaxed text-ink">{children}</div>
    </section>
  )
}

/** 라벨 + 값 한 줄(토스식 정보 행) */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="text-right font-semibold tabular-nums">{children}</span>
    </div>
  )
}

const Note = ({ children }: { children: ReactNode }) => <p className="text-xs text-ink-muted">{children}</p>

const rankTiers = (amounts: number[]) => amounts.map((a, i) => `${i + 1}위 ${formatWon(a)}`).join(' · ')

function RulesBody({ rules, season }: { rules: GameRules; season: GameRulesModalProps['season'] }) {
  const fee = feeText(rules.fee_roundtrip_pct)
  const unlocks = leverageUnlockList(rules.leverage_unlock)
  const example = leverageExample(rules.leverages)
  const quarter = season?.period === 'quarter'
  const streaks = streakMilestones(rules.rewards.streak)

  return (
    <div className="space-y-3">
      <Section title="💰 시작과 주문">
        <Row label="시즌 시작 자본금">{formatWon(rules.initial_cash)}</Row>
        <Row label="최소 주문">{formatWon(rules.min_order_amount)}</Row>
        <Row label="동시 보유">{rules.max_open_positions}개</Row>
        {rules.trading_windows.length > 0 && <Row label="거래 시간(KST)">{tradingWindowsText(rules.trading_windows)}</Row>}
        <Note>비중은 자본금 중 이번 주문에 거는 비율이에요. 보유 중인 포지션을 청산해야 새로 주문할 수 있어요.</Note>
      </Section>

      <Section title="📈 상승·하락과 배율">
        <p>
          <span className="font-semibold text-up">상승</span>으로 주문하면 주가가 오를 때,{' '}
          <span className="font-semibold text-down">하락</span>으로 주문하면 주가가 내릴 때 수익이 나요.
        </p>
        <p className="rounded-field bg-fill px-3 py-2 text-center font-semibold">손익(%) = 주가 변동률 × 배율 − 수수료</p>
        <table className="w-full text-center tabular-nums">
          <thead>
            <tr className="text-xs text-ink-muted">
              <th className="py-1 font-medium">주가 +1%일 때</th>
              {example.map((e) => (
                <th key={e.leverage} className="py-1 font-medium">{e.leverage}배</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1 text-ink-muted">상승 주문</td>
              {example.map((e) => (
                <td key={e.leverage} className="py-1 font-semibold text-up">{signedPct(e.roiPct)}</td>
              ))}
            </tr>
            <tr>
              <td className="py-1 text-ink-muted">하락 주문</td>
              {example.map((e) => (
                <td key={e.leverage} className="py-1 font-semibold text-down">{signedPct(-e.roiPct)}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <Note>반대로 움직이면 같은 크기로 손실이 나요.</Note>
        {unlocks.map((u) => (
          <Note key={u.leverage}>🔒 {u.leverage}배는 {u.label} 쓸 수 있어요.</Note>
        ))}
      </Section>

      <Section title="🧾 수수료와 청산">
        <Row label="왕복 수수료">{fee}</Row>
        <p>
          수수료는 진입하자마자 반영돼요. 그래서 진입가와 현재가가 같아도{' '}
          <span className="font-semibold text-down">{entryRoiText(rules.fee_roundtrip_pct)}</span>에서 시작해요.
        </p>
        <p className="pt-1 font-semibold">포지션이 정리되는 경우</p>
        <ul className="list-disc space-y-1 pl-5">
          {rules.partial_close ? (
            <>
              <li>직접 청산 — 원할 때 바로 전량 정리해요.</li>
              <li>½ 절반 익절 — 수익 중일 때 원금의 절반만 정리해요.</li>
              <li>원금 회수 — 수익 중일 때 원금만큼 돌려받고, 수익금은 계속 보유해요.</li>
            </>
          ) : (
            <li>직접 청산 — 원할 때 바로 정리해요.</li>
          )}
          <li>손절·익절 — 정해 둔 가격에 닿으면 자동으로 정리돼요.</li>
          <li>
            자동 청산 — 수익률이 {marginCallText(rules.margin_call_roi_pct)}에 닿으면 정리돼요. 넣은 금액보다 더 잃지 않도록
            막아 주는 장치예요.
          </li>
          <li>시즌 종료 — 남은 포지션은 종가로 한꺼번에 정리돼요.</li>
        </ul>
        <Row label="자동 청산되는 주가 변동">{liquidationMovesText(rules)}</Row>
        <Note>
          하락으로 주문했다면 반대 방향(주가 상승)이에요. 손절·익절 %는 주가 기준(배율 미반영)이라, 높은 배율에선 손절보다 자동
          청산이 먼저 일어날 수 있어요.
        </Note>
      </Section>

      <Section title="🏆 시즌·랭킹·보상">
        {season?.period && <Row label="시즌 기간">{season.period === 'quarter' ? '분기(3개월)' : '월간(1개월)'}</Row>}
        {season?.end_at && <Row label="종료">{formatKstShort(season.end_at)}</Row>}
        <Note>시즌이 끝나면 남은 포지션은 종가로 정리되고, 상위 100명은 명예의 전당에 올라요.</Note>
        <Row label="주간 랭킹">{rankTiers(rules.rewards.weekly)}</Row>
        {quarter && <Row label="월간 랭킹">{rankTiers(rules.rewards.monthly)}</Row>}
        <Note>
          그 기간에 새 주문을 1번 이상 해야 받을 수 있어요. 시즌 마지막 주{quarter ? '·달' : ''}은 기록만 남아요.
        </Note>
        {streaks.length > 0 && (
          <>
            <p className="pt-1 font-semibold">연속 출석 보상 (시즌당 1번)</p>
            {streaks.map(([days, amt]) => (
              <Row key={days} label={`${days}일 연속`}>{formatWon(amt)}</Row>
            ))}
          </>
        )}
      </Section>

      <Section title="참여자 상승·하락 비율">
        <p>
          지금 시즌에 포지션을 보유 중인 사람들의 상승/하락 비율이에요. 인원 기준이라 금액·배율은 따지지 않아요.
        </p>
        <Note>
          {rules.sentiment_interval_sec}초마다 갱신돼요. 게임 참여자들의 분위기일 뿐, 실제 시장 수급 지표가 아니에요.
        </Note>
      </Section>
    </div>
  )
}

// 게임 규칙 — 숫자는 모두 /rules(+ 활성 시즌)에서. 비로그인도 열람 가능.
export default function GameRulesModal({ rulesState, season, onClose }: GameRulesModalProps) {
  const { rules, status, retry } = rulesState
  return (
    <Modal title="게임 규칙" onClose={onClose}>
      {rules ? (
        <RulesBody rules={rules} season={season} />
      ) : status === 'error' ? (
        <div className="py-8 text-center">
          <p className="text-sm text-ink-muted">규칙을 불러오지 못했어요</p>
          <Button type="button" variant="secondary" className="mt-3" onClick={retry}>
            다시 시도
          </Button>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-ink-muted">불러오는 중…</p>
      )}
    </Modal>
  )
}
