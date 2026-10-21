import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BasisNote } from '@/features/market/components/basis-note';
import { BreadthBar } from '@/features/market/components/breadth-bar';
import { formatAmount, formatChg, formatIndex, toneOf } from '@/features/market/format';
import type { GroupKind } from '@/features/market/types';
import { useGroupDetail } from '@/features/market/use-group-detail';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Button, ListState } from '@/ui';

/** 테마·업종 상세 — 요약(1·5·20일 등락·거래대금·시총·상승/하락·순위) + 구성 종목 */
export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ kind: string; id: string }>();
  const id = String(params.id ?? '');
  // theme/sector 가 아닌 kind 는 조회하지 않고 "찾을 수 없음" 으로 보낸다(딥링크·잘못된 URL 방어)
  if (params.kind !== 'theme' && params.kind !== 'sector') return <NotFound />;
  return <GroupDetailBody kind={params.kind} id={id} />;
}

function NotFound() {
  const router = useRouter();
  // 딥링크로 들어와 스택이 이 화면뿐이면 back() 이 동작하지 않으므로 스크리너 탭으로 보낸다
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/screener'));
  return (
    <View style={styles.center}>
      <ListState mode="empty" emoji="🔍" title="이 그룹 정보를 찾을 수 없어요" hint="목록이 바뀌었을 수 있어요" />
      <Button label="뒤로 가기" variant="secondary" fullWidth={false} onPress={goBack} />
    </View>
  );
}

function GroupDetailBody({ kind, id }: { kind: GroupKind; id: string }) {
  const router = useRouter();
  const { data, loading, error, notFound, reload, refresh } = useGroupDetail(kind, id);
  const { refreshing, onRefresh } = usePullRefresh(refresh);

  if (loading && !data) return <ListState mode="loading" />;
  if (notFound) return <NotFound />;
  if (error || !data) {
    return <ListState mode="error" title="상세를 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${error ?? 'NETWORK'})`} onRetry={reload} />;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Stack.Screen options={{ title: data.name }} />
      <View style={styles.card}>
        <Text style={styles.kind}>{kind === 'theme' ? '테마' : '업종'} · {data.rank ? `${data.rank}위` : '순위 없음'}</Text>
        {data.description ? <Text style={styles.desc}>{data.description}</Text> : null}
        <View style={styles.chgRow}>
          {([['1일', data.chg1d], ['5일', data.chg5d], ['20일', data.chg20d]] as const).map(([t, v]) => (
            <View key={t} style={styles.chgBox}>
              <Text style={styles.label}>{t}</Text>
              <Text style={[styles.chg, styles[toneOf(v)]]}>{formatChg(v)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.meta}>거래대금 {formatAmount(data.value)} · 시가총액 {formatAmount(data.mcap)}</Text>
        <View style={styles.breadth}>
          <BreadthBar up={data.up} down={data.down} flat={data.flat} />
          <Text style={styles.meta}>상승 {data.up} · 보합 {data.flat} · 하락 {data.down}</Text>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>구성 종목 {data.stocks.length}</Text>
        {data.stocks.map((s) => (
          <Pressable
            key={s.ticker}
            style={({ pressed }) => [styles.stock, pressed && styles.pressed]}
            onPress={() => router.push({ pathname: '/stock/[ticker]', params: { ticker: s.ticker, name: s.name } })}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}${s.isLeader ? ' 대장주' : ''}, ${formatIndex(s.close)}, 1일 ${formatChg(s.chg1d)}, 5일 ${formatChg(s.chg5d)}`}
            accessibilityHint="종목 상세 보기"
          >
            <View style={styles.stockMain}>
              <View style={styles.nameRow}>
                <Text style={styles.stockName} numberOfLines={1}>{s.name}</Text>
                {s.isLeader ? <Text style={styles.leader}>대장주</Text> : null}
              </View>
              {s.reason ? <Text style={styles.reason} numberOfLines={2}>{s.reason}</Text> : null}
            </View>
            <View style={styles.stockNums}>
              <Text style={styles.price}>{formatIndex(s.close)}</Text>
              <Text style={[styles.small, styles[toneOf(s.chg1d)]]}>1일 {formatChg(s.chg1d)}</Text>
              <Text style={[styles.small, styles[toneOf(s.chg5d)]]}>5일 {formatChg(s.chg5d)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <BasisNote date={data.date} />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.gap(2), backgroundColor: theme.colors.background },
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2), gap: theme.gap(1.5) },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  kind: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  desc: { fontSize: 14, color: theme.colors.text },
  chgRow: { flexDirection: 'row', gap: theme.gap(1) },
  chgBox: { flex: 1, backgroundColor: theme.colors.fill, borderRadius: 12, padding: theme.gap(1), alignItems: 'center', gap: 2 },
  label: { fontSize: 12, color: theme.colors.textSecondary },
  chg: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 13, color: theme.colors.textSecondary },
  breadth: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  section: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  stock: { flexDirection: 'row', gap: theme.gap(1), paddingVertical: theme.gap(1), borderTopWidth: 1, borderTopColor: theme.colors.border },
  pressed: { opacity: 0.6 },
  stockMain: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  stockName: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: theme.colors.text },
  leader: { fontSize: 11, fontWeight: '700', color: theme.colors.up },
  reason: { fontSize: 12, color: theme.colors.textSecondary },
  stockNums: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  small: { fontSize: 12, fontWeight: '600' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
}));
