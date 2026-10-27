import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { ActivityIndicator, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';


import { getDailyCandles, getDailyCandlesBefore, getGameCandles, getSessionBar } from '../api';
import { applyTick, withSessionBar } from '../lib/candles';
import { CHART_PREFS_KEY, DEFAULT_CHART_PREFS, parseChartPrefs, serializeChartPrefs } from '../lib/chart-prefs';
import { layoutCandles, niceTicks, priceToY, type Ohlc } from '../lib/chart-layout';
import { lastIndicatorValues, mergeOlder, priceLines, toBars, type ChartColors, type ChartLine } from '../lib/chart-bridge';
import { pickSrLevels, srAxisTitle, srCandidates, srName, srSignature, type SrLevel } from '../lib/sr-levels';
import { formatPrice, kstDateString } from '../lib/format';
import { lineSegments, MA_PERIODS } from '../lib/indicators';
import { applyTickIntraday, axisLabelIndexes, bucketStartSec, CHART_INTERVALS, dayLabel, kstHm } from '../lib/intraday';
import type { ChartInterval, Coach, DailyCandle, IntradayCandle, Position } from '../types';
import { useTradingGameStore } from '../store';
import { useGameRules } from '../use-game-rules';
import { TvChart, type TvChartData } from './tv-chart';

// CandleChart: 순수 View 캔들 차트(퀴즈 차트용). 좌표는 lib/chart-layout 의 순수 함수가 계산한다.
// DailyChart(게임 차트): 웹과 같은 lightweight-charts 를 WebView 로(tv-chart). 이 파일은 데이터·캐시·틱만 맡는다.
// 색: 상승=빨강(theme up)/하락=파랑(theme down).
const LABEL_H = 16;
const TAG_H = 18; // 현재가 태그 높이
const PRICE_AXIS_W = 54; // 오른쪽 가격축 폭("400,000" 이 들어가는 폭)
const AXIS_H = 16; // 아래 시간축 라벨 줄
const AXIS_LABEL_W = 48;
// 보조지표 색(web TradingChart 와 같은 값) — 이동평균 5·20·60, 볼린저밴드
const MA_COLORS: Record<(typeof MA_PERIODS)[number], string> = { 5: '#14b8a6', 20: '#f97316', 60: '#a16207' };

/** tag: 웹 차트 가격축 태그처럼 오른쪽 끝에 색 채운 박스로 가격만 표시(현재가용) */
export type PriceLine = { price: number; color: string; label: string; thick?: boolean; dashed?: boolean; tag?: boolean };
/** 캔들 위 꺾은선(보조지표). values 는 candles 와 같은 길이, null 구간은 끊김 */
export type Overlay = { key: string; color: string; values: (number | null)[]; faint?: boolean };

type CandleChartProps = {
  candles: Ohlc[];
  height: number;
  lines?: PriceLine[];
  overlays?: Overlay[];
  /** 가격 라벨(범위 최고/최저·가격선 값) 표시. 퀴즈 차트는 false */
  showLabels?: boolean;
  /** 캔들별 시간축 라벨(candles 와 같은 길이). 주면 처음·가운데·끝만 아래 줄에 표시 */
  xLabels?: string[];
  /** 오른쪽 가격축(웹 차트처럼 눈금 값 + 현재가 태그). 게임 차트만 true, 퀴즈 차트는 기존(왼쪽 최고/최저) */
  priceAxis?: boolean;
  /** 이 순번부터의 캔들을 옅게(퀴즈 정답 공개 후 이후 봉) */
  fadeFrom?: number;
};

/** 캔들 + 가격선 렌더러. 폭은 onLayout 으로 측정(측정 전에는 빈 영역). xLabels 를 주면 아래에 시간축 라벨 */
export function CandleChart({ xLabels, ...plot }: CandleChartProps) {
  const [width, setWidth] = useState(0);
  // 가격 범위에 가격선 + 지표 값도 포함(선이 차트 밖으로 나가지 않게)
  const extra = [...(plot.lines ?? []).map((l) => l.price), ...(plot.overlays ?? []).flatMap((o) => o.values)];
  const axisW = plot.priceAxis ? PRICE_AXIS_W : 0; // 캔들은 축 왼쪽 영역에만
  const layout = layoutCandles(plot.candles, Math.max(0, width - axisW), plot.height, extra);
  if (!xLabels) return <CandlePlot {...plot} layout={layout} onWidth={setWidth} />;
  const last = layout !== null ? Math.min(xLabels.length, layout.bars.length) - 1 : -1;
  return (
    <View>
      <CandlePlot {...plot} layout={layout} onWidth={setWidth} />
      <View style={styles.axis} pointerEvents="none">
        {layout !== null
          ? axisLabelIndexes(last + 1).map((i) => {
              // 라벨 중앙을 캔들 중앙에 맞추되 양 끝은 차트 폭 안으로 붙인다
              const left = Math.min(Math.max(0, layout.bars[i].wickLeft - AXIS_LABEL_W / 2), width - axisW - AXIS_LABEL_W);
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

function CandlePlot({
  height,
  lines = [],
  overlays = [],
  showLabels = true,
  priceAxis = false,
  fadeFrom,
  layout,
  onWidth,
}: CandlePlotProps) {
  const { theme } = useUnistyles();
  const onLayout = (e: LayoutChangeEvent) => onWidth(e.nativeEvent.layout.width);
  const axisW = priceAxis ? PRICE_AXIS_W : 0;
  // 오른쪽 가격축 눈금(위아래 끝에 걸쳐 잘리는 값은 생략)
  const ticks =
    priceAxis && layout !== null
      ? niceTicks(layout.range.min, layout.range.max)
          .map((p) => ({ p, y: priceToY(p, layout.range, height) }))
          .filter((t) => t.y >= 6 && t.y <= height - 6)
      : [];

  return (
    <View style={[styles.plot, { height }]} onLayout={onLayout}>
      {priceAxis ? (
        <>
          {ticks.map((t) => (
            <View key={`g${t.p}`} pointerEvents="none" style={[styles.gridLine, { top: t.y, right: axisW }]} />
          ))}
          <View pointerEvents="none" style={[styles.axisBorder, { right: axisW }]} />
          {ticks.map((t) => (
            <Text
              key={`t${t.p}`}
              style={[styles.axisTick, { top: t.y - 7, width: axisW }]}
              numberOfLines={1}
              allowFontScaling={false}>
              {formatPrice(t.p)}
            </Text>
          ))}
        </>
      ) : null}
      {layout !== null
        ? layout.bars.map((b, i) => {
            const color = b.rising ? theme.colors.up : theme.colors.down;
            return (
              <View key={i} pointerEvents="none" style={fadeFrom !== undefined && i >= fadeFrom ? styles.faded : null}>
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
        ? overlays.map((o) => (
            <View key={o.key} pointerEvents="none" style={[styles.fill, o.faint ? styles.faint : null]}>
              {lineSegments(
                layout.bars.map((b, i) => {
                  const v = o.values[i];
                  return v == null ? null : { x: b.wickLeft + 0.5, y: priceToY(v, layout.range, height) };
                }),
              ).map((s, i) => (
                <View
                  key={i}
                  style={[
                    styles.abs,
                    styles.segment,
                    { left: s.left, top: s.top, width: s.width, backgroundColor: o.color, transform: [{ rotate: `${s.angleDeg}deg` }] },
                  ]}
                />
              ))}
            </View>
          ))
        : null}
      {layout !== null
        ? lines.map((l) => {
            const y = priceToY(l.price, layout.range, height);
            const thickness = l.thick ? 2 : 1;
            return (
              <View key={`${l.label}-${l.price}`} pointerEvents="none" style={styles.fill}>
                {l.dashed ? (
                  <View style={[styles.line, styles.dashed, { top: y - 1, right: axisW, borderColor: l.color }]} />
                ) : (
                  <View style={[styles.line, { top: y - thickness / 2, right: axisW, height: thickness, backgroundColor: l.color }]} />
                )}
                {showLabels && l.tag ? (
                  <Text
                    style={[
                      styles.priceTag,
                      { top: Math.min(Math.max(0, y - TAG_H / 2), height - TAG_H), backgroundColor: l.color },
                      priceAxis ? { width: axisW, paddingHorizontal: 0, textAlign: 'center', borderRadius: 2 } : null,
                    ]}
                    numberOfLines={1}
                    allowFontScaling={false}>
                    {formatPrice(l.price)}
                  </Text>
                ) : showLabels ? (
                  <Text
                    style={[styles.lineLabel, { top: y < LABEL_H + 2 ? y + 2 : y - LABEL_H - 2, right: axisW + 4, color: l.color }]}
                    numberOfLines={1}
                    allowFontScaling={false}>
                    {l.label} {formatPrice(l.price)}
                  </Text>
                ) : null}
              </View>
            );
          })
        : null}
      {layout !== null && showLabels && !priceAxis ? (
        <>
          <Text style={[styles.rangeLabel, styles.rangeTop]}>{formatPrice(layout.range.max)}</Text>
          <Text style={[styles.rangeLabel, styles.rangeBottom]}>{formatPrice(layout.range.min)}</Text>
        </>
      ) : null}
    </View>
  );
}

/** 차트 전용 작은 칩(공용 Chip 보다 낮고 글씨 작게) — 단위·지표·최신 버튼 */
function MiniChip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.miniChip, selected && styles.miniChipOn]}>
      <Text style={[styles.miniLabel, selected && styles.miniLabelOn]} allowFontScaling={false}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- 단위별 캔들 캐시(전환 지연 줄이기)
type Series =
  | { kind: 'day'; ticker: string; interval: ChartInterval; rows: DailyCandle[] }
  | { kind: 'min'; ticker: string; interval: ChartInterval; rows: IntradayCandle[] };

/** 단위별 마지막 응답 — 앱이 켜져 있는 동안 유지(탭 이동 후에도). 다시 고르면 즉시 표시 후 뒤에서 갱신 */
const seriesCache = new Map<string, Series>();
const cacheKey = (ticker: string, interval: ChartInterval) => `${ticker}|${interval}`;
const sameSeries = (s: Series, ticker: string, interval: ChartInterval) => s.ticker === ticker && s.interval === interval;
const PREFETCH_DELAY_MS = 1500; // 첫 화면을 그린 뒤 나머지 단위를 미리 받기 시작
const CHART_H = 260; // 웹 TradingChart 모바일 폭 높이(h-[260px])와 같게

async function fetchSeries(ticker: string, interval: ChartInterval): Promise<Series> {
  if (interval === 'day') {
    // 오늘 봉은 분봉으로 만든 서버 값으로(일봉은 20:30 수집 전엔 오늘 행이 없음) — 재조회해도 틱 병합 봉이 사라지지 않게.
    // 당일 봉 조회 실패는 무시(일봉만 표시)
    const [rows, session] = await Promise.all([getDailyCandles(ticker), getSessionBar().catch(() => null)]);
    return {
      kind: 'day', ticker, interval,
      rows: session && session.ticker === ticker ? withSessionBar(rows, session.bar) : rows,
    };
  }
  return { kind: 'min', ticker, interval, rows: await getGameCandles(interval) };
}

/** 화면에 그리는 캔들 + 전체 로드 번호(seq). 틱은 seq 를 유지한 채 series 만 바꾼다(→ WebView 에 tick). prepended = 앞에 붙인 과거 수 */
type ShownSeries = { series: Series; seq: number; keepView: boolean; prepended?: number };

/** 다시 받은 일봉(최근 구간)에 지금 화면의 과거 캔들(왼쪽 스크롤로 붙인 것)을 이어 붙인다 — 같은 종목 일봉일 때만 */
const keepOlder = (next: Series, prev: ShownSeries | null): Series =>
  next.kind === 'day' && prev?.series.kind === 'day' && prev.series.ticker === next.ticker && next.rows.length > 0
    ? { ...next, rows: mergeOlder(prev.series.rows, next.rows) }
    : next;
let loadSeq = 0;

type DailyChartProps = {
  ticker: string;
  lastPrice: number | null;
  coach: Coach | null;
  position: Position | null;
  /** 차트에 그린 지지·저항 목록(바뀔 때만) — 게임 화면이 터치·돌파 감지에 쓴다 */
  onSrLevels?: (levels: SrLevel[]) => void;
};

/**
 * 게임 차트 — 단위 칩(일·1분·5분·15분·60분) + lightweight-charts(웹과 같은 엔진, WebView) 캔들 + 지지/저항/진입가/손절/익절 라인.
 * 일봉: stock_api GraphQL + 오늘 캔들 실시간 병합. 분봉: GET /api/game/candles + 현재 버킷 실시간 병합.
 * 초기 단위 = 저장값 > 규칙 chart_interval_default > 일봉.
 */
export function DailyChart({ ticker, lastPrice, coach, position, onSrLevels }: DailyChartProps) {
  const { theme } = useUnistyles();
  const { rules } = useGameRules();
  const [picked, setPicked] = useState<ChartInterval | null>(null);
  const interval: ChartInterval = picked ?? rules?.chart_interval_default ?? 'day';
  const [showMa, setShowMa] = useState(DEFAULT_CHART_PREFS.ma);
  const [showBb, setShowBb] = useState(DEFAULT_CHART_PREFS.bb);
  const [showVp, setShowVp] = useState(DEFAULT_CHART_PREFS.vp);

  // 0) 마지막 설정(단위·지표)을 기기에서 복원 — 읽기 전에는 캔들을 로드하지 않아 기본값→저장값 이중 로드를 막는다.
  // SecureStore 미지원(web)·실패면 기본값(저장값 > 관리자 기본 단위 > 일봉)
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(CHART_PREFS_KEY)
      .then(parseChartPrefs)
      .catch(() => DEFAULT_CHART_PREFS)
      .then((p) => {
        if (cancelled) return;
        setPicked(p.interval);
        setShowMa(p.ma);
        setShowBb(p.bb);
        setShowVp(p.vp);
        setPrefsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!prefsReady) return;
    SecureStore.setItemAsync(CHART_PREFS_KEY, serializeChartPrefs({ interval: picked, ma: showMa, bb: showBb, vp: showVp })).catch(
      () => undefined,
    );
  }, [prefsReady, picked, showMa, showBb, showVp]);
  // 화면에 그리는 캔들 묶음(어느 종목·단위의 데이터인지 함께) — 단위를 바꾸면 새 데이터가 올 때까지 이전 것을 흐리게 유지
  const [shown, setShown] = useState<ShownSeries | null>(null);
  const shownRef = useRef<ShownSeries | null>(null); // 틱 병합이 최신 값을 읽도록(상태 갱신 함수 안 부수효과 방지)
  const show = (v: ShownSeries) => {
    shownRef.current = v;
    setShown(v);
  };
  const [failed, setFailed] = useState(false);
  const [chartReady, setChartReady] = useState(false); // WebView 차트 페이지 준비 전엔 로딩 표시
  const [indOpen, setIndOpen] = useState(false); // 지표 팝오버
  const [chipsBottom, setChipsBottom] = useState(40); // 칩 줄 아래 y — 팝오버 위치

  // 1) 캔들 로드(종목·단위가 바뀌면). 캐시가 있으면 즉시 보여 주고 뒤에서 최신으로 갱신(stale-while-revalidate).
  // 캐시가 없으면 새 데이터가 올 때까지 이전 차트를 흐리게 유지. 늦게 온 응답도 캐시에는 넣고 화면은 cancelled 로 막는다.
  useEffect(() => {
    if (!prefsReady) return;
    let cancelled = false;
    const key = cacheKey(ticker, interval);
    const cached = seriesCache.get(key);
    if (cached) show({ series: cached, seq: ++loadSeq, keepView: false });
    setFailed(false);
    fetchSeries(ticker, interval)
      .then((s) => {
        if (s.rows.length === 0 && cached) return; // 빈 재응답이 캐시를 지우지 않게
        seriesCache.set(key, s);
        // 캐시로 이미 첫 화면 구간을 잡았으면 사용자가 보던 위치 유지
        if (!cancelled) show({ series: keepOlder(s, shownRef.current), seq: ++loadSeq, keepView: cached !== undefined });
      })
      .catch(() => {
        if (!cancelled && !cached) setFailed(true); // 캐시가 있으면 그대로 보여 준다
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, interval, prefsReady]);

  // 1-2) 나머지 단위 미리 받기 — 첫 화면이 그려진 뒤 하나씩(동시 요청 폭주 방지). 첫 전환도 캐시로 즉시 보이게
  useEffect(() => {
    if (!prefsReady) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const it of CHART_INTERVALS) {
        if (cancelled) return;
        const key = cacheKey(ticker, it.value);
        if (seriesCache.has(key)) continue;
        try {
          const s = await fetchSeries(ticker, it.value);
          if (s.rows.length > 0 && !seriesCache.has(key)) seriesCache.set(key, s);
        } catch {
          // 미리 받기 실패는 무시(전환할 때 다시 받는다)
        }
      }
    }, PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticker, prefsReady]);

  // 1-1) WS 재연결·앱 복귀(streamEpoch 증가) → 끊긴 동안의 캔들을 다시 받아 빈 구간을 채운다(보던 위치 유지).
  // 서버(game_ws)는 앱과 무관하게 분봉을 계속 저장한다. 첫 로드 전·실패·빈 응답이면 화면을 건드리지 않음
  const streamEpoch = useTradingGameStore((s) => s.streamEpoch);
  const current = useRef({ ticker, interval }); // ticker·interval 변경은 위 1) 이 새로 로드 → epoch 변화에만 반응
  useEffect(() => {
    current.current = { ticker, interval };
  }, [ticker, interval]);
  useEffect(() => {
    if (streamEpoch === 0) return;
    let cancelled = false;
    const { ticker: t, interval: iv } = current.current;
    fetchSeries(t, iv)
      .then((s) => {
        if (s.rows.length === 0) return;
        seriesCache.set(cacheKey(t, iv), s);
        const prev = shownRef.current;
        if (!cancelled && prev !== null && sameSeries(prev.series, t, iv)) show({ series: keepOlder(s, prev), seq: ++loadSeq, keepView: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [streamEpoch]);

  // 2) 틱 → 오늘 일봉 / 현재 분봉 버킷에 병합(로드 전·다른 단위 데이터를 보여 주는 중이면 무시). 캐시도 함께 최신으로
  useEffect(() => {
    const prev = shownRef.current;
    if (lastPrice === null || prev === null || !sameSeries(prev.series, ticker, interval)) return;
    const s = prev.series;
    let next: Series;
    if (s.kind === 'day') next = { ...s, rows: applyTick(s.rows, kstDateString(), lastPrice) };
    else if (interval !== 'day') next = { ...s, rows: applyTickIntraday(s.rows, bucketStartSec(Date.now(), interval), lastPrice) };
    else return;
    seriesCache.set(cacheKey(ticker, interval), next);
    show({ ...prev, series: next }); // seq 유지 → WebView 에는 마지막 봉만(tick)
  }, [lastPrice, interval, ticker]);

  // 3) 일봉 왼쪽 끝 — 첫 캔들 이전 1년을 받아 앞에 붙인다(분봉은 서버 보관이 짧아 대상 아님). 빈 응답 = 더 없음
  const loadOlder = useCallback(async () => {
    const prev = shownRef.current;
    if (prev === null || prev.series.kind !== 'day') return false;
    const first = prev.series.rows[0]?.date;
    if (!first) return false;
    const got = await getDailyCandlesBefore(prev.series.ticker, first);
    if (got.length === 0) return false;
    const cur = shownRef.current;
    // 그사이 단위·종목이 바뀌었으면 붙이지 않는다(새 로드가 차트 상태를 이미 초기화)
    if (cur === null || cur.series.kind !== 'day' || cur.series.ticker !== prev.series.ticker) return true;
    const rows = mergeOlder(got, cur.series.rows); // 틱이 반영된 오늘 봉은 cur 에 있으므로 그대로 남는다
    show({ series: { ...cur.series, rows }, seq: ++loadSeq, keepView: true, prepended: rows.length - cur.series.rows.length });
    return true;
  }, []);

  // 가격선·색은 값이 바뀔 때만 새 객체(매 렌더 새 배열이면 WebView 에 매번 다시 보냄)
  const lines = useMemo(
    () => priceLines(coach, position, { up: theme.colors.up, down: theme.colors.down, muted: theme.colors.textSecondary }),
    [coach, position, theme.colors.up, theme.colors.down, theme.colors.textSecondary],
  );
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
  const chartView = useMemo<TvChartData | null>(
    () =>
      shown === null
        ? null
        : {
            data: shown.series.kind === 'day' ? { kind: 'day', rows: shown.series.rows } : { kind: 'min', rows: shown.series.rows },
            seq: shown.seq,
            keepView: shown.keepView,
            prepended: shown.prepended,
          },
    [shown],
  );

  // 지지·저항(설계 2026-10-27 §3) — 켜진 지표의 마지막 값 + 보이는 구간 POC 중 현재가 위·아래 2개씩.
  // 틱마다 다시 계산하되, 키·역할·호가 반올림 가격이 같으면 이전 배열을 유지(WebView·부모에 다시 보내지 않게)
  const [poc, setPoc] = useState<number | null>(null);
  const rawSr = useMemo<SrLevel[]>(() => {
    if (chartView === null || shown === null || !sameSeries(shown.series, ticker, interval)) return [];
    const bars = toBars(chartView.data);
    const price = lastPrice ?? bars[bars.length - 1]?.close;
    if (price === undefined) return [];
    const cands = srCandidates(
      {
        values: lastIndicatorValues(bars),
        ma: showMa,
        bb: showBb,
        poc: showVp ? poc : null,
        maColors: MA_PERIODS.map((p) => MA_COLORS[p]),
      },
      price,
    );
    return pickSrLevels(cands, price);
  }, [chartView, shown, ticker, interval, lastPrice, showMa, showBb, showVp, poc]);
  const [srLevels, setSrLevels] = useState<SrLevel[]>([]);
  // 렌더 중 파생 상태 갱신(React 권장 패턴) — 효과 안 setState 대신
  if (srSignature(srLevels) !== srSignature(rawSr)) setSrLevels(rawSr);
  useEffect(() => {
    onSrLevels?.(srLevels);
  }, [srLevels, onSrLevels]);
  // 지지·저항 선 — 이름은 가격축에(짧게), 범례에는 넣지 않는다(아래 lines 범례는 그대로)
  const chartLines = useMemo<ChartLine[]>(
    () => [
      ...lines,
      ...srLevels.map((l) => ({
        price: l.price,
        color: l.color,
        width: 1 as const,
        dashed: true,
        title: srName(l.key, MA_PERIODS, false),
        axisTitle: srAxisTitle(l, MA_PERIODS, true),
      })),
    ],
    [lines, srLevels],
  );

  // 다른 단위 데이터를 보여 주는 중(새 데이터 대기) — 흐리게 + 작은 로딩 표시
  const stale = shown !== null && !sameSeries(shown.series, ticker, interval);
  const empty = shown !== null && !stale && shown.series.rows.length === 0;
  const hasBars = shown !== null && shown.series.rows.length > 0;

  return (
    <View style={styles.frame}>
      {/* 단위 + 지표 버튼 한 줄. 지표는 '지표 ▾' 를 누르면 오른쪽 위 팝오버로 켜고 끈다 */}
      <View style={styles.chipsWrap} onLayout={(e: LayoutChangeEvent) => setChipsBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <View style={styles.chips}>
          {CHART_INTERVALS.map((it) => (
            <MiniChip key={it.value} label={it.label} selected={it.value === interval} onPress={() => setPicked(it.value)} />
          ))}
          <View style={styles.indicatorBtn}>
            <MiniChip
              label={`지표${showMa || showBb || showVp ? ` ${Number(showMa) + Number(showBb) + Number(showVp)}` : ''} ${indOpen ? '▴' : '▾'}`}
              selected={indOpen}
              onPress={() => setIndOpen((v) => !v)}
            />
          </View>
        </View>
      </View>
      <View style={styles.plotArea} onTouchStart={() => setIndOpen(false)}>
        {/* 실패 시에도 WebView 는 유지(다시 받으면 바로 그림) — 위에 안내만 덮는다 */}
        <View style={stale ? styles.staleChart : null}>
          <TvChart
            view={chartView}
            lines={chartLines}
            ma={showMa}
            bb={showBb}
            vp={showVp}
            colors={colors}
            height={CHART_H}
            onReady={() => setChartReady(true)}
            onNeedOlder={interval === 'day' ? loadOlder : undefined}
            onPoc={setPoc}
          />
        </View>
        {stale && !failed ? (
          <View style={styles.staleSpinner} pointerEvents="none">
            <ActivityIndicator size="small" />
          </View>
        ) : null}
        {hasBars && chartReady && (showMa || lines.length > 0) ? (
          // 가격선 이름(지지·저항·진입·손절·익절)도 여기 — 차트 안 이름은 가까운 선끼리 겹쳐서 뺐다
          <View style={styles.legend} pointerEvents="none">
            {showMa
              ? MA_PERIODS.map((p) => (
                  <Text key={p} style={[styles.legendText, { color: MA_COLORS[p] }]} allowFontScaling={false}>
                    {p}
                  </Text>
                ))
              : null}
            {lines.map((l) => (
              <Text key={l.title} style={[styles.legendText, styles.legendLine]} allowFontScaling={false}>
                <Text style={{ color: l.color }}>{l.dashed ? '┄' : '━'}</Text> {l.title}
              </Text>
            ))}
          </View>
        ) : null}
        {(shown === null || !chartReady) && !failed ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator />
          </View>
        ) : null}
        {empty ? (
          <View style={styles.center} pointerEvents="none">
            <Text style={styles.muted}>분봉은 오늘부터 쌓이고 있어요</Text>
          </View>
        ) : null}
        {failed ? (
          <View style={[styles.center, styles.failedCover]}>
            <Text style={styles.muted}>차트 데이터를 불러오지 못했어요</Text>
          </View>
        ) : null}
      </View>
      {/* 지표 팝오버 — 프레임의 마지막 자식(차트 위에 그려지고, Android 는 부모 영역 밖 자식에 터치를 안 주므로 칩 줄 밖 형제로) */}
      {indOpen ? (
        <View style={[styles.indicatorMenu, { top: chipsBottom + 4 }]}>
          <MiniChip label="이동평균 5·20·60" selected={showMa} onPress={() => setShowMa((v) => !v)} />
          <MiniChip label="볼린저 20·2σ" selected={showBb} onPress={() => setShowBb((v) => !v)} />
          <MiniChip label="매물대" selected={showVp} onPress={() => setShowVp((v) => !v)} />
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
    backgroundColor: theme.colors.surface, // 웹 차트 상자(bg-surface)와 같게 — 격자선(background 색)이 보이도록
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(1),
    overflow: 'hidden',
  },
  chipsWrap: { marginBottom: theme.gap(0.75) },
  chips: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5) },
  indicatorBtn: { marginLeft: 'auto' },
  indicatorMenu: {
    position: 'absolute',
    right: theme.gap(1),
    gap: theme.gap(0.75),
    padding: theme.gap(1),
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  miniChip: {
    borderRadius: theme.radius.chip,
    paddingVertical: 4,
    paddingHorizontal: theme.gap(1),
    backgroundColor: theme.colors.fill,
  },
  miniChipOn: { backgroundColor: theme.colors.primarySoft },
  miniLabel: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
  miniLabelOn: { color: theme.colors.primary },
  plotArea: { minHeight: CHART_H, position: 'relative' },
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
  segment: { height: 1 },
  faint: { opacity: 0.55 },
  faded: { opacity: 0.35 },
  legend: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: theme.gap(0.75),
  },
  legendText: { fontSize: 10, fontWeight: '700' },
  legendLine: { color: theme.colors.text },
  // 단위 전환 중(새 데이터 대기) — 이전 차트를 흐리게 + 가운데 위 작은 로딩
  staleChart: { opacity: 0.35 },
  staleSpinner: { position: 'absolute', top: theme.gap(1), left: 0, right: 0, alignItems: 'center' },
  failedCover: { backgroundColor: theme.colors.surface },
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
  // 오른쪽 가격축 — 옅은 가로 격자선 · 축 경계선 · 눈금 값(웹 lightweight-charts 가격축과 같은 배치)
  gridLine: { position: 'absolute', left: 0, height: 1, backgroundColor: theme.colors.border, opacity: 0.5 },
  axisBorder: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: theme.colors.border },
  axisTick: {
    position: 'absolute',
    right: 0,
    height: 14,
    fontSize: 10,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  // 현재가 태그 — 오른쪽 끝, 선 높이 가운데(웹 가격축 태그와 같은 모양)
  priceTag: {
    position: 'absolute',
    right: 0,
    height: TAG_H,
    lineHeight: TAG_H,
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    paddingHorizontal: 5,
    borderRadius: 3,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
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
