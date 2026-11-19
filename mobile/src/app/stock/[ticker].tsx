import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { high52w, resolveTickerParam, scoreView } from '@/features/leaders/canslim';
import { LendingSection } from '@/features/leaders/components/lending-section';
import { ScoreHistory } from '@/features/leaders/components/score-history';
import { ScoreTable } from '@/features/leaders/components/score-table';
import { StockDailyChart } from '@/features/leaders/components/stock-daily-chart';
import { useCanslimScore } from '@/features/leaders/use-canslim-score';
import { marketDataVisible, stockLinkOutUrl } from '@/features/market-access/access';
import { StaleNotice } from '@/features/market/components/stale-notice';
import { formatIndex } from '@/features/market/format';
import { PatternSummary } from '@/features/patterns/components/pattern-summary';
import { currentBase, patternChartLines } from '@/features/patterns/patterns';
import { usePatternBases } from '@/features/patterns/use-pattern-bases';
import { useScreenerFeaturesState } from '@/features/screener/use-screener-features';
import { stockBackHref } from '@/features/screener/visibility';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Button, ListState } from '@/ui';

/**
 * 사용자 화면에서 CANSLIM 점수 박스·7가지 기준(ScoreTable)·점수 추이(ScoreHistory)·'주도주 분석 대상이 아니에요' 카드를 보이지 않는다 —
 * 모든 시장·종목 데이터는 참고용(docs/app_identity_and_nav_redesign_spec.md 2-4, 웹 StockDetailPage 와 같음).
 * 코드·부품(score-table·score-history)은 지우지 않고 이 스위치로 렌더링에서만 뺀다. 관리자 웹에서는 계속 100% 열람.
 * 점수 조회는 계속한다 — 이름·업종·종가·기준일·52주 고점(차트 선)이 이 응답에서 나온다.
 */
const SHOW_CANSLIM = false;

/** 모든 종목 상세 하단 공통 안내 */
const REFERENCE_NOTE = '모든 데이터는 투자 판단의 참고용 자료이며, 투자 권유가 아니에요.';

/**
 * 범용 종목 상세 — 머리(이름·종가) · 일봉 차트(50일선·52주 고점) · 패턴 요약(있을 때) · 대차잔고(데이터 없으면 숨김) · 참고용 안내.
 * (SHOW_CANSLIM 을 켜면 예전처럼 머리 점수 · 7항목 점수표 · 점수 추이도 보인다)
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
  return <MarketDataGate ticker={ticker} fallbackName={name || ticker} />;
}

/**
 * 시세 비노출(A안 설계 3-4) — 요청자가 시세를 볼 수 없으면 차트·종가·52주·패턴·대차를 요청도 하지 않고
 * 종목명·코드 + "시세는 증권사 앱에서" 링크아웃만. 판단값을 묻는 동안은 로딩(시세가 잠깐 비치지 않게).
 */
function MarketDataGate({ ticker, fallbackName }: { ticker: string; fallbackName: string }) {
  const access = useScreenerFeaturesState();
  if (access === null) return <ListState mode="loading" />;
  if (!marketDataVisible(access)) return <StockLinkOutBody ticker={ticker} name={fallbackName} />;
  return <StockDetailBody ticker={ticker} fallbackName={fallbackName} />;
}

function StockLinkOutBody({ ticker, name }: { ticker: string; name: string }) {
  const href = stockLinkOutUrl(ticker);
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: name }} />
      <View style={styles.card}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.meta}>{ticker}</Text>
        <Text style={styles.meta}>시세·차트는 증권사 앱이나 포털에서 확인해 주세요.</Text>
        {href ? (
          <Button label="시세는 증권사 앱에서 ↗" variant="secondary" onPress={() => void Linking.openURL(href).catch(() => {})} />
        ) : null}
      </View>
    </ScrollView>
  );
}

function NotFound() {
  const router = useRouter();
  const features = useScreenerFeaturesState();
  // 딥링크로 들어와 스택이 이 화면뿐이면 back() 이 동작하지 않으므로 스크리너 탭으로 보낸다
  // (종목 상세는 주로 스크리너에서 들어오므로 /screener. 단 관리자 스위치로 종목 찾기가 꺼졌으면(로딩 전 포함) 마켓 탭)
  const goBack = () => (router.canGoBack() ? router.back() : router.replace(stockBackHref(features)));
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
  const [lendingKey, setLendingKey] = useState(0);
  const refreshAll = useCallback(async () => {
    void reloadPatterns();
    setLendingKey((k) => k + 1);
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
      <StaleNotice inset={false} />
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
        {SHOW_CANSLIM && data ? (
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

      <LendingSection ticker={ticker} reloadKey={lendingKey} />

      {view === 'loading' ? (
        <View style={styles.card}>
          <ActivityIndicator />
        </View>
      ) : null}
      {view === 'error' ? (
        <View style={styles.card}>
          <Text style={styles.msgTitle}>종목 정보를 불러오지 못했어요</Text>
          <Text style={styles.meta}>잠시 후 다시 시도해 주세요 (오류: {score.error})</Text>
          <Pressable onPress={() => void score.reload()} accessibilityRole="button" style={styles.retry}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
      {SHOW_CANSLIM && view === 'none' ? (
        <View style={styles.card}>
          <Text style={styles.msgTitle}>주도주 분석 대상이 아니에요</Text>
          <Text style={styles.meta}>보통주만 분석해요</Text>
        </View>
      ) : null}
      {SHOW_CANSLIM && view === 'ready' && data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.section}>7가지 기준</Text>
            <ScoreTable letters={data.letters} />
          </View>
          <ScoreHistory history={data.history} />
          <Text style={styles.note}>실적(C·A)은 최신 공시 기준이며, 투자 권유가 아니에요.</Text>
        </>
      ) : null}
      {SHOW_CANSLIM ? null : <Text style={styles.note}>{REFERENCE_NOTE}</Text>}
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
