import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState } from '@/ui';

import { BasisNote } from '../components/basis-note';
import { EventList } from '../components/event-list';
import { type CalendarCategory, useCalendar } from '../use-calendar';

const CATEGORIES: CalendarCategory[] = ['전체', '공모주', '경제지표'];

/** 일정 칩 — 분류 칩, 앞으로 60일(날짜별), 지난 7일은 펼쳐 보기 */
export function CalendarSection() {
  const c = useCalendar();
  const { refreshing, onRefresh } = usePullRefresh(c.refresh);
  const [showPast, setShowPast] = useState(false);

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        {CATEGORIES.map((v) => <Chip key={v} label={v} selected={c.category === v} onPress={() => c.setCategory(v)} />)}
      </View>
      {c.loading && c.upcoming.length === 0 && c.past.length === 0 ? (
        <ListState mode="loading" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, c.upcoming.length === 0 && styles.grow]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {c.error ? (
            <ListState mode="error" title="일정을 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${c.error})`} onRetry={c.reload} />
          ) : (
            <>
              {c.past.length > 0 ? (
                <View style={styles.card}>
                  <Pressable onPress={() => setShowPast((v) => !v)} accessibilityRole="button">
                    <Text style={styles.toggle}>{showPast ? '지난 일정 접기 ▲' : `지난 7일 일정 ${c.past.length}개 보기 ▼`}</Text>
                  </Pressable>
                  {showPast ? <View style={styles.past}><EventList events={c.past} today={c.today} /></View> : null}
                </View>
              ) : null}
              {c.upcoming.length > 0 ? (
                <View style={styles.card}><EventList events={c.upcoming} today={c.today} /></View>
              ) : (
                <ListState mode="empty" emoji="🗓️" title="앞으로 60일 안에 잡힌 일정이 없어요" hint="새 일정은 매일 아침 수집돼요" />
              )}
              <BasisNote date={null} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  controls: { flexDirection: 'row', gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(1) },
  content: { padding: theme.gap(2), paddingTop: 0, gap: theme.gap(1.5) },
  grow: { flexGrow: 1 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2) },
  toggle: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  past: { marginTop: theme.gap(1.5), opacity: 0.7 },
}));
