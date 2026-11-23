import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { TvChart, type TvChartData } from '@/features/game/components/tv-chart';
import { TAKE_PROFIT_COLOR, type ChartColors, type ChartLine } from '@/features/game/lib/chart-bridge';
import { MA_PERIODS } from '@/features/game/lib/indicators';

import { eduChartRows } from '../lib/edu-game';
import type { EduCandle, EduPosition, EduToday } from '../types';

const CHART_H = 260;
// 합성 날짜는 실제 달력과 무관(관리자 즉시 진행으로 앞서갈 수 있음) — 오늘 기준 구간 자르기를 하지 않고 전체를 맞춰 보여 준다
const ALL_DAYS = 36_500;
// 웹 TradingChart·게임 DailyChart 와 같은 이동평균 색
const MA_COLORS: Record<(typeof MA_PERIODS)[number], string> = { 5: '#14b8a6', 20: '#f97316', 60: '#a16207' };
let loadSeq = 0; // 전체 로드 번호(바뀌면 TvChart 가 새로 그린다)
const POC_COLOR = '#f59e0b'; // 매물대 최대 구간(POC) — 앰버 강조
const SR_COLOR = '#94A3B8'; // 지지·저항 수평선 — 단일 중립색(명세 5.2)

type Props = {
  candles: EduCandle[];
  today: EduToday | null;
  position: EduPosition | null;
};

/**
 * 교육용 합성 일봉 차트 — 기존 게임 차트 엔진(TvChart: lightweight-charts WebView)에 합성 캔들을 그대로 넘긴다.
 * DailyChart 는 실제 종목 일봉을 직접 받아 오므로 쓰지 않는다(합성 시즌에 실제 시세 API 를 부르지 않게).
 * 토글: 이동평균 5·20·60 / 볼린저 20·2σ / 매물대(+POC 선) / 지지·저항(서버가 준 가격의 전체 폭 수평선). 보유 중이면 진입·손절·익절 선.
 */
export function EduChart({ candles, today, position }: Props) {
  const { theme } = useUnistyles();
  const [showMa, setShowMa] = useState(true);
  const [showBb, setShowBb] = useState(false);
  const [showVp, setShowVp] = useState(true);
  const [showSr, setShowSr] = useState(true);
  const [ready, setReady] = useState(false);

  // 캔들이 바뀔 때만 새 seq(전체 로드) — 같은 데이터면 WebView 에 다시 보내지 않는다. 재조회 때는 보던 위치 유지(keepView, 첫 로드는 TvChart 가 무시)
  const view = useMemo<TvChartData | null>(() => {
    const rows = eduChartRows(candles);
    if (rows.length === 0) return null;
    return { data: { kind: 'day', rows }, seq: ++loadSeq, keepView: true };
  }, [candles]);

  const lines = useMemo<ChartLine[]>(() => {
    const out: ChartLine[] = [];
    if (showVp && today?.poc_price != null) {
      out.push({ price: today.poc_price, color: POC_COLOR, width: 2, dashed: false, title: 'POC', fit: 'day' });
    }
    if (showSr && today?.resistance_price != null) {
      out.push({ price: today.resistance_price, color: SR_COLOR, width: 1, dashed: false, title: '저항', fit: 'day', noLabel: true });
    }
    if (showSr && today?.support_price != null) {
      out.push({ price: today.support_price, color: SR_COLOR, width: 1, dashed: false, title: '지지', fit: 'day', noLabel: true });
    }
    if (position) {
      out.push({
        price: position.entry_price,
        color: position.side === 'LONG' ? theme.colors.up : theme.colors.down,
        width: 2,
        dashed: false,
        title: '진입',
        fit: 'always',
      });
      if (position.stop_loss_price != null) {
        out.push({ price: position.stop_loss_price, color: theme.colors.textSecondary, width: 1, dashed: true, title: '손절' });
      }
      if (position.take_profit_price != null) {
        out.push({ price: position.take_profit_price, color: TAKE_PROFIT_COLOR, width: 1, dashed: true, title: '익절' });
      }
    }
    return out;
  }, [showVp, showSr, today, position, theme.colors.up, theme.colors.down, theme.colors.textSecondary]);

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

  return (
    <View style={styles.frame}>
      <View style={styles.chips}>
        <MiniChip label="이동평균" selected={showMa} onPress={() => setShowMa((v) => !v)} />
        <MiniChip label="볼린저" selected={showBb} onPress={() => setShowBb((v) => !v)} />
        <MiniChip label="매물대" selected={showVp} onPress={() => setShowVp((v) => !v)} />
        <MiniChip label="지지·저항" selected={showSr} onPress={() => setShowSr((v) => !v)} />
      </View>
      <View style={styles.plotArea}>
        <TvChart
          view={view}
          lines={lines}
          ma={showMa}
          bb={showBb}
          vp={showVp}
          colors={colors}
          height={CHART_H}
          visibleDays={ALL_DAYS}
          onReady={() => setReady(true)}
        />
        {view !== null && ready && (showMa || lines.length > 0) ? (
          // 선 이름은 범례로(차트 안 라벨은 가까운 선끼리 겹침)
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
        {view === null || !ready ? (
          <View style={styles.center} pointerEvents="none">
            {view === null ? <Text style={styles.muted}>차트 데이터가 아직 없어요</Text> : <ActivityIndicator />}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MiniChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={6}
      style={[styles.miniChip, selected && styles.miniChipOn]}>
      <Text style={[styles.miniLabel, selected && styles.miniLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(1),
    overflow: 'hidden',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(0.5), marginBottom: theme.gap(0.75) },
  miniChip: {
    borderRadius: theme.radius.chip,
    paddingVertical: theme.gap(0.5),
    paddingHorizontal: theme.gap(1.25),
    backgroundColor: theme.colors.fill,
  },
  miniChipOn: { backgroundColor: theme.colors.primarySoft },
  miniLabel: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
  miniLabelOn: { color: theme.colors.primary },
  plotArea: { minHeight: CHART_H, position: 'relative' },
  legend: {
    position: 'absolute',
    top: 4,
    left: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    maxWidth: '80%',
  },
  legendText: { fontSize: 10, fontWeight: '700' },
  legendLine: { color: theme.colors.text },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
}));
