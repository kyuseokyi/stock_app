import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { dayLabel, groupByDate } from '../format';
import type { CalendarEvent } from '../types';

/** 날짜별로 묶은 일정. 종목 일정은 "종목명 (티커)" + 서버가 만든 상세 문장 */
export function EventList({ events, today }: { events: CalendarEvent[]; today: string }) {
  return (
    <View style={styles.wrap}>
      {groupByDate(events).map((g) => (
        <View key={g.date} style={styles.day}>
          <Text style={[styles.dayLabel, g.date === today && styles.today]}>{dayLabel(g.date, today)}</Text>
          {g.events.map((e, i) => (
            <View key={`${e.title}-${i}`} style={styles.item}>
              <Text style={[styles.badge, e.category === '공모주' ? styles.ipo : styles.macro]}>{e.category}</Text>
              <View style={styles.text}>
                <Text style={styles.title}>{e.title}</Text>
                {e.ticker || e.detail ? (
                  <Text style={styles.sub}>
                    {[e.name && e.ticker ? `${e.name} (${e.ticker})` : e.ticker, e.detail].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(2) },
  day: { gap: theme.gap(1) },
  dayLabel: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  today: { color: theme.colors.primary },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1) },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  ipo: { color: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
  macro: { color: theme.colors.up, backgroundColor: theme.colors.upSoft },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  sub: { fontSize: 12, color: theme.colors.textSecondary },
}));
