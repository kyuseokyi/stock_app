import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { closeBasis } from '../dashboard';

/** 컨트롤 줄 아래 한 줄 기준일 — 목록이 비어 있거나 다시 불러오는 동안에도 보인다. 날짜를 아직 모르면 그리지 않는다 */
export function CloseBasisCaption({ date }: { date: string | null }) {
  const basis = closeBasis(date);
  return basis ? <Text style={styles.caption}>{basis} · 매일 20:30 갱신</Text> : null;
}

const styles = StyleSheet.create((theme) => ({
  caption: { fontSize: 13, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(1) },
}));
