import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getDailyCandles } from '../api';
import { applyTick } from '../lib/candles';
import { layoutCandles, priceToY, type Ohlc } from '../lib/chart-layout';
import { formatPrice, kstDateString } from '../lib/format';
import type { Coach, DailyCandle, Position } from '../types';

// 순수 View 캔들 차트(네이티브 차트 의존성 0). 좌표는 lib/chart-layout 의 순수 함수가 계산한다.
// 색: 상승=빨강(theme up)/하락=파랑(theme down). 지지선 보라·저항선 주황은 고정 상수.
const SUPPORT = '#8b5cf6';
const RESIST = '#f59e0b';
const VISIBLE = 60; // 일봉은 최근 60개만 표시
const LABEL_H = 16;

export type PriceLine = { price: number; color: string; label: string; thick?: boolean };

type CandleChartProps = {
  candles: Ohlc[];
  height: number;
  lines?: PriceLine[];
  /** 가격 라벨(범위 최고/최저·가격선 값) 표시. 퀴즈 차트는 false */
  showLabels?: boolean;
};

/** 캔들 + 가격선 렌더러. 폭은 onLayout 으로 측정(측정 전에는 빈 영역) */
export function CandleChart({ candles, height, lines = [], showLabels = true }: CandleChartProps) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const layout = layoutCandles(candles, width, height, lines.map((l) => l.price));

  return (
    <View style={[styles.plot, { height }]} onLayout={onLayout}>
      {layout !== null
        ? layout.bars.map((b, i) => {
            const color = b.rising ? theme.colors.up : theme.colors.down;
            return (
              <View key={i} pointerEvents="none">
                <View
                  style={[styles.abs, { left: b.wickLeft, top: b.wickTop, width: 1, height: b.wickHeight, backgroundColor: color }]}
                />
                <View
                  style={[
                    styles.abs,
                    { left: b.bodyLeft, top: b.bodyTop, width: b.bodyWidth, height: b.bodyHeight, backgroundColor: color },
                  ]}
                />
              </View>
            );
          })
        : null}
      {layout !== null
        ? lines.map((l) => {
            const y = priceToY(l.price, layout.range, height);
            const thickness = l.thick ? 2 : 1;
            return (
              <View key={`${l.label}-${l.price}`} pointerEvents="none" style={styles.fill}>
                <View style={[styles.line, { top: y - thickness / 2, height: thickness, backgroundColor: l.color }]} />
                {showLabels ? (
                  <Text
                    style={[styles.lineLabel, { top: y < LABEL_H + 2 ? y + 2 : y - LABEL_H - 2, color: l.color }]}
                    numberOfLines={1}>
                    {l.label} {formatPrice(l.price)}
                  </Text>
                ) : null}
              </View>
            );
          })
        : null}
      {layout !== null && showLabels ? (
        <>
          <Text style={[styles.rangeLabel, styles.rangeTop]}>{formatPrice(layout.range.max)}</Text>
          <Text style={[styles.rangeLabel, styles.rangeBottom]}>{formatPrice(layout.range.min)}</Text>
        </>
      ) : null}
    </View>
  );
}

type DailyChartProps = {
  ticker: string;
  lastPrice: number | null;
  coach: Coach | null;
  position: Position | null;
};

/** 일봉(stock_api) + 오늘 캔들 실시간 병합(WS tick) + 지지/저항/진입가 라인 */
export function DailyChart({ ticker, lastPrice, coach, position }: DailyChartProps) {
  const { theme } = useUnistyles();
  const [candles, setCandles] = useState<DailyCandle[] | null>(null);
  const [failed, setFailed] = useState(false);

  // 1) 일봉 로드(종목이 바뀌면 다시)
  useEffect(() => {
    let cancelled = false;
    setCandles(null);
    setFailed(false);
    getDailyCandles(ticker)
      .then((rows) => {
        if (!cancelled) setCandles(rows.slice(-VISIBLE));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // 2) 틱 → 오늘 캔들 병합(로드 전 틱은 무시 — web 과 동일)
  useEffect(() => {
    if (lastPrice === null) return;
    setCandles((prev) => (prev === null ? prev : applyTick(prev, kstDateString(), lastPrice).slice(-VISIBLE)));
  }, [lastPrice]);

  const lines: PriceLine[] = [];
  if (coach?.support_price != null) lines.push({ price: coach.support_price, color: SUPPORT, label: '지지' });
  if (coach?.resistance_price != null) lines.push({ price: coach.resistance_price, color: RESIST, label: '저항' });
  if (position) {
    lines.push({
      price: position.entry_price,
      color: position.side === 'LONG' ? theme.colors.up : theme.colors.down,
      label: '진입',
      thick: true,
    });
  }

  return (
    <View style={styles.frame}>
      {candles !== null ? <CandleChart candles={candles} height={240} lines={lines} /> : null}
      {candles === null && !failed ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.muted}>차트 데이터를 불러오지 못했어요</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    minHeight: 260,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    paddingVertical: theme.gap(1.25),
    paddingHorizontal: theme.gap(1),
    overflow: 'hidden',
  },
  plot: { width: '100%', position: 'relative' },
  abs: { position: 'absolute' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  line: { position: 'absolute', left: 0, right: 0, opacity: 0.9 },
  lineLabel: {
    position: 'absolute',
    right: 4,
    height: LABEL_H,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 4,
  },
  rangeLabel: {
    position: 'absolute',
    left: 4,
    fontSize: 10,
    color: theme.colors.textSecondary,
    backgroundColor: theme.colors.background, // 범위 끝에 걸친 가격선 위에서도 읽히게
    paddingHorizontal: 2,
  },
  rangeTop: { top: 0 },
  rangeBottom: { bottom: 0 },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
}));
