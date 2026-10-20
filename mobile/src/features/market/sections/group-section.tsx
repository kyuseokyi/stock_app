import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState } from '@/ui';

import { BasisNote } from '../components/basis-note';
import { GroupRow } from '../components/group-row';
import type { GroupKind, GroupSort, Period } from '../types';
import { useGroupRanking } from '../use-group-ranking';

const PERIODS: [Period, string][] = [['1d', '1일'], ['5d', '5일'], ['20d', '20일']];
const SORTS: [GroupSort, string][] = [['chg', '등락률'], ['value', '거래대금']];

/** 테마·업종 칩 — 기간·정렬 칩, 순위 목록(끝까지 내리면 30개 더), 누르면 그룹 상세 */
export function GroupSection({ kind, onOpenGroup }: { kind: GroupKind; onOpenGroup: (kind: GroupKind, id: string) => void }) {
  const r = useGroupRanking(kind);
  const { refreshing, onRefresh } = usePullRefresh(r.refresh);
  const label = kind === 'theme' ? '테마' : '업종';

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        {PERIODS.map(([v, t]) => <Chip key={v} label={t} selected={r.period === v} onPress={() => r.setPeriod(v)} />)}
        <View style={styles.sep} />
        {SORTS.map(([v, t]) => <Chip key={v} label={t} selected={r.sort === v} onPress={() => r.setSort(v)} />)}
      </View>
      {r.loading && r.items.length === 0 ? (
        <ListState mode="loading" />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, r.items.length === 0 && styles.grow]}
          data={r.items}
          keyExtractor={(it) => it.id}
          renderItem={({ item, index }) => (
            <GroupRow
              item={item}
              // 서버 순위는 1일·등락률 기준 — 다른 조건에선 줄 번호(웹과 같음)
              order={r.period === '1d' && r.sort === 'chg' ? undefined : index + 1}
              onPress={() => onOpenGroup(kind, item.id)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.line} />}
          refreshControl={<RefreshControl refreshing={refreshing || (r.loading && r.items.length > 0)} onRefresh={onRefresh} />}
          onEndReached={() => { if (!r.moreFailed) void r.loadMore(); }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            r.error ? (
              <ListState mode="error" title={`${label}를 불러오지 못했어요`} hint={`잠시 후 다시 시도해 주세요 (오류: ${r.error})`} onRetry={r.reload} />
            ) : (
              <ListState mode="empty" emoji="📊" title={`아직 집계된 ${label}가 없어요`} hint="매일 장 마감 후 갱신돼요" />
            )
          }
          ListFooterComponent={
            r.items.length === 0 ? null : (
              <View>
                {r.loadingMore ? <ActivityIndicator style={styles.more} /> : null}
                {r.moreFailed ? (
                  <Pressable onPress={() => void r.loadMore()} style={styles.more} accessibilityRole="button">
                    <Text style={styles.moreText}>더 불러오지 못했어요 · 다시 시도</Text>
                  </Pressable>
                ) : null}
                <BasisNote date={r.date} />
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(1) },
  sep: { width: 1, height: 20, backgroundColor: theme.colors.border, marginHorizontal: theme.gap(0.5) },
  list: { marginHorizontal: theme.gap(2), paddingHorizontal: theme.gap(2), backgroundColor: theme.colors.surface, borderRadius: theme.radius.card },
  grow: { flexGrow: 1, backgroundColor: 'transparent' },
  line: { height: 1, backgroundColor: theme.colors.border },
  more: { paddingVertical: theme.gap(1.5), alignItems: 'center' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
