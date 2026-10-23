import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { listView } from '@/features/leaders/canslim';
import { formatIndex } from '@/features/market/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ListState } from '@/ui';

import { PatternChips } from '../components/pattern-chips';
import { PatternRow } from '../components/pattern-row';
import { usePatternScreen } from '../use-pattern-screen';

/** 패턴 칩 — 리포트 칩·패턴 칩·목록(끝까지 내리면 50개 더). 행을 누르면 onOpenStock */
export function PatternsSection({ onOpenStock }: { onOpenStock: (ticker: string, name: string) => void }) {
  const r = usePatternScreen();
  const { refreshing, onRefresh } = usePullRefresh(r.refresh);
  const view = listView({ loading: r.loading, error: r.error, date: r.date, count: r.items.length });
  const lastIndex = r.items.length - 1;
  // 현재 베이스는 종목당 하나가 정상이지만, 중복이 와도 키가 겹치지 않게 한다
  const keyCount = new Map<string, number>();
  for (const it of r.items) keyCount.set(it.ticker, (keyCount.get(it.ticker) ?? 0) + 1);

  return (
    <View style={styles.screen}>
      <PatternChips value={r.query} onReport={r.setReport} onPattern={r.togglePattern} />
      {view === 'loading' ? (
        <ListState mode="loading" />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, r.items.length === 0 && styles.grow]}
          data={r.items}
          keyExtractor={(it, i) => (keyCount.get(it.ticker) === 1 ? it.ticker : `${it.ticker}-${i}`)}
          ListHeaderComponent={
            view === 'list' ? <Text style={styles.total}>총 {formatIndex(r.total)}개</Text> : null
          }
          renderItem={({ item, index }) => (
            <View style={[styles.item, index === 0 && styles.first, index === lastIndex && styles.last]}>
              <PatternRow item={item} onPress={() => onOpenStock(item.ticker, item.name)} />
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
              <ListState mode="error" title="차트 패턴을 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${r.error})`} onRetry={r.reload} />
            ) : view === 'preparing' ? (
              <ListState mode="empty" emoji="🛠️" title="차트 패턴 데이터를 준비하고 있어요" hint="매일 장 마감 후 계산돼요" />
            ) : (
              <ListState mode="empty" emoji="📈" title="조건에 맞는 패턴이 없어요" hint="다른 리포트나 패턴을 골라 보세요" />
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
                <Text style={styles.basis}>
                  {r.date ? `${r.date} 기준일 종가 · ` : ''}매일 20:30 갱신 · 패턴 판정은 참고용이며 투자 권유가 아니에요
                </Text>
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
