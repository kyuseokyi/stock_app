import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { kstDateString } from '@/features/game/lib/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ListState } from '@/ui';

import { BasisNote } from '../components/basis-note';
import { EventList } from '../components/event-list';
import { GroupRow } from '../components/group-row';
import { IndexCard, MacroCard } from '../components/index-card';
import type { GroupKind } from '../types';
import { useAutoRefresh } from '../use-auto-refresh';
import { useMarketOverview } from '../use-market-overview';

type Props = {
  onMore: (tab: 'theme' | 'calendar') => void;
  onOpenGroup: (kind: GroupKind, id: string) => void;
};

/** 시장 칩 — 지수 카드·거시 지표·주도 테마 Top 5·다가오는 일정 3건 */
export function MarketSection({ onMore, onOpenGroup }: Props) {
  const { data, loading, error, reload, refresh, silentRefresh } = useMarketOverview();
  const { refreshing, onRefresh } = usePullRefresh(refresh);
  // 시장 칩이 보이고 앱이 앞에 있을 때만 30초마다 지수·거시만 조용히 갱신(칩을 바꾸면 이 컴포넌트가 사라져 멈춤)
  useAutoRefresh(silentRefresh);
  const today = kstDateString();

  if (loading && !data) return <ListState mode="loading" />;

  const indices = data?.overview.indices ?? [];
  const macro = data?.overview.macro ?? [];
  return (
    <ScrollView
      contentContainerStyle={[styles.content, (!data || indices.length === 0) && styles.grow]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error ? (
        <ListState mode="error" title="시장 데이터를 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${error})`} onRetry={reload} />
      ) : indices.length === 0 ? (
        <ListState mode="empty" emoji="🛠️" title="시장 데이터를 준비하고 있어요" hint="매일 장 마감 후 갱신돼요" />
      ) : (
        <>
          <View style={styles.grid}>
            {indices.map((ix) => <IndexCard key={ix.code} index={ix} />)}
          </View>
          {macro.length > 0 ? (
            <View style={styles.grid}>
              {macro.map((m) => <MacroCard key={m.seriesId} macro={m} />)}
            </View>
          ) : null}
          {data && data.themes.length > 0 ? (
            <View style={styles.card}>
              <SectionHead title="주도 테마 Top 5" onMore={() => onMore('theme')} />
              {data.themes.map((t) => <GroupRow key={t.id} item={t} onPress={() => onOpenGroup('theme', t.id)} />)}
            </View>
          ) : null}
          {data && data.events.length > 0 ? (
            <View style={styles.card}>
              <SectionHead title="다가오는 일정" onMore={() => onMore('calendar')} />
              <EventList events={data.events} today={today} />
            </View>
          ) : null}
          {/* 주도 테마가 실패해도 기준일이 남게 국내 지수 날짜로 대체(미국·환율은 거래일이 다름) */}
          <BasisNote date={data?.date ?? indices.find((ix) => ix.region === 'KR')?.date ?? null} />
        </>
      )}
    </ScrollView>
  );
}

function SectionHead({ title, onMore }: { title: string; onMore: () => void }) {
  return (
    <View style={styles.head}>
      <Text style={styles.headTitle}>{title}</Text>
      <Pressable onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${title} 더 보기`}>
        <Text style={styles.more}>더 보기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.gap(2), gap: theme.gap(1.5) },
  grow: { flexGrow: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: theme.gap(1.5) },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2) },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.gap(0.5) },
  headTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  more: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
