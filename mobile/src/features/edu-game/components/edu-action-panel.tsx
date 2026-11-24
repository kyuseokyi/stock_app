import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatPrice } from '@/features/game/lib/format';
import { Button, Card, Chip, formatPct, formatSignedWon, formatWon, showToast } from '@/ui';

import {
  actionSummary,
  entryAmount,
  keepPreview,
  ratioLabel,
  remainingText,
  settleClock,
  stopTakePreview,
  type EduPanelMode,
} from '../lib/edu-game';
import type { EduActionRequest, EduState } from '../types';

type Props = {
  state: EduState;
  mode: EduPanelMode;
  submitting: boolean;
  nowMs: number;
  onSubmit: (req: EduActionRequest) => void;
  onLogin: () => void;
};

/**
 * 하루 1회 의사결정 패널(명세 5.3) — 상태별:
 *  guest: 로그인 유도 / submitted: 잠금 + 오늘 결정 요약 + 남은 시간 / flat: 상승·하락 진입·관망 / holding: 유지(손절·익절 재설정)·50% 청산·전량 청산.
 * 옵션 칩은 서버 options 목록 그대로(5배는 아카데미 통과 전 잠금). 체결가는 오늘 종가.
 */
export function EduActionPanel({ state, mode, submitting, nowMs, onSubmit, onLogin }: Props) {
  const remain = remainingText(state.next_settlement_at, nowMs);
  const clock = settleClock(state.next_settlement_at);
  const footer = <Text style={styles.remain}>{`⏰ ${remain}${clock ? ` (${clock})` : ''}`}</Text>;

  if (mode === 'guest') {
    return (
      <Card>
        <Text style={styles.title}>로그인하고 오늘의 결정을 내려 보세요</Text>
        <Text style={styles.body}>
          하루 한 번, 종가 차트를 보고 상승·하락·관망 중 하나를 골라요. 가상 자금 1,000만 원으로 하는 연습이라 실제 돈은 들지 않아요.
        </Text>
        <Button label="로그인" onPress={onLogin} />
        {footer}
      </Card>
    );
  }
  if (mode === 'submitted') {
    const a = state.today_action;
    return (
      <Card>
        <Text style={styles.title}>✅ 오늘의 트레이딩 결정을 완료했어요!</Text>
        {a ? <Text style={styles.summary}>{actionSummary(a)}</Text> : null}
        {a?.action_type === 'HOLD_WATCH' ? (
          <Text style={styles.body}>위험해 보일 때 쉬어 가는 것도 중요한 투자 기술이에요. 관망 학습 보너스가 지급됐어요.</Text>
        ) : null}
        <Text style={styles.body}>다음 종가 캔들이 만들어지면 손익이 정산되고, 그때 다시 참가할 수 있어요.</Text>
        {footer}
      </Card>
    );
  }
  if (mode === 'holding') return <HoldingPanel state={state} submitting={submitting} onSubmit={onSubmit} footer={footer} />;
  return <FlatPanel state={state} submitting={submitting} onSubmit={onSubmit} footer={footer} />;
}

type InnerProps = { state: EduState; submitting: boolean; onSubmit: (req: EduActionRequest) => void; footer: ReactNode };
type FlatChoice = 'LONG' | 'SHORT' | 'WATCH';

const pick = <T,>(list: readonly T[] | undefined, preferred: T, fallback: T): T =>
  list && list.includes(preferred) ? preferred : list && list.length > 0 ? list[0] : fallback;

