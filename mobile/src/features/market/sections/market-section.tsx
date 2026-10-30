import { useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { kstDateString } from '@/features/game/lib/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState, SectionHead } from '@/ui';

import { BasisNote } from '../components/basis-note';
import { BriefCard } from '../components/brief-card';
import { EventList } from '../components/event-list';
import { FlowBoard } from '../components/flow-board';
import { GroupRow } from '../components/group-row';
import { Heatmap } from '../components/heatmap';
import { HotKeywords } from '../components/hot-keywords';
import { IndexCard, MacroCard } from '../components/index-card';
import { IndexChipCard } from '../components/index-chip-card';
import { MoversBoard } from '../components/movers-board';
import {
  formatBasis,
  formatShortDate,
  indexBasisTime,
  latestTime,
  marketSession,
  type MarketSession,
  splitCarousel,
} from '../dashboard';
import { groupOverview, NEUTRAL_HINT } from '../overview-groups';
import type { HeatmapKind, HeatmapSize } from '../rest-types';
import type { GroupKind } from '../types';
import { useAutoRefresh } from '../use-auto-refresh';
import { useHeatmap } from '../use-heatmap';
import { useInvestorFlow } from '../use-investor-flow';
import { useMarketOverview } from '../use-market-overview';
import { useMorningBrief } from '../use-morning-brief';
import { MOVERS_REFRESH_MS, useMovers } from '../use-movers';

type Props = {
  onMore: (tab: 'theme' | 'calendar') => void;
  onOpenGroup: (kind: GroupKind, id: string) => void;
  /** ① 헤더(타이틀 줄)에 붙일 기준 시각·장운영 뱃지 — 문자열(원시값)만 넘긴다 */
  onHeader?: (basis: string | null, session: MarketSession | null) => void;
};

/**
 * 개요 칩 = 시황 대시보드(스펙 §2.1 ②~⑦).
 * ② AI 장전 브리핑 → ③ 지수 캐러셀(+ 돈의 흐름·경제지표) → ④ 히트맵 → ⑤ 급등락 & AI 원인 → ⑤-2 수급 전광판
 * → ⑥ 핫 키워드·주도 테마 → ⑦ 다가오는 일정.
 * 섹션마다 따로 불러와 하나가 실패해도 나머지는 보인다. 전부 실패했을 때만 전체 오류 화면.
 */
export function MarketSection({ onMore, onOpenGroup, onHeader }: Props) {
  const router = useRouter();
  const overview = useMarketOverview();
  const brief = useMorningBrief();
  const movers = useMovers();
  const flow = useInvestorFlow();
  const [heatKind, setHeatKind] = useState<HeatmapKind>('sector');
  const [heatSize, setHeatSize] = useState<HeatmapSize>('mcap');
  const heat = useHeatmap(heatKind, heatSize);
  const today = kstDateString();

  const indices = useMemo(() => overview.data?.overview.indices ?? [], [overview.data]);
  const macro = overview.data?.overview.macro ?? [];
  const session = marketSession(indices);

  // 당겨서 새로고침 — 모든 섹션을 함께, 전부 실패했을 때만 토스트(일부 실패는 그 섹션만 이전 값 유지)
  const sources = [overview, brief, movers, flow, heat];
  const refreshAll = async () => {
    const results = await Promise.allSettled(sources.map((s) => s.refresh()));
    if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
  };
  const { refreshing, onRefresh } = usePullRefresh(refreshAll);
  const reloadAll = () => sources.forEach((s) => void s.reload());

  // 지수·거시는 30초(기존), 급등락은 정규장일 때만 60초마다 조용히 갱신 — 화면이 포커스·앱이 앞에 있을 때만
  useAutoRefresh(overview.silentRefresh);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const moversSilent = movers.silentRefresh;
  const refreshMoversInSession = useCallback(
    async () => (sessionRef.current === '정규장' ? moversSilent() : undefined),
    [moversSilent],
  );
  useAutoRefresh(refreshMoversInSession, MOVERS_REFRESH_MS);

  // ① 헤더 기준 시각 — 국내 지수·급등락·수급 중 가장 최근
  const basis = formatBasis(latestTime([
    ...indices.map(indexBasisTime),
    movers.data?.updatedAt,
    flow.data?.updatedAt,
  ]));
  useEffect(() => {
    onHeader?.(basis, session);
  }, [onHeader, basis, session]);

  const openStock = useCallback(
    (ticker: string, name: string) => router.push({ pathname: '/stock/[ticker]', params: { ticker, name } }),
    [router],
  );

  // 핫 키워드 시트에서 티커를 이름으로 보여 주기 위한 표(급등락·수급·히트맵에서 모은다)
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...(movers.data?.gainers ?? []), ...(movers.data?.losers ?? [])]) m.set(x.ticker, x.stockName);
    for (const x of [...(flow.data?.foreignTop ?? []), ...(flow.data?.institutionTop ?? []), ...(flow.data?.pensionTop ?? [])]) {
      m.set(x.ticker, x.name);
    }
    for (const g of heat.data?.groups ?? []) for (const s of g.stocks) if (s.ticker) m.set(s.ticker, s.name);
    return m;
  }, [movers.data, flow.data, heat.data]);

  const nothingYet = sources.every((s) => s.loading && s.data == null);
  const allFailed = sources.every((s) => s.error != null && s.data == null);
  if (nothingYet) return <ListState mode="loading" />;
  if (allFailed) {
    return (
      <ListState mode="error" title="시장 데이터를 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${overview.error})`} onRetry={reloadAll} />
    );
  }

  const { carousel, rest } = splitCarousel(indices);
  const g = groupOverview(rest, macro);
  const otherIndices = [...g.kr, ...g.us];
  const mv = movers.data;
  const fl = flow.data;
  const hasFlow = fl != null && (fl.foreignTop.length + fl.institutionTop.length + fl.pensionTop.length + fl.doubleBuy.length > 0);
  const themes = overview.data?.themes ?? [];
  const events = overview.data?.events ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* ② AI 장전 브리핑 — 오늘 브리핑이 없으면 숨김 */}
      {brief.data ? <BriefCard brief={brief.data} /> : null}

      {/* ③ 주요 지수 캐러셀 */}
      {carousel.length > 0 ? (
        <View style={styles.section}>
          <SectionHead title="주요 지수" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.carousel}>
            {carousel.map((ix) => <IndexChipCard key={ix.code} index={ix} />)}
          </ScrollView>
        </View>
      ) : overview.error ? (
        <InlineError text="지수를 불러오지 못했어요" onRetry={overview.reload} />
      ) : null}

      {/* ③ 아래 — 캐러셀에 없는 지표(VIX·국채 금리·그 밖의 지수·미국 경제지표) */}
      {g.flow.length + g.rates.length > 0 ? (
        <Group title="돈의 흐름">
          {g.flow.map((ix) => <IndexCard key={ix.code} index={ix} hint={NEUTRAL_HINT[ix.code]} />)}
          {g.rates.map((m) => <MacroCard key={m.seriesId} macro={m} />)}
        </Group>
      ) : null}
      {otherIndices.length > 0 ? (
        <Group title="그 밖의 지수">
          {otherIndices.map((ix) => <IndexCard key={ix.code} index={ix} />)}
        </Group>
      ) : null}
      {g.otherMacro.length > 0 ? (
        <Group title="미국 경제지표">
          {g.otherMacro.map((m) => <MacroCard key={m.seriesId} macro={m} />)}
        </Group>
      ) : null}

      {/* ④ 시장 히트맵 */}
      <View style={styles.card}>
        <SectionHead title="시장 히트맵" caption={heat.data?.date ? `${formatShortDate(heat.data.date)} 기준 · 1일 등락` : null} />
        <View style={styles.toggles}>
          <Chip label="업종" selected={heatKind === 'sector'} onPress={() => setHeatKind('sector')} />
          <Chip label="테마" selected={heatKind === 'theme'} onPress={() => setHeatKind('theme')} />
          <View style={styles.toggleGap} />
          <Chip label="시가총액 기준" selected={heatSize === 'mcap'} onPress={() => setHeatSize('mcap')} />
          <Chip label="거래대금 기준" selected={heatSize === 'value'} onPress={() => setHeatSize('value')} />
        </View>
        {heat.data && heat.data.groups.length > 0 ? (
          <Heatmap groups={heat.data.groups} onOpenStock={openStock} />
        ) : heat.loading ? (
          <Text style={styles.muted}>불러오고 있어요…</Text>
        ) : heat.error ? (
          <InlineError text="히트맵을 불러오지 못했어요" onRetry={heat.reload} />
        ) : (
          <Text style={styles.muted}>히트맵 데이터를 준비하고 있어요</Text>
        )}
      </View>

      {/* ⑤ 급등락 & AI 원인 */}
      {mv && mv.gainers.length + mv.losers.length > 0 ? (
        <View style={styles.card}>
          <SectionHead title="급등락 & AI 원인" caption={formatBasis(mv.updatedAt)} />
          <MoversBoard gainers={mv.gainers} losers={mv.losers} onOpenStock={openStock} />
        </View>
      ) : movers.error && !mv ? (
        <InlineError text="급등락 종목을 불러오지 못했어요" onRetry={movers.reload} />
      ) : null}

      {/* ⑤-2 투자자별 수급 전광판 */}
      {fl && hasFlow ? (
        <View style={styles.card}>
          <SectionHead
            title="수급 전광판"
            caption={[fl.date ? `${formatShortDate(fl.date)} 기준` : null, fl.source ? `출처 ${fl.source === 'kis' ? 'KIS' : 'KRX(pykrx)'}` : null]
              .filter(Boolean)
              .join(' · ') || null}
          />
          <FlowBoard flow={fl} onOpenStock={openStock} />
        </View>
      ) : flow.error && !fl ? (
        <InlineError text="수급 데이터를 불러오지 못했어요" onRetry={flow.reload} />
      ) : null}

      {/* ⑥ 핫 키워드 & 주도 테마 */}
      {(mv?.keywords.length ?? 0) > 0 || themes.length > 0 ? (
        <View style={styles.card}>
          <SectionHead title="핫 키워드 & 주도 테마" onMore={themes.length > 0 ? () => onMore('theme') : undefined} />
          {mv && mv.keywords.length > 0 ? <HotKeywords keywords={mv.keywords} names={names} onOpenStock={openStock} /> : null}
          {themes.map((t) => <GroupRow key={t.id} item={t} onPress={() => onOpenGroup('theme', t.id)} />)}
        </View>
      ) : null}

      {/* ⑦ 증시 캘린더 요약 */}
      {events.length > 0 ? (
        <View style={styles.card}>
          <SectionHead title="다가오는 일정" onMore={() => onMore('calendar')} />
          <EventList events={events} today={today} />
        </View>
      ) : null}

      {/* 주도 테마가 실패해도 기준일이 남게 국내 지수 날짜로 대체(미국·환율은 거래일이 다름) */}
      <BasisNote date={overview.data?.date ?? indices.find((ix) => ix.region === 'KR')?.date ?? null} />
    </ScrollView>
  );
}

/** 카드 묶음 — 제목 + 2열 격자 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle} accessibilityRole="header">{title}</Text>
      <View style={styles.grid}>{children}</View>
    </View>
  );
}

/** 섹션 하나만 실패했을 때 한 줄 안내 + 다시 시도 */
function InlineError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <View style={styles.inlineError}>
      <Text style={styles.muted}>{text}</Text>
      <Chip label="다시 시도" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingHorizontal: theme.gap(2.5), paddingTop: theme.gap(1), paddingBottom: theme.gap(2), gap: theme.gap(3) },
  section: { gap: theme.gap(1.5) },
  bleed: { flexGrow: 0, marginHorizontal: -theme.gap(2.5) },
  carousel: { gap: theme.gap(1.25), paddingHorizontal: theme.gap(2.5) },
  group: { gap: theme.gap(1) },
  groupTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: theme.gap(1.5) },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1.5) },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(0.75) },
  toggleGap: { width: theme.gap(0.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  inlineError: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
}));
