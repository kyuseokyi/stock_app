import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { listView } from '@/features/leaders/canslim';
import { formatIndex } from '@/features/market/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState } from '@/ui';

import { FinderFilterSheet } from '../components/finder-filter-sheet';
import { FinderRow } from '../components/finder-row';
import { PresetChips } from '../components/preset-chips';
import { activeFilterCount, FINDER_SORTS } from '../finder';
import { useFinderScreen } from '../use-finder-screen';

/** 조건검색 칩 — 프리셋 칩·정렬 칩·[필터]·목록(끝까지 내리면 50개 더). 행을 누르면 onOpenStock */
export function FinderSection({ onOpenStock }: { onOpenStock: (ticker: string, name: string) => void }) {
  const r = useFinderScreen();
  const { refreshing, onRefresh } = usePullRefresh(r.refresh);
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = listView({ loading: r.loading, error: r.error, date: r.date, count: r.items.length });
  const filterCount = activeFilterCount(r.query.filters);
  const lastIndex = r.items.length - 1;

  return (
    <View style={styles.screen}>
      <PresetChips value={r.query.preset} onToggle={r.setPreset} />
      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortBar} contentContainerStyle={styles.sorts}>
          {FINDER_SORTS.map((s) => (
            <Chip key={s.key} label={s.label} selected={r.query.sort === s.key} onPress={() => r.setSort(s.key)} />
          ))}
        </ScrollView>
        <Pressable
          style={styles.filterBtn}
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={filterCount > 0 ? `필터, ${filterCount}개 적용 중` : '필터'}
        >
          <Text style={styles.filterText}>필터</Text>
          {filterCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {view === 'loading' ? (
        <ListState mode="loading" />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, r.items.length === 0 && styles.grow]}
          data={r.items}
          keyExtractor={(it) => it.ticker}
          ListHeaderComponent={
            view === 'list' ? <Text style={styles.total}>총 {formatIndex(r.total)}개</Text> : null
          }
          renderItem={({ item, index }) => (
            <View style={[styles.item, index === 0 && styles.first, index === lastIndex && styles.last]}>
              <FinderRow item={item} onPress={() => onOpenStock(item.ticker, item.name)} />
            </View>
          )}
          ItemSeparatorComponent={() => (
            <View style={styles.item}>
              <View style={styles.line} />
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing || (r.loading && r.items.length > 0)} onRefresh={onRefresh} />}
          onEndReached={() => {
            if (!r.moreFailed) void r.loadMore();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            view === 'error' ? (
              <ListState mode="error" title="조건검색을 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${r.error})`} onRetry={r.reload} />
            ) : view === 'preparing' ? (
              <ListState mode="empty" emoji="🛠️" title="조건검색 데이터를 준비하고 있어요" hint="매일 장 마감 후 계산돼요" />
            ) : (
              <ListState mode="empty" emoji="🔎" title="조건에 맞는 종목이 없어요" hint="조건을 줄여 보세요" />
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
                <Text style={styles.basis}>{r.date} 종가 기준 · 매일 20:30 갱신 · 투자 권유가 아닙니다</Text>
              </View>
            )
          }
        />
      )}
      {sheetOpen ? (
        <FinderFilterSheet
          value={r.query.filters}
          onApply={(f) => {
            r.setFilters(f);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  controls: {
    flexDirection: 'row', alignItems: 'center', gap: theme.gap(1),
    paddingRight: theme.gap(2), paddingBottom: theme.gap(1),
  },
  sortBar: { flex: 1 },
  sorts: { gap: theme.gap(1), paddingLeft: theme.gap(2) },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5),
    borderRadius: theme.radius.chip, paddingVertical: theme.gap(0.75), paddingHorizontal: theme.gap(1.5),
    backgroundColor: theme.colors.fill,
  },
  filterText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: theme.colors.onPrimary },
  list: { paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(2) },
  grow: { flexGrow: 1 },
  total: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(0.5), paddingBottom: theme.gap(1) },
  item: { backgroundColor: theme.colors.surface, paddingHorizontal: theme.gap(2) },
  first: { borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card },
  last: { borderBottomLeftRadius: theme.radius.card, borderBottomRightRadius: theme.radius.card },
  line: { height: 1, backgroundColor: theme.colors.border },
  more: { paddingVertical: theme.gap(1.5), alignItems: 'center' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  basis: { fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', paddingTop: theme.gap(1.5) },
}));
