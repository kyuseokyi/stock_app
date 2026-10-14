import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Chip } from '@/ui';

import { getDailyCandles, getGameCandles } from '../api';
import { applyTick } from '../lib/candles';
import { layoutCandles, priceToY, type Ohlc } from '../lib/chart-layout';
import { formatPrice, kstDateString } from '../lib/format';
import { applyTickIntraday, axisLabelIndexes, bucketStartSec, CHART_INTERVALS, dayLabel, kstHm } from '../lib/intraday';
import type { ChartInterval, Coach, DailyCandle, IntradayCandle, Position } from '../types';
import { useGameRules } from '../use-game-rules';

// 순수 View 캔들 차트(네이티브 차트 의존성 0). 좌표는 lib/chart-layout 의 순수 함수가 계산한다.
// 색: 상승=빨강(theme up)/하락=파랑(theme down). 지지선 보라·저항선 주황·익절 초록은 고정 상수, 손절은 회색.
const SUPPORT = '#8b5cf6';
const RESIST = '#f59e0b';
const TAKE_PROFIT = '#16a34a'; // 익절 — 초록(손절은 theme textSecondary 회색)
const VISIBLE = 60; // 일봉·분봉 모두 최근 60개만 표시
const LABEL_H = 16;
const PLOT_H = 240;
const AXIS_H = 16; // 아래 시간축 라벨 줄
const AXIS_LABEL_W = 48;

export type PriceLine = { price: number; color: string; label: string; thick?: boolean; dashed?: boolean };

type CandleChartProps = {
  candles: Ohlc[];
  height: number;
  lines?: PriceLine[];
  /** 가격 라벨(범위 최고/최저·가격선 값) 표시. 퀴즈 차트는 false */
  showLabels?: boolean;
  /** 캔들별 시간축 라벨(candles 와 같은 길이). 주면 처음·가운데·끝만 아래 줄에 표시 */
  xLabels?: string[];
};

/** 캔들 + 가격선 렌더러. 폭은 onLayout 으로 측정(측정 전에는 빈 영역). xLabels 를 주면 아래에 시간축 라벨 */
export function CandleChart({ xLabels, ...plot }: CandleChartProps) {
  const [width, setWidth] = useState(0);
  const layout = layoutCandles(plot.candles, width, plot.height, (plot.lines ?? []).map((l) => l.price));
  if (!xLabels) return <CandlePlot {...plot} layout={layout} onWidth={setWidth} />;
  const last = layout !== null ? Math.min(xLabels.length, layout.bars.length) - 1 : -1;
  return (
    <View>
      <CandlePlot {...plot} layout={layout} onWidth={setWidth} />
      <View style={styles.axis} pointerEvents="none">
        {layout !== null
          ? axisLabelIndexes(last + 1).map((i) => {
              // 라벨 중앙을 캔들 중앙에 맞추되 양 끝은 차트 폭 안으로 붙인다
              const left = Math.min(Math.max(0, layout.bars[i].wickLeft - AXIS_LABEL_W / 2), width - AXIS_LABEL_W);
              return (
                <Text key={i} style={[styles.axisLabel, { left }]} numberOfLines={1} allowFontScaling={false}>
                  {xLabels[i]}
                </Text>
              );
            })
          : null}
      </View>
    </View>
  );
}

type CandlePlotProps = Omit<CandleChartProps, 'xLabels'> & {
  layout: ReturnType<typeof layoutCandles>;
  onWidth: (w: number) => void;
};

