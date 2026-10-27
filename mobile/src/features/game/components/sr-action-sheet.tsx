import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AmountText, BottomSheet, Button } from '@/ui';

import { closeActionOf } from '../lib/close-action';
import { srEventCopy, type SrEvent } from '../lib/sr-watch';
import type { Position } from '../types';

type Props = {
  event: SrEvent;
  /** 넓은 화면 이름(20선·BB상단·매물대) */
  name: string;
  position: Position;
  closing: boolean;
  onClosePosition: () => void;
  onHold: () => void;
  onDismiss: () => void;
};

/**
 * 지지·저항 대응 시트 — [💰 익절하기 / 🛡️ 손절하기] vs [✊ 홀딩](설계 2026-10-27 §7).
 * 이벤트 데이터만 받는다(나중에 푸시를 눌러 들어올 때도 같은 시트).
 */
export function SrActionSheet({ event, name, position, closing, onClosePosition, onHold, onDismiss }: Props) {
  const { theme } = useUnistyles();
  const copy = srEventCopy(event.type, name, event.levelPrice);
  const action = closeActionOf(position.pnl_amount);
  const actionColor = action.kind === 'tp' ? theme.colors.up : action.kind === 'sl' ? theme.colors.down : undefined;
  return (
    <BottomSheet title={copy.title} onClose={onDismiss}>
      <Text style={styles.body}>{copy.body}</Text>
      <View style={styles.pnl}>
        <Text style={styles.muted}>현재 평가손익</Text>
        {position.pnl_amount !== null ? (
          <AmountText value={position.pnl_amount} kind="won" signed size={17} />
        ) : (
          <Text style={styles.muted}>—</Text>
        )}
        {position.roi_pct !== null ? <AmountText value={position.roi_pct} kind="pct" size={14} weight="600" /> : null}
      </View>
      <Button label={action.label} labelColor={actionColor} variant="secondary" loading={closing} onPress={onClosePosition} />
      <Button label="✊ 홀딩" variant="secondary" onPress={onHold} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { fontSize: 15, color: theme.colors.text, marginBottom: theme.gap(1) },
  pnl: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75), marginBottom: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
}));
