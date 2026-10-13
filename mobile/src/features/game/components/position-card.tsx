import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button, Card } from '@/ui';

import { formatPrice } from '../lib/format';
import { slTpLine } from '../lib/order-options';
import type { Position } from '../types';

type Props = {
  position: Position;
  lastPrice: number | null;
  closing: boolean;
  onClose: () => void;
};

/** 보유 포지션 — 평가손익(₩, %)은 WS position_pnl 로 틱마다 갱신. 원클릭 전액 청산 */
export function PositionCard({ position, lastPrice, closing, onClose }: Props) {
  const long = position.side === 'LONG';
  const slTp = slTpLine(position.stop_loss_price, position.take_profit_price);
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.side}>
          <Text style={long ? styles.long : styles.short}>{position.side}</Text> x{position.leverage}배
        </Text>
        <View style={styles.pnl}>
          {position.pnl_amount !== null ? (
            <AmountText value={position.pnl_amount} kind="won" signed size={17} />
          ) : (
            <Text style={styles.dash}>—</Text>
          )}
          {position.roi_pct !== null ? (
            <AmountText value={position.roi_pct} kind="pct" size={14} weight="600" />
          ) : null}
        </View>
      </View>
      <Text style={styles.muted}>
        진입가 {formatPrice(position.entry_price)}원
        {lastPrice !== null ? ` (현재가 ${formatPrice(lastPrice)}원)` : ''}
      </Text>
      {slTp !== null ? <Text style={styles.muted}>{slTp}</Text> : null}
      <View style={styles.action}>
        <Button label="즉시 전액 청산하기" variant="secondary" loading={closing} onPress={onClose} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surfaceBlue },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
  side: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  long: { color: theme.colors.up },
  short: { color: theme.colors.down },
  pnl: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75) },
  dash: { fontSize: 17, fontWeight: '700', color: theme.colors.textSecondary },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  action: { marginTop: theme.gap(1.5) },
}));
