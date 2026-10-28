import { useState } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AmountText, Button, Card } from '@/ui';

import { closeActionOf } from '../lib/close-action';
import { formatPrice } from '../lib/format';
import { slTpLine } from '../lib/order-options';
import { partialClosePreview, type ClosePortion } from '../lib/partial-close';
import { sideLabel } from '../lib/side';
import type { Position } from '../types';

type Props = {
  position: Position;
  lastPrice: number | null;
  closing: boolean;
  onClose: () => void;
  /** 부분 익절·원금 회수 버튼 노출(canPartialClose — 서버 partial_close + 수익 상태) */
  partialClose?: boolean;
  onPartialClose?: (portion: Exclude<ClosePortion, 'all'>) => void;
};

/** 보유 포지션 — 평가손익(₩, %)은 WS position_pnl 로 틱마다 갱신. 손익에 따라 익절/손절 원클릭 전액 청산, 수익 중이면 절반 익절·원금 회수 */
export function PositionCard({ position, lastPrice, closing, onClose, partialClose = false, onPartialClose }: Props) {
  const { theme } = useUnistyles();
  // 누른 버튼에만 스피너 — 청산 중에는 세 버튼 모두 비활성(Button 의 loading/disabled)
  const [pressed, setPressed] = useState<ClosePortion>('all');
  const press = (portion: ClosePortion, run: () => void) => {
    setPressed(portion);
    run();
  };
  const preview =
    partialClose && onPartialClose && position.pnl_amount !== null
      ? partialClosePreview(position.size_amount, position.pnl_amount)
      : null;
  // 손익에 따라 익절/손절 — 색은 손익 글자와 같은 상승·하락 색(사유는 서버가 체결 가격으로 정함)
  const action = closeActionOf(position.pnl_amount);
  const actionColor = action.kind === 'tp' ? theme.colors.up : action.kind === 'sl' ? theme.colors.down : undefined;
  const long = position.side === 'LONG';
  const slTp = slTpLine(position.stop_loss_price, position.take_profit_price);
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.side}>
          <Text style={long ? styles.long : styles.short}>{sideLabel(position.side)}</Text> {position.leverage}배
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
        <Button
          label={action.label}
          labelColor={actionColor}
          variant="secondary"
          loading={closing && pressed === 'all'}
          disabled={closing}
          onPress={() => press('all', onClose)}
        />
      </View>
      {preview && onPartialClose ? (
        <View style={styles.partial}>
          <View style={styles.partialRow}>
            <View style={styles.partialCell}>
              <Button
                label="½ 절반 익절"
                variant="secondary"
                loading={closing && pressed === 'half'}
                disabled={closing}
                onPress={() => press('half', () => onPartialClose('half'))}
              />
            </View>
            {preview.principal ? (
              <View style={styles.partialCell}>
                <Button
                  label="원금 회수"
                  variant="secondary"
                  loading={closing && pressed === 'principal'}
                  disabled={closing}
                  onPress={() => press('principal', () => onPartialClose('principal'))}
                />
              </View>
            ) : null}
          </View>
          {preview.principal ? (
            <Text style={styles.hint}>
              원금 회수: 원금 {formatPrice(preview.principal.returned)}원 회수 · 수익{' '}
              {formatPrice(preview.principal.remainValue)}원은 계속 보유
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
  side: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  long: { color: theme.colors.up },
  short: { color: theme.colors.down },
  pnl: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75) },
  dash: { fontSize: 17, fontWeight: '700', color: theme.colors.textSecondary },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  action: { marginTop: theme.gap(1.5) },
  partial: { marginTop: theme.gap(1), gap: theme.gap(0.75) },
  partialRow: { flexDirection: 'row', gap: theme.gap(1) },
  partialCell: { flex: 1 },
  hint: { fontSize: 13, color: theme.colors.textSecondary },
}));
