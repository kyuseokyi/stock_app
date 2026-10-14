import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Chip } from '@/ui';

import {
  ALL_RATIOS,
  STOP_LOSS_PCTS,
  TAKE_PROFIT_PCTS,
  orderSummary,
  ratioLabel,
  slTpHint,
  stopLossLabel,
  takeProfitLabel,
} from '../lib/order-options';
import { orderRulesHint } from '../lib/rules';
import type { Leverage, OrderOptions, Ratio, Side } from '../types';
import { useGameRules } from '../use-game-rules';
import { Sheet } from './sheet';

const LEVERAGES: Leverage[] = [1, 2, 5];
// iOS 는 Modal 이 닫히는 애니메이션 중에 다른 Modal 을 띄우면 무시된다 → 시트를 닫고 잠시 뒤 다음 시트
const NEXT_SHEET_DELAY_MS = Platform.OS === 'ios' ? 400 : 0;

type Props = {
  hasPosition: boolean;
  academyUnlocked: boolean;
  submitting: boolean;
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage, opts: OrderOptions) => void;
  onLockedLeverage: () => void;
  /** 설정 시트 안내 줄 '규칙 보기' → 규칙 시트(비로그인도 가능) */
  onOpenRules: () => void;
};

/**
 * 화면 아래 고정 주문 바 — 설정 요약(비중·배율·손절·익절) + 상승에 걸기(빨강)/하락에 걸기(파랑).
 * 게임 화면이 ScrollView 바깥(아래)에 두어 차트를 보면서 바로 걸 수 있다. 요약을 누르면 주문 설정 시트.
 * 시트 안은 OptionPicker(별도 Modal) 대신 칩으로 모두 펼친다(시트 Modal 위 Modal 중첩을 피함).
 * 5x 는 아카데미 미해금 시 잠금(🔒 → 시트 닫고 아카데미).
 */
export function OrderPanel({ hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage, onOpenRules }: Props) {
  const { rules } = useGameRules();
  const [ratio, setRatio] = useState<Ratio>(0.25);
  const [leverage, setLeverage] = useState<Leverage>(1);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [takeProfit, setTakeProfit] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const disabled = hasPosition || submitting;
  const order = (side: Side) => onOrder(side, ratio, leverage, { stopLossPct: stopLoss, takeProfitPct: takeProfit });
  const closeSheet = () => setSheetOpen(false);
  const closeThen = (next: () => void) => {
    closeSheet();
    setTimeout(next, NEXT_SHEET_DELAY_MS);
  };

  // 해금이 풀리면(로그아웃·계정 전환) 선택돼 있던 5x 를 1x 로 되돌린다
  useEffect(() => {
    if (!academyUnlocked) setLeverage((l) => (l === 5 ? 1 : l));
  }, [academyUnlocked]);

  return (
    <View style={styles.bar}>
      {hasPosition ? (
        <Text style={styles.hint}>보유 포지션을 먼저 청산하세요</Text>
      ) : (
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="주문 설정 열기"
          style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
          <Text style={styles.summaryText} numberOfLines={1}>
            {orderSummary(ratio, leverage, stopLoss, takeProfit)}
          </Text>
          <Text style={styles.summaryAction}>설정 ▾</Text>
        </Pressable>
      )}
      <View style={styles.buttons}>
        <Pressable
          disabled={disabled}
          onPress={() => order('LONG')}
          style={({ pressed }) => [styles.order, styles.buy, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={[styles.orderLabel, styles.buyText]}>🔴 상승에 걸기</Text>
        </Pressable>
        <Pressable
          disabled={disabled}
          onPress={() => order('SHORT')}
          style={({ pressed }) => [styles.order, styles.sell, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={[styles.orderLabel, styles.sellText]}>🔵 하락에 걸기</Text>
        </Pressable>
      </View>

      {sheetOpen ? (
        <Sheet title="주문 설정" onClose={closeSheet}>
          <Text style={styles.caption}>비중</Text>
          <View style={styles.chipRow}>
            {ALL_RATIOS.map((r) => (
              <Chip key={r} label={ratioLabel(r)} selected={ratio === r} onPress={() => setRatio(r)} />
            ))}
          </View>
          <Text style={styles.caption}>배율</Text>
          <View style={styles.chipRow}>
            {LEVERAGES.map((l) => {
              const locked = l === 5 && !academyUnlocked;
              return (
                <Chip
                  key={l}
                  label={`${l}x${locked ? ' 🔒' : ''}`}
                  selected={leverage === l}
                  onPress={() => {
                    if (locked) closeThen(onLockedLeverage);
                    else setLeverage(l);
                  }}
                />
              );
            })}
          </View>
          <Text style={styles.caption}>손절</Text>
          <View style={styles.chipRow}>
            {[null, ...STOP_LOSS_PCTS].map((p) => (
              <Chip key={String(p)} label={stopLossLabel(p)} selected={stopLoss === p} onPress={() => setStopLoss(p)} />
            ))}
          </View>
          <Text style={styles.caption}>익절</Text>
          <View style={styles.chipRow}>
            {[null, ...TAKE_PROFIT_PCTS].map((p) => (
              <Chip key={String(p)} label={takeProfitLabel(p)} selected={takeProfit === p} onPress={() => setTakeProfit(p)} />
            ))}
          </View>
          <Text style={styles.hintLine}>{slTpHint(stopLoss, takeProfit, leverage)}</Text>
          <Pressable
            onPress={() => closeThen(onOpenRules)}
            hitSlop={8}
            accessibilityRole="link"
            style={({ pressed }) => [styles.rulesLink, pressed && styles.pressed]}>
            <Text style={styles.rulesLinkText}>{orderRulesHint(rules)} ›</Text>
          </Pressable>
          <Pressable
            onPress={closeSheet}
            accessibilityRole="button"
            style={({ pressed }) => [styles.confirm, pressed && styles.pressed]}>
            <Text style={styles.confirmText}>확인</Text>
          </Pressable>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.gap(2),
    paddingTop: theme.gap(1),
    paddingBottom: theme.gap(1.25),
    gap: theme.gap(1),
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.button,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1),
  },
  summaryText: { flex: 1, fontSize: 12, color: theme.colors.textSecondary },
  summaryAction: { marginLeft: theme.gap(1), fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  caption: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  hintLine: { fontSize: 12, color: theme.colors.textSecondary },
  rulesLink: { alignSelf: 'flex-start' },
  rulesLinkText: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  buttons: { flexDirection: 'row', gap: theme.gap(1) },
  order: {
    flex: 1,
    height: 48,
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
  orderLabel: { fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 12, textAlign: 'center', color: theme.colors.textSecondary },
  confirm: {
    marginTop: theme.gap(1),
    height: 48,
    borderRadius: theme.radius.button,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { fontSize: 16, fontWeight: '700', color: '#fff' },
}));
