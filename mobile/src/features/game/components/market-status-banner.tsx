import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { MarketStatus } from '../types';

const ICON: Record<MarketStatus['state'], string> = {
  NORMAL: '',
  HALTED: '⛔',
  CIRCUIT_BREAKER: '🚨',
  MARKET_PAUSED: '🚨',
  VI: '⚡',
  SIDECAR: 'ℹ️',
};

const TITLE: Record<MarketStatus['state'], string> = {
  NORMAL: '',
  HALTED: '거래 정지',
  CIRCUIT_BREAKER: '서킷브레이커 발동',
  MARKET_PAUSED: '시장 거래 일시 정지',
  VI: '변동성 완화장치(VI) 발동',
  SIDECAR: '사이드카 발동',
};

/**
 * 장운영 상태 배너 — VI·거래정지·서킷브레이크는 주문이 막혀 있음을, 사이드카는 안내만. 평상시엔 숨김.
 * 문구는 서버(market_status)가 만든 것을 그대로 쓴다(주문 거부 문구와 같은 말). (web MarketStatusBanner 와 동일)
 */
export function MarketStatusBanner({ status }: { status: MarketStatus | null }) {
  if (!status || status.state === 'NORMAL') return null;
  return (
    <View
      style={[styles.box, status.blocking ? styles.blocking : styles.info]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      <Text style={styles.icon}>{ICON[status.state]}</Text>
      <View style={styles.body}>
        <Text style={styles.title}>
          {TITLE[status.state]}
          {status.blocking ? <Text style={styles.blockNote}> · 지금은 주문·청산이 안 돼요</Text> : null}
        </Text>
        <Text style={styles.message}>{status.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1), borderRadius: theme.radius.card, padding: theme.gap(2) },
  blocking: { backgroundColor: theme.colors.upSoft },
  info: { backgroundColor: theme.colors.surfaceBlue },
  icon: { fontSize: 16 },
  body: { flex: 1, gap: theme.gap(0.5) },
  title: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  blockNote: { fontSize: 12, fontWeight: '400', color: theme.colors.up },
  message: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
}));