function FlatPanel({ state, submitting, onSubmit, footer }: InnerProps) {
  const opts = state.options;
  const close = state.today?.close ?? 0;
  const cash = state.account?.cash_balance ?? state.season?.initial_cash ?? 0;
  const [choice, setChoice] = useState<FlatChoice | null>(null);
  const [ratio, setRatio] = useState(() => pick(opts?.ratios, 0.5, 0.5));
  const [leverage, setLeverage] = useState(1);
  const [sl, setSl] = useState(() => pick(opts?.stop_loss_pcts, 5, 5));
  const [tp, setTp] = useState(() => pick(opts?.take_profit_pcts, 10, 10));

  const entering = choice === 'LONG' || choice === 'SHORT';
  const preview = entering && close > 0 ? stopTakePreview(choice, close, sl, tp) : null;

  const submit = () => {
    if (choice === 'WATCH') onSubmit({ action: 'HOLD_WATCH' });
    else if (choice) {
      onSubmit({
        action: choice === 'LONG' ? 'ENTER_LONG' : 'ENTER_SHORT',
        ratio,
        leverage,
        stop_loss_pct: sl,
        take_profit_pct: tp,
      });
    }
  };

  return (
    <Card>
      <Text style={styles.title}>오늘의 결정 (하루 1회)</Text>
      <View style={styles.choices}>
        <ChoiceButton label="📈 상승" tone="up" selected={choice === 'LONG'} onPress={() => setChoice('LONG')} />
        <ChoiceButton label="📉 하락" tone="down" selected={choice === 'SHORT'} onPress={() => setChoice('SHORT')} />
        <ChoiceButton label="👀 홀드" tone="neutral" selected={choice === 'WATCH'} onPress={() => setChoice('WATCH')} />
      </View>
      {choice === null ? <Text style={styles.body}>차트를 보고 오늘 종가 기준으로 무엇을 할지 골라 주세요.</Text> : null}
      {entering && opts ? (
        <View style={styles.options}>
          <OptionRow label="비중">
            {opts.ratios.map((r) => (
              <Chip key={r} label={ratioLabel(r)} selected={ratio === r} onPress={() => setRatio(r)} />
            ))}
          </OptionRow>
          <OptionRow label="배율">
            {opts.leverages.map((lv) => {
              const locked = lv === 5 && !opts.leverage_5x_unlocked;
              return (
                <Chip
                  key={lv}
                  label={locked ? `${lv}배 🔒` : `${lv}배`}
                  selected={leverage === lv}
                  onPress={() =>
                    locked ? showToast('5배는 아카데미 리스크 관리 퀴즈를 통과하면 열려요.') : setLeverage(lv)
                  }
                />
              );
            })}
          </OptionRow>
          <OptionRow label="손절">
            {opts.stop_loss_pcts.map((p) => (
              <Chip key={p} label={`-${p}%`} selected={sl === p} onPress={() => setSl(p)} />
            ))}
          </OptionRow>
          <OptionRow label="익절">
            {opts.take_profit_pcts.map((p) => (
              <Chip key={p} label={`+${p}%`} selected={tp === p} onPress={() => setTp(p)} />
            ))}
          </OptionRow>
          {preview ? (
            <View style={styles.preview}>
              <PreviewRow label="진입가(오늘 종가)" value={`${formatPrice(close)}원`} />
              <PreviewRow label="진입 금액" value={formatWon(entryAmount(cash, ratio))} />
              <PreviewRow label="손절가" value={`${formatPrice(preview.stopLoss)}원`} />
              <PreviewRow label="익절가" value={`${formatPrice(preview.takeProfit)}원`} />
            </View>
          ) : null}
          <Button label="오늘의 결정 제출하기 (1일 1회)" onPress={submit} loading={submitting} />
        </View>
      ) : null}
      {choice === 'WATCH' ? (
        <View style={styles.options}>
          <Text style={styles.body}>
            포지션 없이 오늘을 지켜봐요. 참가로 인정되어 연속 출석이 이어지고
            {opts && opts.hold_watch_bonus > 0 ? ` 관망 학습 보너스 ${formatWon(opts.hold_watch_bonus)}을 받아요.` : ' 관망 학습 보너스를 받아요.'}
          </Text>
          <Button label="오늘 홀드하기 (출석 인정)" onPress={submit} loading={submitting} />
        </View>
      ) : null}
      <Text style={styles.hint}>제출 후 결과를 보면 다른 참가자들의 오늘 선택도 볼 수 있어요.</Text>
      {footer}
    </Card>
  );
}

type HoldChoice = 'KEEP' | 'PARTIAL' | 'FULL';

