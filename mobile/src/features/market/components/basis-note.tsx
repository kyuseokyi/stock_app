import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** 화면 맨 아래 안내 — 기준일·갱신 주기·투자 권유 아님 */
export function BasisNote({ date }: { date: string | null }) {
  return (
    <Text style={styles.note}>
      {date ? `기준일 ${date} · ` : ''}국내 지수 장중 30초 · 15:40 확정 · 종목·테마·업종 20:30 · 미국 06:30 갱신 · 투자 권유가 아니에요
    </Text>
  );
}

/** 일정 화면 맨 아래 안내 — 일정은 시세와 갱신 시각이 달라 따로 적는다 */
export function CalendarNote() {
  return <Text style={styles.note}>일정은 매일 아침·저녁 갱신돼요 · 경제지표 08:00 · 공모주 21:30 · 투자 권유가 아니에요</Text>;
}

const styles = StyleSheet.create((theme) => ({
  note: { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: theme.gap(2) },
}));
