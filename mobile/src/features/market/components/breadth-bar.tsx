import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** 상승·보합·하락 종목 수 비율 막대(가로 64) */
export function BreadthBar({ up, down, flat }: { up: number; down: number; flat: number }) {
  const total = up + down + flat || 1;
  return (
    <View style={styles.bar} accessible accessibilityLabel={`상승 ${up} · 보합 ${flat} · 하락 ${down}`}>
      <View style={[styles.up, { width: `${(up / total) * 100}%` }]} />
      <View style={[styles.flat, { width: `${(flat / total) * 100}%` }]} />
      <View style={[styles.down, { width: `${(down / total) * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: { flexDirection: 'row', width: 64, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: theme.colors.fill },
  up: { backgroundColor: theme.colors.up },
  // 바탕(fill)과 구분되게 대비 있는 중립색 — border 는 바탕과 거의 같아 보합 칸이 안 보였다
  flat: { backgroundColor: theme.colors.textSecondary },
  down: { backgroundColor: theme.colors.down },
}));
