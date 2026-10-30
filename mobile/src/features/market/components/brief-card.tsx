import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet } from '@/ui';

import { formatShortDate } from '../dashboard';
import type { MorningBrief, SectorNote } from '../rest-types';

/** ② AI 장전 브리핑 카드(surfaceBlue 배너) — 헤드라인만 보이고, 누르면 바텀시트로 수혜·주의 섹터·체크포인트·요약 */
export function BriefCard({ brief }: { brief: MorningBrief }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        style={styles.card}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`AI 장전 브리핑 ${formatShortDate(brief.date)}, ${brief.headline}`}
        accessibilityHint="자세히 보기"
      >
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>AI 장전 브리핑 (08:30)</Text>
          {brief.date ? <Text style={styles.date}>{formatShortDate(brief.date)}</Text> : null}
        </View>
        <Text style={styles.headline}>{brief.headline}</Text>
        <Text style={styles.more}>수혜·주의 섹터 보기 ›</Text>
      </Pressable>
      {open ? (
        <BottomSheet title="AI 장전 브리핑" onClose={() => setOpen(false)}>
          <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetBody}>
            <Text style={styles.sheetHeadline}>{brief.headline}</Text>
            <Sectors title="수혜 예상 섹터" items={brief.bullishSectors} tone="up" />
            <Sectors title="주의 섹터" items={brief.bearishSectors} tone="down" />
            {brief.macroCheckpoints.length > 0 ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>환율·금리 체크포인트</Text>
                {brief.macroCheckpoints.map((c, i) => (
                  <Text key={`${i}-${c}`} style={styles.body}>· {c}</Text>
                ))}
              </View>
            ) : null}
            {brief.usMarketSummary ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>밤사이 미국 증시</Text>
                <Text style={styles.body}>{brief.usMarketSummary}</Text>
              </View>
            ) : null}
            {brief.krImpactSummary ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>오늘 국내 증시 영향</Text>
                <Text style={styles.body}>{brief.krImpactSummary}</Text>
              </View>
            ) : null}
            <Text style={styles.note}>AI 가 뉴스·지표로 만든 요약이에요. 투자 권유가 아니에요.</Text>
          </ScrollView>
        </BottomSheet>
      ) : null}
    </>
  );
}

function Sectors({ title, items, tone }: { title: string; items: SectorNote[]; tone: 'up' | 'down' }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      {items.map((s) => (
        <View key={s.sector} style={styles.sectorRow}>
          <Text style={[styles.sector, tone === 'up' ? styles.sectorUp : styles.sectorDown]}>{s.sector}</Text>
          {s.reason ? <Text style={styles.reason}>{s.reason}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surfaceBlue, borderRadius: theme.radius.card, padding: theme.gap(2.5), gap: theme.gap(1) },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  badge: {
    fontSize: 12, fontWeight: '700', color: theme.colors.primary, backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.chip, paddingHorizontal: theme.gap(1), paddingVertical: 3, overflow: 'hidden',
  },
  date: { fontSize: 12, color: theme.colors.textSecondary },
  headline: { fontSize: 17, fontWeight: '700', lineHeight: 24, color: theme.colors.text },
  more: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
  sheet: { maxHeight: 480 },
  sheetBody: { gap: theme.gap(2.5), paddingBottom: theme.gap(1) },
  sheetHeadline: { fontSize: 17, fontWeight: '700', lineHeight: 24, color: theme.colors.text },
  block: { gap: theme.gap(1) },
  blockTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  sectorRow: { gap: 2 },
  sector: { fontSize: 15, fontWeight: '700' },
  sectorUp: { color: theme.colors.up },
  sectorDown: { color: theme.colors.down },
  reason: { fontSize: 14, lineHeight: 20, color: theme.colors.textSecondary },
  body: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  note: { fontSize: 12, color: theme.colors.textSecondary },
}));
