import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card, Chip } from '@/ui';

import {
  RATIO_CHIPS,
  RATIO_MORE,
  STOP_LOSS_PCTS,
  TAKE_PROFIT_PCTS,
  isChipRatio,
  ratioLabel,
  slTpHint,
  stopLossLabel,
  takeProfitLabel,
} from '../lib/order-options';
import type { Leverage, OrderOptions, Ratio, Side } from '../types';
import { OptionPicker, type PickerOption } from './option-picker';

const RATIO_MORE_OPTIONS: PickerOption<Ratio | null>[] = RATIO_MORE.map((r) => ({ value: r, label: ratioLabel(r) }));
const SL_OPTIONS: PickerOption<number | null>[] = [null, ...STOP_LOSS_PCTS].map((p) => ({ value: p, label: stopLossLabel(p) }));
const TP_OPTIONS: PickerOption<number | null>[] = [null, ...TAKE_PROFIT_PCTS].map((p) => ({ value: p, label: takeProfitLabel(p) }));
const LEVERAGES: Leverage[] = [1, 2, 5];

type Props = {
  hasPosition: boolean;
  academyUnlocked: boolean;
  submitting: boolean;
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage, opts: OrderOptions) => void;
  onLockedLeverage: () => void;
};

/**
 * 원클릭 주문 — 비중(칩 + ▾기타)·배율 칩 + 손절/익절 선택 + BUY(상승=빨강)/SELL(하락=파랑).
 * 5x 는 아카데미 미해금 시 잠금(🔒 → 아카데미). 비중 상태는 하나 — 칩 값이면 기타 트리거는 '기타'(파생).
 */
export function OrderPanel({ hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage }: Props) {
  const [ratio, setRatio] = useState<Ratio>(0.25);
  const [leverage, setLeverage] = useState<Leverage>(1);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [takeProfit, setTakeProfit] = useState<number | null>(null);
  const disabled = hasPosition || submitting;
  const moreActive = !isChipRatio(ratio);
  const order = (side: Side) => onOrder(side, ratio, leverage, { stopLossPct: stopLoss, takeProfitPct: takeProfit });

  // 해금이 풀리면(로그아웃·계정 전환) 선택돼 있던 5x 를 1x 로 되돌린다
  useEffect(() => {
    if (!academyUnlocked) setLeverage((l) => (l === 5 ? 1 : l));
  }, [academyUnlocked]);

  return (
    <Card style={styles.card}>
      <View style={styles.chipRow}>
        <Text style={styles.caption}>비중</Text>
        {RATIO_CHIPS.map((r) => (
          <Chip key={r} label={ratioLabel(r)} selected={ratio === r} onPress={() => setRatio(r)} />
        ))}
        <OptionPicker
          title="비중"
          options={RATIO_MORE_OPTIONS}
          value={moreActive ? ratio : null}
          placeholder="기타"
          active={moreActive}
          onChange={(r) => {
            if (r !== null) setRatio(r);
          }}
        />
      </View>
      <View style={styles.chipRow}>
        <Text style={styles.caption}>배율</Text>
        {LEVERAGES.map((l) => {
          const locked = l === 5 && !academyUnlocked;
          return (
            <Chip
              key={l}
              label={`${l}x${locked ? ' 🔒' : ''}`}
              selected={leverage === l}
              onPress={() => (locked ? onLockedLeverage() : setLeverage(l))}
            />
          );
        })}
      </View>
      <View style={styles.chipRow}>
        <Text style={styles.caption}>손절</Text>
        <OptionPicker
          title="손절"
          options={SL_OPTIONS}
          value={stopLoss}
          placeholder={stopLossLabel(null)}
          active={stopLoss !== null}
          onChange={setStopLoss}
        />
        <Text style={[styles.caption, styles.captionGap]}>익절</Text>
        <OptionPicker
          title="익절"
          options={TP_OPTIONS}
          value={takeProfit}
          placeholder={takeProfitLabel(null)}
          active={takeProfit !== null}
          onChange={setTakeProfit}
        />
      </View>
      <Text style={styles.hintLine}>{slTpHint(stopLoss, takeProfit, leverage)}</Text>
      <View style={styles.buttons}>
        <Pressable
          disabled={disabled}
          onPress={() => order('LONG')}
          style={({ pressed }) => [styles.order, styles.buy, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={[styles.orderLabel, styles.buyText]}>🔴 BUY</Text>
          <Text style={[styles.orderSub, styles.buyText]}>(상승 베팅)</Text>
        </Pressable>
        <Pressable
          disabled={disabled}
          onPress={() => order('SHORT')}
          style={({ pressed }) => [styles.order, styles.sell, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={[styles.orderLabel, styles.sellText]}>🔵 SELL</Text>
          <Text style={[styles.orderSub, styles.sellText]}>(하락 베팅)</Text>
        </Pressable>
      </View>
      {hasPosition ? <Text style={styles.hint}>보유 포지션을 먼저 청산하세요</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.gap(1), marginBottom: theme.gap(1) },
  caption: { fontSize: 12, color: theme.colors.textSecondary, width: 28 },
  captionGap: { marginLeft: theme.gap(1) },
  hintLine: { fontSize: 12, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
  buttons: { flexDirection: 'row', gap: theme.gap(1.5), marginTop: theme.gap(1) },
  order: {
    flex: 1,
    height: 56,
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buy: { backgroundColor: theme.colors.upSoft },
  sell: { backgroundColor: theme.colors.downSoft },
  buyText: { color: theme.colors.up },
  sellText: { color: theme.colors.down },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  orderLabel: { fontSize: 16, fontWeight: '700' },
  orderSub: { fontSize: 12, fontWeight: '500' },
  hint: { marginTop: theme.gap(1), fontSize: 12, textAlign: 'center', color: theme.colors.textSecondary },
}));
