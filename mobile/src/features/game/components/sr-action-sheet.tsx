import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AmountText, BottomSheet, Button } from '@/ui';

import { closeActionOf } from '../lib/close-action';
import { formatPrice } from '../lib/format';
import { partialClosePreview, type ClosePortion } from '../lib/partial-close';
import { srEventCopy, type SrEvent } from '../lib/sr-watch';
import type { Position } from '../types';

type Props = {
  event: SrEvent;
  /** 넓은 화면 이름(20선·BB상단·매물대) */
  name: string;
  position: Position;
  closing: boolean;
  onClosePosition: () => void;
  /** 부분 익절·원금 회수 버튼 노출(canPartialClose — 서버 partial_close + 수익 상태) */
  partialClose?: boolean;
  onPartialClose?: (portion: Exclude<ClosePortion, 'all'>) => void;
  onHold: () => void;
  onDismiss: () => void;
};

/**
 * 지지·저항 대응 시트 — [💰 익절하기 / 🛡️ 손절하기] vs [✊ 홀딩](설계 2026-10-27 §7).
 * 수익 중이고 서버가 지원하면 [½ 절반 익절] [원금 회수]도(설계 2026-10-28 §3).
 * 이벤트 데이터만 받는다(나중에 푸시를 눌러 들어올 때도 같은 시트).
 */
export function SrActionSheet({
  event,
  name,
  position,
  closing,
  onClosePosition,
  partialClose = false,
  onPartialClose,
  onHold,
  onDismiss,
}: Props) {
  const { theme } = useUnistyles();
  const copy = srEventCopy(event.type, name, event.levelPrice);
  const action = closeActionOf(position.pnl_amount);
  const actionColor = action.kind === 'tp' ? theme.colors.up : action.kind === 'sl' ? theme.colors.down : undefined;
  const preview =
    partialClose && onPartialClose && position.pnl_amount !== null
      ? partialClosePreview(position.size_amount, position.pnl_amount)
      : null;
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
      {preview && onPartialClose ? (
        <>
          <View style={styles.partialRow}>
            <View style={styles.partialCell}>
              <Button label="½ 절반 익절" variant="secondary" disabled={closing} onPress={() => onPartialClose('half')} />
            </View>
            {preview.principal ? (
              <View style={styles.partialCell}>
                <Button label="원금 회수" variant="secondary" disabled={closing} onPress={() => onPartialClose('principal')} />
              </View>
            ) : null}
          </View>
          {preview.principal ? (
            <Text style={styles.hint}>
              원금 회수: 원금 {formatPrice(preview.principal.returned)}원 회수 · 수익{' '}
              {formatPrice(preview.principal.remainValue)}원은 계속 보유
            </Text>
          ) : null}
        </>
      ) : null}
      <Button label="✊ 홀딩" variant="secondary" onPress={onHold} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { fontSize: 15, color: theme.colors.text, marginBottom: theme.gap(1) },
  pnl: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75), marginBottom: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  partialRow: { flexDirection: 'row', gap: theme.gap(1) },
  partialCell: { flex: 1 },
  hint: { fontSize: 13, color: theme.colors.textSecondary },
}));
