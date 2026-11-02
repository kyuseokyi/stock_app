import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { FinderSection } from '@/features/finder/sections/finder-section';
import { LeadersSection } from '@/features/leaders/sections/leaders-section';
import { PatternsSection } from '@/features/patterns/sections/patterns-section';
import { StaleNotice } from '@/features/market/components/stale-notice';
import { useScreenerFeaturesState } from '@/features/screener/use-screener-features';
import { screenerChipVisible, screenerEntry, type ScreenerTab } from '@/features/screener/visibility';
import { Chip } from '@/ui';

type Tab = ScreenerTab;
// 시장 묶음(개요·테마·업종·일정)은 마켓 탭으로 옮겨 갔다 — 여기는 '종목 찾기'만
// 종목 찾기 전체는 관리자 스위치 STOCK_FINDER, 조건검색·패턴은 각자 스위치(관리자 > 스크리너 설정)가 켜졌을 때만 보인다
const TABS: [Tab, string][] = [['leaders', '주도주'], ['finder', '조건검색'], ['patterns', '패턴']];

/** 스크리너 탭 — 주도주·조건검색·패턴(웹 순서와 같음). 칩이 하나뿐이면(스위치 모두 꺼짐) 칩 줄을 숨긴다 */
export default function ScreenerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('leaders');
  const features = useScreenerFeaturesState();
  const visible = (t: Tab) => screenerChipVisible(features, t);
  const tabs = TABS.filter(([v]) => visible(v));
  // 보고 있던 탭이 관리자 스위치로 꺼지면 주도주로
  const current: Tab = visible(tab) ? tab : 'leaders';

  const openStock = (ticker: string, name: string) =>
    router.push({ pathname: '/stock/[ticker]', params: { ticker, name } });

  // 종목 찾기가 꺼져 있으면(탭은 숨겨짐) 딥링크·돌아가기로 들어와도 마켓으로. 답을 받기 전엔 빈 화면으로 기다린다
  const entry = screenerEntry(features);
  if (entry === 'redirect') return <Redirect href="/market" />;
  if (entry === 'wait') return <View style={[styles.screen, { paddingTop: insets.top }]} />;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {tabs.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsBar}>
          {tabs.map(([v, t]) => <Chip key={v} label={t} selected={current === v} onPress={() => setTab(v)} />)}
        </ScrollView>
      ) : (
        <View style={styles.chipsGap} />
      )}
      <StaleNotice />
      {current === 'leaders' ? <LeadersSection onOpenStock={openStock} /> : null}
      {current === 'finder' ? <FinderSection onOpenStock={openStock} /> : null}
      {current === 'patterns' ? <PatternsSection onOpenStock={openStock} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  chipsBar: { flexGrow: 0, flexShrink: 0 }, // ScrollView 기본 flexShrink:1 — 아래 본문이 길면 칩 줄이 눌려 글자가 잘렸다
  chips: { gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
  chipsGap: { height: theme.gap(1.5) }, // 칩 줄이 숨겨졌을 때 안내 문구가 상단에 붙지 않게
}));
