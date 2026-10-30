import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

type Props = {
  title: string;
  /** 제목 아래 작은 회색 보조문구(기준 시각·기준일 등) */
  caption?: string | null;
  /** 있으면 오른쪽에 '더 보기' 링크 */
  onMore?: () => void;
  moreLabel?: string;
  /** 오른쪽 자리(onMore 대신 토글 등) */
  right?: ReactNode;
};

/** 섹션 머리글 — 굵은 제목(18) + 보조문구 + 오른쪽 '더 보기'. 시황 대시보드 등 여러 섹션 공용 */
export function SectionHead({ title, caption, onMore, moreLabel = '더 보기', right }: Props) {
  return (
    <View style={styles.head}>
      <View style={styles.titles}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
      {right}
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${title} ${moreLabel}`}>
          <Text style={styles.more}>{moreLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
  titles: { flexShrink: 1, gap: 2 },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  caption: { fontSize: 12, color: theme.colors.textSecondary },
  more: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
