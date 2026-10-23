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
import { useScreenerFeatures } from '@/features/screener/use-screener-features';
import type { ScreenerFeatures } from '@/features/screener/api';
import { Chip } from '@/ui';

type Tab = 'market' | 'theme' | 'sector' | 'calendar' | 'leaders' | 'finder' | 'patterns';
// 두 묶음(시장 / 종목 찾기) — 웹 스크리너 메뉴와 같은 분류. 7개 칩이 한 줄이라 지금 위치가 어느 묶음인지 작은 제목으로 알린다
// 조건검색·패턴은 관리자 스위치(관리자 > 스크리너 설정)가 켜졌을 때만 보인다
const FEATURE_OF: Partial<Record<Tab, keyof ScreenerFeatures>> = { finder: 'finder', patterns: 'patterns' };
const GROUPS: { label: string; tabs: [Tab, string][] }[] = [
  { label: '시장', tabs: [['market', '개요'], ['theme', '테마'], ['sector', '업종'], ['calendar', '일정']] },
  { label: '종목 찾기', tabs: [['leaders', '주도주'], ['finder', '조건검색'], ['patterns', '패턴']] },
];

/** 스크리너 탭 — 위쪽 칩 두 묶음(시장: 개요·테마·업종·일정 / 종목 찾기: 주도주·조건검색·패턴, 웹 순서와 같음)으로 아래 내용을 바꾼다 */
export default function ScreenerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('market');
  const features = useScreenerFeatures();
  const visible = (t: Tab) => {
    const f = FEATURE_OF[t];
    return f === undefined || features[f];
  };
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter(([v]) => visible(v)) }));
  // 보고 있던 탭이 관리자 스위치로 꺼지면 주도주로
  const current: Tab = visible(tab) ? tab : 'leaders';

  const openGroup = (kind: GroupKind, id: string) =>
    router.push({ pathname: '/market/[kind]/[id]', params: { kind, id } });
  const openStock = (ticker: string, name: string) =>
    router.push({ pathname: '/stock/[ticker]', params: { ticker, name } });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsBar}>
        {groups.map((g, i) => (
          <View key={g.label} style={[styles.group, i > 0 && styles.groupNext]} accessibilityRole="tablist" accessibilityLabel={g.label}>
            <Text style={styles.groupLabel}>{g.label}</Text>
            <View style={styles.chips}>
              {g.tabs.map(([v, t]) => <Chip key={v} label={t} selected={current === v} onPress={() => setTab(v)} />)}
            </View>
          </View>
        ))}
      </ScrollView>
      <Text style={styles.notice}>ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</Text>
      {current === 'market' ? <MarketSection onMore={setTab} onOpenGroup={openGroup} /> : null}
      {current === 'theme' ? <GroupSection key="theme" kind="theme" onOpenGroup={openGroup} /> : null}
      {current === 'sector' ? <GroupSection key="sector" kind="sector" onOpenGroup={openGroup} /> : null}
      {current === 'calendar' ? <CalendarSection /> : null}
      {current === 'leaders' ? <LeadersSection onOpenStock={openStock} /> : null}
      {current === 'finder' ? <FinderSection onOpenStock={openStock} /> : null}
      {current === 'patterns' ? <PatternsSection onOpenStock={openStock} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  tabsBar: { flexGrow: 0 },
  tabs: { gap: theme.gap(2), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
  group: { gap: theme.gap(0.5) },
  groupNext: { borderLeftWidth: 1, borderLeftColor: theme.colors.border, paddingLeft: theme.gap(2) },
  groupLabel: { fontSize: 12, color: theme.colors.textSecondary },
  chips: { flexDirection: 'row', gap: theme.gap(1) },
  notice: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(0.5) },
}));