function HoldingPanel({ state, submitting, onSubmit, footer }: InnerProps) {
  const pos = state.account?.position;
  const opts = state.options;
  const close = state.today?.close ?? 0;
  const [choice, setChoice] = useState<HoldChoice | null>(null);
  const [sl, setSl] = useState<number | null>(null); // null = 지금 값 그대로
  const [tp, setTp] = useState<number | null>(null);
  if (!pos) return null;

  const keep = keepPreview(pos, close, sl, tp);
  const sideLabel = pos.side === 'LONG' ? '📈 상승' : '📉 하락';
  const pnlStyle = pos.unrealized_pnl > 0 ? styles.up : pos.unrealized_pnl < 0 ? styles.down : null;

  const submit = () => {
    if (choice === 'KEEP') onSubmit({ action: 'KEEP_POS', stop_loss_pct: sl, take_profit_pct: tp });
    else if (choice === 'PARTIAL') onSubmit({ action: 'PARTIAL_CLOSE' });
    else if (choice === 'FULL') onSubmit({ action: 'FULL_CLOSE' });
  };

  return (
    <Card>
      <Text style={styles.title}>보유 중인 포지션</Text>
      <View style={styles.preview}>
        <PreviewRow label="방향 · 배율" value={`${sideLabel} · ${pos.leverage}배`} />
        <PreviewRow label="진입가" value={`${formatPrice(pos.entry_price)}원`} />
        <PreviewRow label="진입 금액" value={formatWon(pos.size_amount)} />
        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>평가 손익</Text>
          <Text style={[styles.previewValue, pnlStyle]}>{`${formatSignedWon(pos.unrealized_pnl)} (${formatPct(pos.roi_pct)})`}</Text>
        </View>
        <PreviewRow
          label="손절 / 익절"
          value={`${pos.stop_loss_price !== null ? formatPrice(pos.stop_loss_price) : '-'} / ${pos.take_profit_price !== null ? formatPrice(pos.take_profit_price) : '-'}`}
        />
      </View>
      <View style={styles.choices}>
        <ChoiceButton label="🔒 유지" tone="neutral" selected={choice === 'KEEP'} onPress={() => setChoice('KEEP')} />
        <ChoiceButton label="💰 50% 청산" tone="neutral" selected={choice === 'PARTIAL'} onPress={() => setChoice('PARTIAL')} />
        <ChoiceButton label="🚪 전량 청산" tone="neutral" selected={choice === 'FULL'} onPress={() => setChoice('FULL')} />
      </View>
      {choice === null ? <Text style={styles.body}>오늘 종가 기준으로 포지션을 어떻게 할지 골라 주세요.</Text> : null}
      {choice === 'KEEP' && opts ? (
        <View style={styles.options}>
          <Text style={styles.body}>필요하면 손절·익절 폭을 진입가 기준으로 다시 정해요.</Text>
          <OptionRow label="손절">
            <Chip label="그대로" selected={sl === null} onPress={() => setSl(null)} />
            {opts.stop_loss_pcts.map((p) => (
              <Chip key={p} label={`-${p}%`} selected={sl === p} onPress={() => setSl(p)} />
            ))}
          </OptionRow>
          <OptionRow label="익절">
            <Chip label="그대로" selected={tp === null} onPress={() => setTp(null)} />
            {opts.take_profit_pcts.map((p) => (
              <Chip key={p} label={`+${p}%`} selected={tp === p} onPress={() => setTp(p)} />
            ))}
          </OptionRow>
          {sl !== null || tp !== null ? (
            <View style={styles.preview}>
              <PreviewRow label="새 손절가" value={keep.stopLoss !== null ? `${formatPrice(keep.stopLoss)}원` : '-'} />
              <PreviewRow label="새 익절가" value={keep.takeProfit !== null ? `${formatPrice(keep.takeProfit)}원` : '-'} />
            </View>
          ) : null}
          {!keep.valid ? <Text style={styles.warn}>오늘 종가에 바로 닿는 가격이에요. 다른 폭을 골라 주세요.</Text> : null}
          <Button label="포지션 유지하기 (1일 1회)" onPress={submit} loading={submitting} disabled={!keep.valid} />
        </View>
      ) : null}
      {choice === 'PARTIAL' ? (
        <View style={styles.options}>
          <Text style={styles.body}>오늘 종가({formatPrice(close)}원)로 절반을 확정하고 나머지 50%는 계속 들고 가요.</Text>
          <Button label="50% 부분 청산하기 (1일 1회)" onPress={submit} loading={submitting} />
        </View>
      ) : null}
      {choice === 'FULL' ? (
        <View style={styles.options}>
          <Text style={styles.body}>오늘 종가({formatPrice(close)}원)로 포지션을 모두 정리해요.</Text>
          <Button label="전량 청산하기 (1일 1회)" onPress={submit} loading={submitting} />
        </View>
      ) : null}
      {footer}
    </Card>
  );
}

function ChoiceButton({
  label,
  tone,
  selected,
  onPress,
}: {
  label: string;
  tone: 'up' | 'down' | 'neutral';
  selected: boolean;
  onPress: () => void;
}) {
  const on = selected ? (tone === 'up' ? styles.choiceUp : tone === 'down' ? styles.choiceDown : styles.choiceOn) : null;
  const text = selected ? (tone === 'up' ? styles.up : tone === 'down' ? styles.down : styles.choiceTextOn) : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.choice, on, pressed && styles.pressed]}>
      <Text style={[styles.choiceText, text]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

function OptionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.optionRow}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionChips}>{children}</View>
    </View>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: { fontSize: 17, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(1) },
  summary: { fontSize: 15, fontWeight: '600', color: theme.colors.text, lineHeight: 22, marginBottom: theme.gap(1) },
  body: { fontSize: 14, lineHeight: 20, color: theme.colors.textSecondary, marginBottom: theme.gap(1) },
  hint: { fontSize: 12, lineHeight: 18, color: theme.colors.textSecondary, marginTop: theme.gap(1) },
  warn: { fontSize: 13, lineHeight: 18, color: theme.colors.danger },
  remain: { fontSize: 13, fontWeight: '600', color: theme.colors.primary, marginTop: theme.gap(1) },
  choices: { flexDirection: 'row', gap: theme.gap(1), marginBottom: theme.gap(1) },
  choice: {
    flex: 1,
    minHeight: 48,
    borderRadius: theme.radius.button,
    backgroundColor: theme.colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.gap(0.5),
  },
  choiceUp: { backgroundColor: theme.colors.upSoft },
  choiceDown: { backgroundColor: theme.colors.downSoft },
  choiceOn: { backgroundColor: theme.colors.primarySoft },
  choiceText: { fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  choiceTextOn: { color: theme.colors.primary },
  pressed: { opacity: 0.85 },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  options: { gap: theme.gap(1.25) },
  optionRow: { gap: theme.gap(0.75) },
  optionLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  optionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(0.75) },
  preview: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.input,
    padding: theme.gap(1.5),
    gap: theme.gap(0.75),
    marginBottom: theme.gap(1),
  },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { fontSize: 13, color: theme.colors.textSecondary },
  previewValue: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
}));
