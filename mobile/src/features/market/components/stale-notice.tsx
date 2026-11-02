import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** 시세 지연 안내 — inset 은 스스로 좌우 여백을 둘지(스크롤 본문처럼 부모에 여백이 있으면 false) */
export function StaleNotice({ inset = true }: { inset?: boolean }) {
  return <Text style={[styles.notice, inset && styles.inset]}>ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</Text>;
}

const styles = StyleSheet.create((theme) => ({
  notice: { fontSize: 12, color: theme.colors.textSecondary },
  inset: { paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(0.5) },
}));
