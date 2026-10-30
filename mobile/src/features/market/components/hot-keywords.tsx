import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet } from '@/ui';

import type { HotKeyword } from '../rest-types';

/**
 * ⑥ 핫 키워드 — 가로 스크롤 Pill(#키워드). 누르면 바텀시트에 배경 설명·관련 종목(이름을 아는 종목은 이름으로).
 * names: 급등락 목록 등에서 모은 티커 → 종목명
 */
export function HotKeywords({ keywords, names, onOpenStock }: {
  keywords: HotKeyword[];
  names: Map<string, string>;
  onOpenStock: (ticker: string, name: string) => void;
}) {
  const [open, setOpen] = useState<HotKeyword | null>(null);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.pills}>
        {keywords.map((k) => (
          <Pressable key={k.keyword} style={styles.pill} onPress={() => setOpen(k)} accessibilityRole="button" accessibilityHint="배경 보기">
            <Text style={styles.pillText}>#{k.keyword}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {open ? (
        <BottomSheet title={`#${open.keyword}`} onClose={() => setOpen(null)}>
          {open.background ? <Text style={styles.body}>{open.background}</Text> : null}
          {open.tickers.length > 0 ? (
            <>
              <Text style={styles.caption}>관련 종목</Text>
              {open.tickers.map((t) => {
                const name = names.get(t) ?? t;
                return (
                  <Pressable
                    key={t}
                    style={styles.stockRow}
                    onPress={() => {
                      setOpen(null);
                      onOpenStock(t, name);
                    }}
                    accessibilityRole="button"
                    accessibilityHint="종목 상세 보기"
                  >
                    <Text style={styles.stockName}>{name}</Text>
                    <Text style={styles.ticker}>{t} ›</Text>
                  </Pressable>
                );
              })}
            </>
          ) : null}
        </BottomSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: { flexGrow: 0, marginHorizontal: -theme.gap(2) },
  pills: { gap: theme.gap(1), paddingHorizontal: theme.gap(2) },
  pill: {
    backgroundColor: theme.colors.fill, borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(1.5), paddingVertical: theme.gap(0.75),
  },
  pillText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  body: { fontSize: 15, lineHeight: 22, color: theme.colors.text },
  caption: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  stockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  stockName: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  ticker: { fontSize: 13, color: theme.colors.textSecondary },
}));
