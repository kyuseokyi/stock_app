import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, formatIndex } from '@/features/market/format';
import { fetchPatternsNearPivot } from '@/features/patterns/api';
import { patternLabel } from '@/features/patterns/patterns';
import { Card } from '@/ui';

import { fetchCanslimAbove } from '../api';
import { PICK_COUNT, PICK_MIN_SCORE, PICK_PIVOT_MAX, PICK_PIVOT_MIN, pickToday, type TodayPick } from '../today-picks';

type State = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; date: string | null; picks: TodayPick[] };

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 주도주 칩 맨 위 결론 카드 — 900여 행 목록 대신 '오늘 볼 10개'로 끝나게(웹 TodayPicks 와 같은 규칙·문구).
 *  목록 필터와 무관하게 전체 시장 기준. 불러오지 못하면 카드를 숨긴다(아래 목록은 따로 동작). */
export function TodayPicks({ onOpenStock }: { onOpenStock: (ticker: string, name: string) => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCanslimAbove(PICK_MIN_SCORE), fetchPatternsNearPivot(Math.max(-PICK_PIVOT_MIN, PICK_PIVOT_MAX))])
      .then(([c, p]) => {
        if (!cancelled) setState({ kind: 'ready', date: c.date, picks: pickToday(c.items, p) });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'failed') return null;
  if (state.kind === 'loading') {
    return (
      <Card style={styles.loading}>
        <ActivityIndicator accessibilityLabel="오늘 볼 종목을 고르고 있어요" />
      </Card>
    );
  }
  const { date, picks } = state;
  if (date === null) return null; // 분석 데이터 준비 전 — 아래 목록이 안내한다

  return (
    <Card>
      <Text style={styles.title} accessibilityRole="header">
        {picks.length >= PICK_COUNT ? `오늘 볼 ${PICK_COUNT}개` : '오늘 볼 종목'}
      </Text>
      <Text style={styles.sub}>
        {shortDate(date)} 종가 기준 · 주도주 {PICK_MIN_SCORE}점 이상, 피벗 {PICK_PIVOT_MIN}%~+{PICK_PIVOT_MAX}% 안에서 점수 높은 순
      </Text>
      {picks.length === 0 ? (
        <Text style={styles.empty}>오늘은 조건에 맞는 종목이 없어요</Text>
      ) : (
        picks.map((p, i) => {
          const today = p.pattern.daysSinceBreakout === 1; // 서버 '오늘 돌파' 리포트와 같은 기준
          const pattern = patternLabel(p.pattern.patternType);
          const dist = p.pattern.pivotDistPct === null ? '–' : formatChg(p.pattern.pivotDistPct);
          return (
            <Pressable
              key={p.ticker}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}
              onPress={() => onOpenStock(p.ticker, p.name)}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1}위 ${p.name}${today ? ', 오늘 돌파' : ''}, ${p.score}점, ${pattern}, 피벗까지 ${dist}, 종가 ${formatIndex(p.close)}원`}
              accessibilityHint="종목 상세 보기"
            >
              <Text style={styles.rank}>{i + 1}</Text>
              <View style={styles.body}>
                <View style={styles.line}>
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  {today ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>오늘 돌파</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {p.score}점 · {pattern} · 피벗까지 {dist}
                </Text>
              </View>
              <Text style={styles.price}>{formatIndex(p.close)}</Text>
            </Pressable>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  sub: { fontSize: 13, lineHeight: 18, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
  empty: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: theme.gap(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), minHeight: 52, paddingVertical: theme.gap(1) },
  rowLine: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  pressed: { opacity: 0.6 },
  rank: { width: 20, textAlign: 'center', fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  badge: { borderRadius: theme.radius.chip, backgroundColor: theme.colors.upSoft, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600', color: theme.colors.up },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  price: { fontSize: 14, fontWeight: '600', color: theme.colors.text, fontVariant: ['tabular-nums'] },
}));
