import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card, ListState } from '@/ui';

import { STOP_LOSS_PCTS } from '../lib/order-options';
import { rankingRuleText } from '../lib/ranking-period';
import {
  feeText,
  leverageExampleRows,
  leverageUnlockText,
  leveragesText,
  liquidationMovesText,
  pctText,
  seasonPeriodText,
  slPreemptedText,
  streakRewardsText,
  tradingWindowsText,
} from '../lib/rules';
import { formatRewardWon } from '../lib/weekly';
import type { GameRules, Season } from '../types';
import { useGameRules } from '../use-game-rules';
import { Sheet } from './sheet';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  );
}

/** 라벨 — 값 한 줄 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const P = ({ children }: { children: ReactNode }) => <Text style={styles.p}>{children}</Text>;
const Bullet = ({ children }: { children: ReactNode }) => <Text style={styles.bullet}>· {children}</Text>;

function ExampleTable({ leverages }: { leverages: number[] }) {
  const up = leverageExampleRows(leverages, 1);
  const down = leverageExampleRows(leverages, -1);
  return (
    <View style={styles.table}>
      <View style={styles.tr}>
        <Text style={[styles.td, styles.tdHead, styles.th]}>주가 1% 움직임</Text>
        {leverages.map((l) => (
          <Text key={l} style={[styles.td, styles.th]}>
            {l}배
          </Text>
        ))}
      </View>
      <View style={styles.tr}>
        <Text style={[styles.td, styles.tdHead]}>예측대로</Text>
        {up.map((r) => (
          <Text key={r.leverage} style={[styles.td, styles.up]}>
            {r.pnl}
          </Text>
        ))}
      </View>
      <View style={styles.tr}>
        <Text style={[styles.td, styles.tdHead]}>반대로</Text>
        {down.map((r) => (
          <Text key={r.leverage} style={[styles.td, styles.down]}>
            {r.pnl}
          </Text>
        ))}
      </View>
    </View>
  );
}

function RulesBody({ rules, season }: { rules: GameRules; season: Pick<Season, 'period' | 'end_at'> }) {
  const fee = feeText(rules);
  const unlock = leverageUnlockText(rules.leverage_unlock);
  const slFirst = slPreemptedText(rules, STOP_LOSS_PCTS);
  const marginRoi = `${pctText(rules.margin_call_roi_pct)}%`;
  const quarter = season.period === 'quarter';

  return (
    <>
      <Section title="💰 시작과 주문">
        <Row label="시작 자본금" value={formatRewardWon(rules.initial_cash)} />
        <Row label="최소 주문" value={formatRewardWon(rules.min_order_amount)} />
        <Row label="동시 보유" value={`${rules.max_open_positions}개`} />
        <Row label="거래 시간(KST)" value={tradingWindowsText(rules.trading_windows)} />
        <P>비중은 자본금 중 얼마를 걸지 정하는 비율이에요.</P>
        <P>포지션은 한 번에 {rules.max_open_positions}개만 가질 수 있어요. 청산한 뒤에 새로 걸 수 있어요.</P>
      </Section>

      <Section title="📈 상승·하락과 배율">
        <P>🔴 상승에 걸면 주가가 오를 때, 🔵 하락에 걸면 주가가 내릴 때 수익이 나요.</P>
        <P>손익(%) = 주가 변동률 × 배율 − 수수료</P>
        <ExampleTable leverages={rules.leverages} />
        <P>
          배율은 {leveragesText(rules.leverages)} 중에서 골라요. 반대로 움직이면 같은 크기로 손실이 나요.
        </P>
        {unlock ? <P>{unlock}.</P> : null}
      </Section>

      <Section title="🧾 수수료와 청산">
        <P>
          왕복 수수료 {fee}가 진입하자마자 반영돼요. 그래서 진입가와 현재가가 같아도 −{fee}에서 시작해요.
        </P>
        <Text style={styles.sub}>청산되는 경우</Text>
        <Bullet>직접 청산 — 원할 때 즉시 전액 청산</Bullet>
        <Bullet>손절·익절 — 정해 둔 가격에 닿으면 자동으로</Bullet>
        <Bullet>자동 청산 — 수익률이 {marginRoi}에 닿으면</Bullet>
        <Bullet>시즌 종료 — 남은 포지션을 종가로 한꺼번에</Bullet>
        <P>자동 청산은 건 금액보다 더 잃지 않도록 하기 위한 장치예요.</P>
        <P>
          자동 청산되는 주가 변동: {liquidationMovesText(rules)} (하락에 걸었다면 반대 방향이에요)
        </P>
        <P>
          손절·익절 %는 진입가 대비 주가 변동 기준이에요(배율 미반영).
          {slFirst ? ` ${slFirst}은 자동 청산이 먼저 일어나요.` : ''}
        </P>
      </Section>

      <Section title="🏆 시즌·랭킹·보상">
        <Row label="시즌" value={seasonPeriodText(season)} />
        <P>시즌이 끝나면 남은 포지션은 종가로 한꺼번에 청산되고, 상위 100명은 명예의 전당에 올라요.</P>
        <Text style={styles.sub}>주간 랭킹</Text>
        <P>{rankingRuleText('week', rules.rewards.weekly)}</P>
        {quarter ? (
          <>
            <Text style={styles.sub}>월간 랭킹</Text>
            <P>{rankingRuleText('month', rules.rewards.monthly)}</P>
          </>
        ) : null}
        <Text style={styles.sub}>연속 출석</Text>
        <P>{streakRewardsText(rules.rewards.streak)} · 시즌마다 1번씩 받을 수 있어요</P>
      </Section>

      <Section title="📊 유저 베팅 심리">
        <P>지금 시즌에 포지션을 들고 있는 사람 중 상승·하락에 건 비율이에요(인원 기준, 금액·배율 무관).</P>
        <P>{rules.sentiment_interval_sec}초마다 갱신돼요. 실제 시장 수급 지표가 아니에요.</P>
      </Section>
    </>
  );
}

/** 게임 규칙 시트 — 공개(비로그인 가능). 숫자는 모두 GET /api/game/rules + 활성 시즌 정보 */
export function RulesSheet({ season, onClose }: { season: Pick<Season, 'period' | 'end_at'>; onClose: () => void }) {
  const { rules, error, retry } = useGameRules();
  return (
    <Sheet title="📖 게임 규칙" onClose={onClose}>
      {rules ? (
        <RulesBody rules={rules} season={season} />
      ) : error ? (
        <ListState mode="error" title="규칙을 불러오지 못했어요" onRetry={retry} />
      ) : (
        <ListState mode="loading" />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  sectionBody: { marginTop: theme.gap(1.5), gap: theme.gap(1) },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.gap(1.5) },
  rowLabel: { fontSize: 14, color: theme.colors.textSecondary },
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    fontVariant: ['tabular-nums'],
  },
  p: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  sub: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, marginTop: theme.gap(0.5) },
  bullet: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  table: { borderRadius: theme.radius.chip, backgroundColor: theme.colors.fill, paddingVertical: theme.gap(0.5) },
  tr: { flexDirection: 'row', paddingHorizontal: theme.gap(1), paddingVertical: theme.gap(0.5) },
  td: { flex: 1, fontSize: 13, textAlign: 'center', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  tdHead: { flex: 1.6, textAlign: 'left' },
  th: { fontWeight: '600', color: theme.colors.textSecondary },
  up: { color: theme.colors.up, fontWeight: '600' },
  down: { color: theme.colors.down, fontWeight: '600' },
}));
