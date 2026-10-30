import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { CalendarSection } from '@/features/market/sections/calendar-section';
import { GroupSection } from '@/features/market/sections/group-section';
import type { MarketSession } from '@/features/market/dashboard';
import { MarketSection } from '@/features/market/sections/market-section';
import type { GroupKind } from '@/features/market/types';
import { Chip } from '@/ui';

type Tab = 'market' | 'theme' | 'sector' | 'calendar';
const TABS: [Tab, string][] = [['market', '개요'], ['theme', '테마'], ['sector', '업종'], ['calendar', '일정']];

/** 시황 탭 — 개요(대시보드: AI 브리핑·지수 캐러셀·히트맵·급등락·수급·핫 키워드·일정, 스펙 §2.1 ①~⑦)와
 *  테마·업종·일정 전체 랭킹 칩. ① 헤더의 기준 시각·장운영 뱃지는 개요 칩이 데이터를 받아 올려 준다 */
export default function MarketScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('market');
  const [header, setHeader] = useState<{ basis: string | null; session: MarketSession | null }>({ basis: null, session: null });
  const onHeader = useCallback(
    (basis: string | null, session: MarketSession | null) =>
      setHeader((h) => (h.basis === basis && h.session === session ? h : { basis, session })),
    [],
  );

  const openGroup = (kind: GroupKind, id: string) =>
    router.push({ pathname: '/market/[kind]/[id]', params: { kind, id } });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* ① 헤더 — 타이틀 + (개요 칩일 때) 장운영 뱃지·기준 시각 */}
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">오늘의 증시</Text>
        {tab === 'market' && (header.session || header.basis) ? (
          <View style={styles.status}>
            {header.session ? (
              <Text style={[styles.session, header.session === '정규장' && styles.sessionOpen]}>{header.session}</Text>
            ) : null}
            {header.basis ? <Text style={styles.basis}>{header.basis}</Text> : null}
          </View>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsBar}>
        {TABS.map(([v, t]) => <Chip key={v} label={t} selected={tab === v} onPress={() => setTab(v)} />)}
      </ScrollView>
      <Text style={styles.notice}>ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</Text>
      {/* 섹션 본문 — MarketSection 의 '더보기'(테마·일정)는 이 화면 안 칩 전환으로 연결 */}
      {tab === 'market' ? <MarketSection onMore={setTab} onOpenGroup={openGroup} onHeader={onHeader} /> : null}
      {tab === 'theme' ? <GroupSection key="theme" kind="theme" onOpenGroup={openGroup} /> : null}
      {tab === 'sector' ? <GroupSection key="sector" kind="sector" onOpenGroup={openGroup} /> : null}
      {tab === 'calendar' ? <CalendarSection /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    paddingTop: theme.gap(2),
  },
  title: { fontSize: 24, fontWeight: '700', color: theme.colors.text },
  status: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  session: {
    fontSize: 11, fontWeight: '700', color: theme.colors.textSecondary, backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.chip, paddingHorizontal: theme.gap(1), paddingVertical: 2, overflow: 'hidden',
  },
  sessionOpen: { color: theme.colors.up, backgroundColor: theme.colors.upSoft },
  basis: { fontSize: 12, color: theme.colors.textSecondary },
  chipsBar: { flexGrow: 0 },
  chips: { gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
  notice: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(0.5) },
}));
