import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { BottomSheet } from '@/ui';

import { redFlagBadge, type BadgeTone, type ScreenerAnalysis } from '../ai-analysis';

/**
 * 주도주 카드 하단 AI 영역 — 포착 사유(2줄)·지뢰 뱃지·실적 품질 태그.
 * 영역을 누르면 자세히(실적 품질 메모·지뢰 사유 전체·기준일) 시트를 연다. 분석이 없으면 호출부가 그리지 않는다.
 */
export function AiAnalysisBlock({ analysis }: { analysis: ScreenerAnalysis }) {
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const badge = redFlagBadge(analysis);
  const tone = (t: BadgeTone) =>
    t === 'safe'
      ? { bg: theme.colors.safeSoft, fg: theme.colors.safe }
      : t === 'caution'
        ? { bg: theme.colors.cautionSoft, fg: theme.colors.caution }
        : { bg: theme.colors.dangerSoft, fg: theme.colors.danger };
  const label = ['AI 분석', analysis.hookSummary, badge?.text ?? '', analysis.growthQuality ?? ''].filter(Boolean).join(', ');

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.block, pressed && styles.pressed]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="AI 분석 자세히 보기"
      >
        {analysis.hookSummary ? (
          <View style={styles.hookLine}>
            <View style={styles.aiTag}>
              <Text style={styles.aiTagText}>AI</Text>
            </View>
            <Text style={styles.hook} numberOfLines={2}>{analysis.hookSummary}</Text>
          </View>
        ) : null}
        <View style={styles.tags}>
          {badge ? (
            <View style={[styles.badge, styles.badgeShrink, { backgroundColor: tone(badge.tone).bg }]}>
              <Text style={[styles.badgeText, { color: tone(badge.tone).fg }]} numberOfLines={1}>{badge.text}</Text>
            </View>
          ) : null}
          {analysis.growthQuality ? (
            <View style={[styles.badge, styles.neutral]}>
              <Text style={[styles.badgeText, styles.neutralText]}>{analysis.growthQuality}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <BottomSheet title="AI 분석" onClose={() => setOpen(false)}>
          {analysis.hookSummary ? <Text style={styles.sheetHook}>{analysis.hookSummary}</Text> : null}
          {analysis.growthQuality || analysis.financialQualityNote ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>실적 품질{analysis.growthQuality ? ` · ${analysis.growthQuality}` : ''}</Text>
              {analysis.financialQualityNote ? <Text style={styles.body}>{analysis.financialQualityNote}</Text> : null}
            </View>
          ) : null}
          {badge ? (
            <View style={styles.section}>
              <View style={[styles.badge, styles.selfStart, { backgroundColor: tone(badge.tone).bg }]}>
                <Text style={[styles.badgeText, { color: tone(badge.tone).fg }]}>
                  {analysis.redFlagLevel === 'CLEAN' ? 'CLEAN 안전' : analysis.redFlagLevel}
                </Text>
              </View>
              {analysis.redFlags.length > 0 ? (
                analysis.redFlags.map((f, i) => (
                  <Text key={i} style={styles.body}>· {f}</Text>
                ))
              ) : (
                <Text style={styles.body}>발견된 위험 신호가 없어요</Text>
              )}
            </View>
          ) : null}
          <Text style={styles.caption}>
            {analysis.date ? `${analysis.date} 기준 · ` : ''}AI 분석은 참고용이에요. 투자 권유가 아니에요.
          </Text>
        </BottomSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { gap: theme.gap(0.75), paddingBottom: theme.gap(1.25) },
  pressed: { opacity: 0.6 },
  hookLine: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(0.75) },
  aiTag: {
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, marginTop: 1,
    backgroundColor: theme.colors.primarySoft,
  },
  aiTagText: { fontSize: 10, fontWeight: '800', color: theme.colors.primary },
  hook: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.colors.text },
  tags: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  badge: { borderRadius: theme.radius.chip, paddingHorizontal: theme.gap(1), paddingVertical: 3 },
  badgeShrink: { flexShrink: 1 },
  selfStart: { alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  neutral: { backgroundColor: theme.colors.fill },
  neutralText: { color: theme.colors.textSecondary },
  sheetHook: { fontSize: 16, lineHeight: 23, fontWeight: '600', color: theme.colors.text },
  section: { gap: theme.gap(0.75) },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  body: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
  caption: { fontSize: 12, lineHeight: 17, color: theme.colors.textSecondary },
}));
