import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card, Chip } from '@/ui';

import type { Leverage, Ratio, Side } from '../types';

const RATIOS: { value: Ratio; label: string }[] = [
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 1.0, label: '100%' },
];
const LEVERAGES: Leverage[] = [1, 2, 5];

type Props = {
  hasPosition: boolean;
  academyUnlocked: boolean;
  submitting: boolean;
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage) => void;
  onLockedLeverage: () => void;
};

/** 원클릭 주문 — 비중·배율 칩 + BUY(상승=빨강)/SELL(하락=파랑). 5x 는 아카데미 미해금 시 잠금(🔒 → 아카데미) */
export function OrderPanel({ hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage }: Props) {
  const [ratio, setRatio] = useState<Ratio>(0.25);
  const [leverage, setLeverage] = useState<Leverage>(1);
  const disabled = hasPosition || submitting;

  // 해금이 풀리면(로그아웃·계정 전환) 선택돼 있던 5x 를 1x 로 되돌린다
  useEffect(() => {
    if (!academyUnlocked) setLeverage((l) => (l === 5 ? 1 : l));
  }, [academyUnlocked]);

  return (
    <Card>
      <View style={styles.chipRow}>
        <Text style={styles.caption}>비중</Text>
        {RATIOS.map((r) => (
          <Chip key={r.label} label={r.label} selected={ratio === r.value} onPress={() => setRatio(r.value)} />
        ))}
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
      <View style={styles.buttons}>
        <Pressable
          disabled={disabled}
          onPress={() => onOrder('LONG', ratio, leverage)}
          style={({ pressed }) => [styles.order, styles.buy, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={styles.orderLabel}>🔴 BUY</Text>
          <Text style={styles.orderSub}>(상승 베팅)</Text>
        </Pressable>
        <Pressable
          disabled={disabled}
          onPress={() => onOrder('SHORT', ratio, leverage)}
          style={({ pressed }) => [styles.order, styles.sell, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={styles.orderLabel}>🔵 SELL</Text>
          <Text style={styles.orderSub}>(하락 베팅)</Text>
        </Pressable>
      </View>
      {hasPosition ? <Text style={styles.hint}>보유 포지션을 먼저 청산하세요</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.gap(1), marginBottom: theme.gap(1) },
  caption: { fontSize: 12, color: theme.colors.textSecondary, width: 28 },
  buttons: { flexDirection: 'row', gap: theme.gap(1.5), marginTop: theme.gap(1) },
  order: {
    flex: 1,
    height: 56,
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buy: { backgroundColor: theme.colors.up },
  sell: { backgroundColor: theme.colors.down },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  orderLabel: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  orderSub: { fontSize: 12, fontWeight: '500', color: '#ffffff' },
  hint: { marginTop: theme.gap(1), fontSize: 12, textAlign: 'center', color: theme.colors.textSecondary },
}));
