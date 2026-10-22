import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { FinderSection } from '@/features/finder/sections/finder-section';
import { LeadersSection } from '@/features/leaders/sections/leaders-section';
import { CalendarSection } from '@/features/market/sections/calendar-section';
import { GroupSection } from '@/features/market/sections/group-section';
import { MarketSection } from '@/features/market/sections/market-section';
import type { GroupKind } from '@/features/market/types';
import { PatternsSection } from '@/features/patterns/sections/patterns-section';
import { Chip } from '@/ui';

type Tab = 'market' | 'theme' | 'sector' | 'calendar' | 'leaders' | 'finder' | 'patterns';
const TABS: [Tab, string][] = [
  ['market', '시장'],
  ['theme', '테마'],
  ['sector', '업종'],
  ['calendar', '일정'],
  ['leaders', '주도주'],
  ['finder', '조건검색'],
  ['patterns', '패턴'],
];

/** 스크리너 탭 — 위쪽 칩(시장·테마·업종·일정·주도주·조건검색·패턴, 웹 탭 순서와 같음)으로 아래 내용을 바꾼다 */
export default function ScreenerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('market');

  const openGroup = (kind: GroupKind, id: string) =>
    router.push({ pathname: '/market/[kind]/[id]', params: { kind, id } });
  const openStock = (ticker: string, name: string) =>
    router.push({ pathname: '/stock/[ticker]', params: { ticker, name } });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsBar}>
        {TABS.map(([v, t]) => <Chip key={v} label={t} selected={tab === v} onPress={() => setTab(v)} />)}
      </ScrollView>
      <Text style={styles.notice}>ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</Text>
      {tab === 'market' ? <MarketSection onMore={setTab} onOpenGroup={openGroup} /> : null}
      {tab === 'theme' ? <GroupSection key="theme" kind="theme" onOpenGroup={openGroup} /> : null}
      {tab === 'sector' ? <GroupSection key="sector" kind="sector" onOpenGroup={openGroup} /> : null}
      {tab === 'calendar' ? <CalendarSection /> : null}
      {tab === 'leaders' ? <LeadersSection onOpenStock={openStock} /> : null}
      {tab === 'finder' ? <FinderSection onOpenStock={openStock} /> : null}
      {tab === 'patterns' ? <PatternsSection onOpenStock={openStock} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  tabsBar: { flexGrow: 0 },
  tabs: { gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
  notice: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(0.5) },
}));
