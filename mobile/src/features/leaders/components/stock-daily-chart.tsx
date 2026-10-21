import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { TvChart, type TvChartData } from '@/features/game/components/tv-chart';
import type { ChartColors } from '@/features/game/lib/chart-bridge';

import {
  MA50_COLOR,
  STOCK_CHART_LOOKBACK_DAYS,
  STOCK_CHART_MA,
  STOCK_CHART_VISIBLE_DAYS,
  stockChartLines,
} from '../stock-chart';
import { useDailyCandles } from '../use-daily-candles';

const CHART_H = 260;

/** 종목 상세 일봉 차트 — 캔들 + 50일선 + 52주 고점 점선(볼린저 끔). 실패하면 차트 자리만 "다시 시도" */
export function StockDailyChart({ ticker, high52w }: { ticker: string; high52w: number | null }) {
  const { theme } = useUnistyles();
  const d = useDailyCandles(ticker, STOCK_CHART_LOOKBACK_DAYS);
  const colors = useMemo<ChartColors>(
    () => ({
      up: theme.colors.up,
      down: theme.colors.down,
      text: theme.colors.textSecondary,
      grid: theme.colors.background,
      border: theme.colors.border,
    }),
    [theme.colors.up, theme.colors.down, theme.colors.textSecondary, theme.colors.background, theme.colors.border],
  );
  const lines = useMemo(() => stockChartLines(high52w, theme.colors.textSecondary), [high52w, theme.colors.textSecondary]);
  const view = useMemo<TvChartData | null>(
    () => (d.rows ? { data: { kind: 'day', rows: d.rows }, seq: d.seq, keepView: false } : null),
    [d.rows, d.seq],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: MA50_COLOR }]}>━ 50일선</Text>
        <Text style={styles.legendText}>┄ 52주 고점</Text>
      </View>
      <View>
        <TvChart
          view={view}
          lines={lines}
          ma
          bb={false}
          colors={colors}
          height={CHART_H}
          maPeriods={STOCK_CHART_MA}
          visibleDays={STOCK_CHART_VISIBLE_DAYS}
        />
        {d.loading && !d.rows ? (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator />
          </View>
        ) : null}
        {d.error && !d.rows ? (
          <Pressable style={styles.overlay} onPress={() => void d.reload()} accessibilityRole="button">
            <Text style={styles.error}>차트를 불러오지 못했어요 · 다시 시도</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(0.5) },
  legend: { flexDirection: 'row', gap: theme.gap(1.5) },
  legendText: { fontSize: 11, color: theme.colors.textSecondary },
  overlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface,
  },
  error: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
