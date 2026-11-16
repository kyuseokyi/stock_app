import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { formatChgPct, formatShares, LENDING_NOTE, lendingView, type LendingPoint } from '../lending';
import { fetchLending } from '../lending-rest';

/**
 * 종목 상세 '대차잔고' — 잔고 주수 선 + 일별 증감 막대(점수 추이와 같은 SVG 미니 그래프).
 * 데이터가 없거나(개발 서버 — 키움 키 없음) 불러오기에 실패하면 섹션 전체를 숨긴다.
 * reloadKey 가 바뀌면 다시 불러온다(당겨서 새로고침).
 */
export function LendingSection({ ticker, reloadKey = 0 }: { ticker: string; reloadKey?: number }) {
  const { theme } = useUnistyles();
  const [points, setPoints] = useState<LendingPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLending(ticker)
      .then((rows) => {
        if (!cancelled) setPoints(rows);
      })
      .catch(() => undefined); // 실패면 숨김(또는 이전 값) 그대로
    return () => {
      cancelled = true;
    };
  }, [ticker, reloadKey]);

  const view = useMemo(() => lendingView(points), [points]);
  if (!view) return null;
  const { first, last, chgPct } = view;
  const chgColor = chgPct === null || chgPct === 0 ? theme.colors.text : chgPct > 0 ? theme.colors.up : theme.colors.down;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>대차잔고</Text>
        <Text style={styles.meta}>{last.date} 기준</Text>
      </View>
      <Text style={styles.value}>
        잔고 {formatShares(last.balanceQty)}
        {chgPct !== null ? <Text style={{ color: chgColor }}> {formatChgPct(chgPct)}</Text> : null}
      </Text>
      <Text style={styles.meta}>
        그날 증감 {last.netQty > 0 ? '+' : ''}
        {formatShares(last.netQty)}
      </Text>
      <Svg
        width="100%"
        height={88}
        viewBox={`0 0 ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        accessibilityLabel={`대차잔고 ${first.date} ${formatShares(first.balanceQty)}에서 ${last.date} ${formatShares(last.balanceQty)}`}
      >
        {view.bars.map((b, i) => (
          <Rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.up ? theme.colors.up : theme.colors.down} opacity={0.55} />
        ))}
        <Line x1={0} x2={view.width} y1={view.zeroY} y2={view.zeroY} stroke={theme.colors.border} strokeWidth={0.5} />
        <Polyline points={view.line} fill="none" stroke={theme.colors.primary} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <View style={styles.head}>
        <Text style={styles.meta}>{first.date}</Text>
        <Text style={styles.meta}>선: 잔고 · 막대: 일별 증감</Text>
        <Text style={styles.meta}>{last.date}</Text>
      </View>
      <Text style={styles.meta}>{LENDING_NOTE}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.gap(1) },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  value: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
}));
