import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { CalendarSection } from '@/features/market/sections/calendar-section';
import { GroupSection } from '@/features/market/sections/group-section';
import { MarketSection } from '@/features/market/sections/market-section';
import type { GroupKind } from '@/features/market/types';
import { Chip } from '@/ui';

type Tab = 'market' | 'theme' | 'sector' | 'calendar';
const TABS: [Tab, string][] = [['market', '개요'], ['theme', '테마'], ['sector', '업종'], ['calendar', '일정']];

/** 시황 탭 — 예전 스크리너의 '시장' 칩 묶음(개요·테마·업종·일정)을 옮겨 온 화면.
 *  다음 단계(M2)에서 AI 브리핑·지수 캐러셀·트리맵·급등락 등을 스펙 §2.1 ①~⑦ 순서로 이 화면에 끼워 넣는다 */
export default function MarketScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('market');

  const openGroup = (kind: GroupKind, id: string) =>
    router.push({ pathname: '/market/[kind]/[id]', params: { kind, id } });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* ① 헤더 — M2 에서 기준 시각·장운영 뱃지를 이 줄 오른쪽에 붙인다 */}
      <Text style={styles.title}>오늘의 증시</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsBar}>
        {TABS.map(([v, t]) => <Chip key={v} label={t} selected={tab === v} onPress={() => setTab(v)} />)}
      </ScrollView>
      <Text style={styles.notice}>ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</Text>
      {/* 섹션 본문 — MarketSection 의 '더보기'(테마·일정)는 이 화면 안 칩 전환으로 연결 */}
      {tab === 'market' ? <MarketSection onMore={setTab} onOpenGroup={openGroup} /> : null}
      {tab === 'theme' ? <GroupSection key="theme" kind="theme" onOpenGroup={openGroup} /> : null}
      {tab === 'sector' ? <GroupSection key="sector" kind="sector" onOpenGroup={openGroup} /> : null}
      {tab === 'calendar' ? <CalendarSection /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2),
    paddingTop: theme.gap(2),
  },
  chipsBar: { flexGrow: 0 },
  chips: { gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
  notice: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(0.5) },
}));
