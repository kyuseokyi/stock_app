import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { marketTone } from '../canslim';
import type { CanslimMarket } from '../types';

/** 시장 방향(CANSLIM 의 M) — KOSPI·KOSDAQ 상태·분산일 + 기준일·갱신·투자 권유 아님 안내 */
export function MarketStrip({ markets, date }: { markets: CanslimMarket[]; date: string | null }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>시장 방향</Text>
        {markets.length === 0 ? <Text style={styles.muted}>지수 데이터를 모으고 있어요</Text> : null}
        {markets.map((m) => {
          const tone = marketTone(m.status);
          return (
            <View key={m.market} style={[styles.pill, styles[`${tone}Bg`]]}>
              <Text style={[styles.pillText, styles[tone]]}>
                {m.market} {m.status}
                <Text style={styles.days}> · 분산일 {m.distributionDays}일</Text>
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.note}>
        {date ? `${date} 종가 기준` : '분석 데이터를 준비하고 있어요'} · 매일 20:30 갱신 · 투자 권유가 아니에요
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(1) },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  muted: { fontSize: 13, color: theme.colors.textSecondary },
  pill: { borderRadius: theme.radius.chip, paddingHorizontal: theme.gap(1.25), paddingVertical: theme.gap(0.5) },
  pillText: { fontSize: 13, fontWeight: '700' },
  days: { fontSize: 12, fontWeight: '500' },
  upBg: { backgroundColor: theme.colors.upSoft },
  downBg: { backgroundColor: theme.colors.downSoft },
  flatBg: { backgroundColor: theme.colors.fill },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  note: { fontSize: 12, color: theme.colors.textSecondary },
}));
