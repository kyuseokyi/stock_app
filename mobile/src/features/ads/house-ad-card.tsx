import { useRouter, type Href } from 'expo-router';
import { memo } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card } from '@/ui';

import { houseAdFor } from './ad-config';
import type { AdConfig, MobileAdSlotKey } from './api';

// 광고 자리 — 지금은 자체 하우스 배너만(명세 §2). BlogCard 와 같은 카드에 오른쪽 위 '광고' 배지(§0-3).
// 그릴 것이 없으면 null(자리도 차지하지 않음). 목록 안에서는 지수 갱신 등으로 화면이 다시 그려져도
// 카드가 다시 그려지지 않게 memo. 금지 구역(§0-1): 게임·종목 상세·차트 WebView 안에는 두지 않는다.
export const HouseAdSlot = memo(function HouseAdSlot({
  config,
  slotKey,
  style,
}: {
  config: AdConfig | null;
  slotKey: MobileAdSlotKey;
  /** 바깥 여백 — 광고가 없으면 카드와 함께 사라지도록 감싸는 View 대신 여기로 받는다 */
  style?: ViewStyle;
}) {
  const router = useRouter();
  const ad = houseAdFor(config, slotKey);
  if (!ad) return null;
  return (
    <Pressable
      onPress={() => router.push(ad.targetPath as Href)}
      accessibilityRole="link"
      accessibilityLabel={`광고: ${ad.title}`}
      style={({ pressed }) => [style, pressed && styles.pressed]}>
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.title} numberOfLines={2}>
            {ad.title}
          </Text>
          <Text style={styles.badge}>광고</Text>
        </View>
        {ad.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {ad.description}
          </Text>
        ) : null}
        <Text style={styles.cta}>바로 가기 ›</Text>
      </Card>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  // 글 카드와 비슷한 높이로 고정해 목록 스크롤이 덜컥거리지 않게(명세 §1-2 minHeight 116)
  card: { minHeight: 116, justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1) },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: theme.colors.text },
  badge: {
    overflow: 'hidden',
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.gap(1),
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  description: { fontSize: 13, lineHeight: 18, color: theme.colors.textSecondary },
  cta: { marginTop: theme.gap(0.5), fontSize: 13, fontWeight: '600', color: theme.colors.primary },
}));
