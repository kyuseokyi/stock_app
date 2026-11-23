import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { EduCrowd } from '../types';

/** 오늘 참가자 선택 비율(상승·하락·관망) 가로 막대 — 참가자가 없으면 안내 문구만 */
export function EduCrowdBar({ crowd }: { crowd: EduCrowd | null }) {
  if (!crowd || crowd.total === 0) {
    return (
      <View style={styles.box}>
        <Text style={styles.title}>오늘 참가자들의 선택</Text>
        <Text style={styles.empty}>아직 오늘 참가한 사람이 없어요. 첫 번째로 결정해 보세요!</Text>
      </View>
    );
  }
  return (
    <View style={styles.box} accessibilityLabel={`상승 ${crowd.long_pct}%, 하락 ${crowd.short_pct}%, 관망 ${crowd.watch_pct}%, 참가 ${crowd.total}명`}>
      <View style={styles.head}>
        <Text style={styles.title}>오늘 참가자들의 선택</Text>
        <Text style={styles.total}>{crowd.total.toLocaleString('en-US')}명</Text>
      </View>
      <View style={styles.bar}>
        {crowd.long_pct > 0 ? <View style={[styles.seg, styles.long, { flex: crowd.long_pct }]} /> : null}
        {crowd.short_pct > 0 ? <View style={[styles.seg, styles.short, { flex: crowd.short_pct }]} /> : null}
        {crowd.watch_pct > 0 ? <View style={[styles.seg, styles.watch, { flex: crowd.watch_pct }]} /> : null}
      </View>
      <View style={styles.labels}>
        <Text style={[styles.label, styles.longText]}>상승 {crowd.long_pct}%</Text>
        <Text style={[styles.label, styles.shortText]}>하락 {crowd.short_pct}%</Text>
        <Text style={styles.label}>관망 {crowd.watch_pct}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { gap: theme.gap(1) },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  total: { fontSize: 13, color: theme.colors.textSecondary },
  empty: { fontSize: 14, lineHeight: 20, color: theme.colors.textSecondary },
  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: theme.colors.fill, gap: 2 },
  seg: { height: '100%' },
  long: { backgroundColor: theme.colors.up },
  short: { backgroundColor: theme.colors.down },
  watch: { backgroundColor: theme.colors.textSecondary },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  longText: { color: theme.colors.up },
  shortText: { color: theme.colors.down },
}));
