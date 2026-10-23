import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { high52w, resolveTickerParam, scoreView } from '@/features/leaders/canslim';
import { ScoreHistory } from '@/features/leaders/components/score-history';
import { ScoreTable } from '@/features/leaders/components/score-table';
import { StockDailyChart } from '@/features/leaders/components/stock-daily-chart';
import { useCanslimScore } from '@/features/leaders/use-canslim-score';
import { formatIndex } from '@/features/market/format';
import { PatternSummary } from '@/features/patterns/components/pattern-summary';
import { currentBase, patternChartLines } from '@/features/patterns/patterns';
import { usePatternBases } from '@/features/patterns/use-pattern-bases';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Button, ListState } from '@/ui';

/**
 * 범용 종목 상세 — 머리(이름·종가·점수) · 일봉 차트(50일선·52주 고점) · 7항목 점수표 · 점수 추이.
 * 점수와 차트는 따로 조회한다(한쪽이 실패해도 다른 쪽은 보인다). 점수가 null 이면 분석 비대상(ETF·우선주 등).
 * 진입: 스크리너 '주도주' 목록, 테마·업종 상세의 구성 종목. name 파라미터는 비대상 종목의 제목용.
 */
export default function StockDetailScreen() {
  // name 은 선택 파라미터지만 typedRoutes 제약(값은 string) 때문에 string 으로 선언하고 실제 값으로 판단한다
  const params = useLocalSearchParams<{ ticker: string; name: string }>();
  // 배열이면 첫 요소, 빈 값·허용 외 문자는 NotFound
  const ticker = resolveTickerParam(params.ticker as string | string[] | undefined);
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!ticker) return <NotFound />;
  return <StockDetailBody ticker={ticker} fallbackName={name || ticker} />;
}

function NotFound() {
  const router = useRouter();
  // 딥링크로 들어와 스택이 이 화면뿐이면 back() 이 동작하지 않으므로 스크리너 탭으로 보낸다
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/screener'));
  return (
    <View style={styles.center}>
      <ListState mode="empty" emoji="🔍" title="종목 정보를 찾을 수 없어요" hint="주소를 다시 확인해 주세요" />
      <Button label="뒤로 가기" variant="secondary" fullWidth={false} onPress={goBack} />
    </View>
  );
}

function StockDetailBody({ ticker, fallbackName }: { ticker: string; fallbackName: string }) {
  const score = useCanslimScore(ticker);
  const patterns = usePatternBases(ticker);
  const { theme } = useUnistyles();
  // 당겨서 새로고침 — 점수 실패는 토스트(throw), 패턴은 독립 조회라 실패해도 영역만 숨는다
  const { reload: reloadPatterns } = patterns;
  const { refresh: refreshScore } = score;
  const refreshAll = useCallback(async () => {
    void reloadPatterns();
    await refreshScore();
  }, [reloadPatterns, refreshScore]);
  const { refreshing, onRefresh } = usePullRefresh(refreshAll);
  const pattern = currentBase(patterns.data?.bases);
  const patternZones = patterns.data?.zones ?? null;
  const patternLines = useMemo(
    () =>
      pattern
        ? patternChartLines(pattern.pivot, patternZones, {
            pivot: theme.colors.primary,
            buy: theme.colors.up,
            stop: theme.colors.down,
          })
        : undefined,
    [pattern, patternZones, theme.colors.primary, theme.colors.up, theme.colors.down],
  );
  const view = scoreView(score);
  const data = score.data;
  const n = data?.letters.find((l) => l.key === 'n');
  const high = data ? high52w(data.close, n?.value ?? null) : null;
  const title = data?.name ?? fallbackName;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Stack.Screen options={{ title }} />
      <View style={[styles.card, styles.headRow]}>
        <View style={styles.headMain}>
          <Text style={styles.name} numberOfLines={1}>{title}</Text>
          <Text style={styles.meta}>
            {ticker}
            {data ? ` · ${data.sectorName ?? data.market}` : ''}
          </Text>
          {data ? (
            <Text style={styles.meta}>
              {formatIndex(data.close)}원 · {data.date} 종가
            </Text>
          ) : null}
        </View>
        {data ? (
          <View style={styles.scoreBox}>
            <Text style={styles.score}>
              {data.score}
              <Text style={styles.unit}>점</Text>
            </Text>
            <Text style={styles.meta}>7개 중 {data.passCount}개 통과</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <StockDailyChart ticker={ticker} high52w={high} extraLines={patternLines} />
      </View>

      {pattern ? (
        <PatternSummary base={pattern} close={patterns.data?.close ?? null} date={patterns.data?.date ?? null} />
      ) : null}

      {view === 'loading' ? (
        <View style={styles.card}>
          <ActivityIndicator />
        </View>
      ) : null}
      {view === 'error' ? (
        <View style={styles.card}>
          <Text style={styles.msgTitle}>점수표를 불러오지 못했어요</Text>
          <Text style={styles.meta}>잠시 후 다시 시도해 주세요 (오류: {score.error})</Text>
          <Pressable onPress={() => void score.reload()} accessibilityRole="button" style={styles.retry}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
      {view === 'none' ? (
        <View style={styles.card}>
          <Text style={styles.msgTitle}>주도주 분석 대상이 아니에요</Text>
          <Text style={styles.meta}>보통주만 분석해요</Text>
        </View>
      ) : null}
      {view === 'ready' && data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.section}>7가지 기준</Text>
            <ScoreTable letters={data.letters} />
          </View>
          <ScoreHistory history={data.history} />
          <Text style={styles.note}>실적(C·A)은 최신 공시 기준이며, 투자 권유가 아니에요.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.gap(2), backgroundColor: theme.colors.background },
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2), gap: theme.gap(1.5) },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.gap(1.5) },
  headMain: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  meta: { fontSize: 13, color: theme.colors.textSecondary },
  scoreBox: { alignItems: 'flex-end', gap: 2 },
  score: { fontSize: 28, fontWeight: '800', color: theme.colors.text },
  unit: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  section: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  msgTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  retry: { alignSelf: 'flex-start', paddingVertical: theme.gap(0.5) },
  retryText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  note: { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: theme.gap(1) },
}));