function CandlePlot({ height, lines = [], showLabels = true, layout, onWidth }: CandlePlotProps) {
  const { theme } = useUnistyles();
  const onLayout = (e: LayoutChangeEvent) => onWidth(e.nativeEvent.layout.width);

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
                {l.dashed ? (
                  <View style={[styles.line, styles.dashed, { top: y - 1, borderColor: l.color }]} />
                ) : (
                  <View style={[styles.line, { top: y - thickness / 2, height: thickness, backgroundColor: l.color }]} />
                )}
                {showLabels ? (
                  <Text
                    style={[styles.lineLabel, { top: y < LABEL_H + 2 ? y + 2 : y - LABEL_H - 2, color: l.color }]}
                    numberOfLines={1}
                    allowFontScaling={false}>
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

/**
 * 게임 차트 — 단위 칩(일·1분·5분·15분·60분) + 캔들 + 지지/저항/진입가/손절/익절 라인.
 * 일봉: stock_api GraphQL + 오늘 캔들 실시간 병합(기존 경로). 분봉: GET /api/game/candles + 현재 버킷 실시간 병합.
 * 초기 단위 = 규칙 chart_interval_default(로드 전/실패 시 일봉). 사용자가 고른 단위는 이 화면 상태로만 유지.
 */
export function DailyChart({ ticker, lastPrice, coach, position }: DailyChartProps) {
  const { theme } = useUnistyles();
  const { rules } = useGameRules();
  const [picked, setPicked] = useState<ChartInterval | null>(null);
  const interval: ChartInterval = picked ?? rules?.chart_interval_default ?? 'day';
  const [daily, setDaily] = useState<DailyCandle[] | null>(null);
  const [intraday, setIntraday] = useState<IntradayCandle[] | null>(null);
  const [failed, setFailed] = useState(false);

  // 1) 캔들 로드(종목·단위가 바뀌면 다시). 늦게 온 이전 단위 응답은 cancelled 로 버린다
  useEffect(() => {
    let cancelled = false;
    setDaily(null);
    setIntraday(null);
    setFailed(false);
    const onFail = () => {
      if (!cancelled) setFailed(true);
    };
    if (interval === 'day') {
      getDailyCandles(ticker)
        .then((rows) => {
          if (!cancelled) setDaily(rows.slice(-VISIBLE));
        })
        .catch(onFail);
    } else {
      getGameCandles(interval)
        .then((rows) => {
          if (!cancelled) setIntraday(rows.slice(-VISIBLE));
        })
        .catch(onFail);
    }
    return () => {
      cancelled = true;
    };
  }, [ticker, interval]);

  // 2) 틱 → 오늘 일봉 / 현재 분봉 버킷에 병합(로드 전 틱은 무시 — web 과 동일)
  useEffect(() => {
    if (lastPrice === null) return;
    if (interval === 'day') {
      setDaily((prev) => (prev === null ? prev : applyTick(prev, kstDateString(), lastPrice).slice(-VISIBLE)));
    } else {
      const bucket = bucketStartSec(Date.now(), interval);
      setIntraday((prev) => (prev === null ? prev : applyTickIntraday(prev, bucket, lastPrice).slice(-VISIBLE)));
    }
  }, [lastPrice, interval]);

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
    if (position.stop_loss_price != null) {
      lines.push({ price: position.stop_loss_price, color: theme.colors.textSecondary, label: '손절', dashed: true });
    }
    if (position.take_profit_price != null) {
      lines.push({ price: position.take_profit_price, color: TAKE_PROFIT, label: '익절', dashed: true });
    }
  }

  const candles: Ohlc[] | null = interval === 'day' ? daily : intraday;
  const xLabels = interval === 'day' ? daily?.map((c) => dayLabel(c.date)) : intraday?.map((c) => kstHm(c.t));
  const empty = candles !== null && candles.length === 0;

  return (
    <View style={styles.frame}>
      <View style={styles.chips}>
        {CHART_INTERVALS.map((it) => (
          <Chip key={it.value} label={it.label} selected={it.value === interval} onPress={() => setPicked(it.value)} />
        ))}
      </View>
      <View style={styles.plotArea}>
        {candles !== null && !empty ? (
          <CandleChart candles={candles} height={PLOT_H} lines={lines} xLabels={xLabels} />
        ) : null}
        {candles === null && !failed ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : null}
        {empty ? (
          <View style={styles.center}>
            <Text style={styles.muted}>분봉은 오늘부터 쌓이고 있어요</Text>
          </View>
        ) : null}
        {failed ? (
          <View style={styles.center}>
            <Text style={styles.muted}>차트 데이터를 불러오지 못했어요</Text>
          </View>
        ) : null}
      </View>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(0.75), marginBottom: theme.gap(1) },
  plotArea: { minHeight: PLOT_H + AXIS_H, position: 'relative' },
  plot: { width: '100%', position: 'relative' },
  axis: { height: AXIS_H, position: 'relative' },
  axisLabel: {
    position: 'absolute',
    top: 2,
    width: AXIS_LABEL_W,
    fontSize: 10,
    textAlign: 'center',
    color: theme.colors.textSecondary,
  },
  abs: { position: 'absolute' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  line: { position: 'absolute', left: 0, right: 0, opacity: 0.9 },
  // 점선 — 높이 0 + 테두리 전체 dashed(iOS 는 변별 두께가 같아야 dashed 렌더) → 위아래 테두리가 겹친 한 줄
  dashed: { height: 0, borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' },
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
