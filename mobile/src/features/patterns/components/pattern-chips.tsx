import { ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Chip } from '@/ui';

import { PATTERN_TYPES, REPORTS, reportDescription } from '../patterns';
import type { PatternQuery, PatternReport, PatternType } from '../types';

/** 리포트 칩(하나 선택) + 패턴 칩(하나만, 다시 누르면 전체) 가로 스크롤 + 고른 리포트 설명 한 줄 */
export function PatternChips({
  value,
  onReport,
  onPattern,
}: {
  value: PatternQuery;
  onReport: (r: PatternReport) => void;
  onPattern: (t: PatternType) => void;
}) {
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {REPORTS.map((r) => (
          <Chip key={r.key} label={r.label} selected={value.report === r.key} onPress={() => onReport(r.key)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {PATTERN_TYPES.map((p) => (
          <Chip key={p.key} label={p.label} selected={value.patternType === p.key} onPress={() => onPattern(p.key)} />
        ))}
      </ScrollView>
      <Text style={styles.desc} numberOfLines={2}>{reportDescription(value.report)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(0.75), paddingBottom: theme.gap(1) },
  chips: { gap: theme.gap(1), paddingHorizontal: theme.gap(2) },
  desc: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2) },
}));
