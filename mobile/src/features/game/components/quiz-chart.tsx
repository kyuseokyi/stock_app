import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { sma } from '../lib/indicators';
import { volumeHeights } from '../lib/quiz';
import type { QuizCandle } from '../types';
import { CandleChart, type Overlay } from './candle-chart';

// 퀴즈 차트 — 캔들 + 5·20일 이동평균선 + 아래 거래량 막대. future(정답 공개 후 이후 봉)는 옅게 이어 붙인다.
// (web QuizMiniChart 와 같은 구성·색)
export const QUIZ_MA_COLORS = { 5: '#14b8a6', 20: '#f97316' } as const;
const VOLUME_H = 32;
const NO_FUTURE: QuizCandle[] = []; // 기본값을 상수로 — 렌더마다 새 배열이면 useMemo 가 매번 다시 계산

export function QuizChart({
  candles,
  future = NO_FUTURE,
  height,
}: {
  candles: QuizCandle[];
  future?: QuizCandle[];
  height: number;
}) {
  const { theme } = useUnistyles();
  const all = useMemo(() => [...candles, ...future], [candles, future]);
  const overlays = useMemo<Overlay[]>(() => {
    const closes = all.map((c) => c.close);
    return ([5, 20] as const).map((p) => ({ key: `ma${p}`, color: QUIZ_MA_COLORS[p], values: sma(closes, p) }));
  }, [all]);
  const bars = useMemo(() => volumeHeights(all.map((c) => c.volume), VOLUME_H), [all]);
  const hasVolume = bars.some((h) => h > 0);

  return (
    <View>
      <CandleChart
        candles={all}
        height={height}
        showLabels={false}
        overlays={overlays}
        fadeFrom={future.length > 0 ? candles.length : undefined}
      />
      {hasVolume ? (
        <View style={styles.volume} pointerEvents="none">
          {bars.map((h, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: h,
                  backgroundColor: all[i].close >= all[i].open ? theme.colors.up : theme.colors.down,
                  opacity: i >= candles.length ? 0.2 : 0.4,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
      <Text style={styles.legend}>
        <Text style={{ color: QUIZ_MA_COLORS[5] }}>━ 5일선 </Text>
        <Text style={{ color: QUIZ_MA_COLORS[20] }}>━ 20일선</Text>
        {hasVolume ? ' · 아래 막대 = 거래량' : ''}
        {future.length > 0 ? ' · 옅은 봉 = 이후 5거래일' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  volume: { height: VOLUME_H, flexDirection: 'row', alignItems: 'flex-end', gap: 1, marginTop: theme.gap(0.5) },
  bar: { flex: 1, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  legend: { marginTop: theme.gap(0.5), fontSize: 11, color: theme.colors.textSecondary },
}));
