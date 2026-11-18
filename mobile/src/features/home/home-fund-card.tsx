import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { fundRefresher } from '@/features/fund/auto-refresh';
import { displayName, fundStatusLine, readValidCache, useAutoRefreshStatus, type FundEntry } from '@/features/fund/core';
import { FUNDS_TAB_PATH, openFundLoginSheet } from '@/features/fund/fund-gate';
import { fileCache, loadFunds } from '@/features/fund/fund-store';
import { Button, Card } from '@/ui';

import { HOME_FUND_LIMIT, homeFundCardState } from './home-sections';

/**
 * 홈 최상단 '내 펀드' 카드 — 비로그인(로그인 안내) / 로그인 + 펀드 없음(등록 안내) / 펀드 있음(펀드명·기준일 한 줄).
 * 펀드 목록은 서버가 아니라 이 기기(로그인 계정별)에 있다 — 내 펀드 화면과 같은 fund-store·core 로 읽는다.
 * 탭은 마운트된 채 남으므로 홈에 돌아올 때마다(포커스) 다시 읽는다(내 펀드 탭에서 추가·삭제한 것이 바로 반영되게).
 * 목록은 읽은 계정(uid)과 함께 보관 — 계정이 바뀌면 이전 계정 펀드가 보이지 않는다.
 */
export function HomeFundCard() {
  const router = useRouter();
  const uid = useAuthStore((s) => s.user?.id ?? null);
  const hydrated = useAuthStore((s) => s.hydrated);
  const [data, setData] = useState<{ uid: number; list: FundEntry[] | null; failed: boolean } | null>(null);
  const mine = data !== null && data.uid === uid ? data : null;
  const state = homeFundCardState({ hydrated, uid, funds: mine?.list ?? null, failed: mine?.failed ?? false });
  const status = useAutoRefreshStatus(fundRefresher);
  const [lines, setLines] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      if (uid === null) return;
      let alive = true;
      loadFunds(uid)
        .then((list) => alive && setData({ uid, list, failed: false }))
        .catch(() => alive && setData((d) => (d?.uid === uid && d.list ? d : { uid, list: null, failed: true })));
      return () => {
        alive = false;
      };
    }, [uid]),
  );

  // 한 줄(기준일·확인 시각) — 목록이 바뀌거나 자동 갱신이 끝날 때마다 캐시를 다시 읽는다(내 펀드 목록과 같은 방식)
  const list = mine?.list ?? null; // 읽을 때만 바뀌는 참조
  useEffect(() => {
    if (!list || list.length === 0) return;
    const shown = list.slice(0, HOME_FUND_LIMIT);
    let alive = true;
    const now = Date.now();
    void Promise.all(
      shown.map(
        async (f) => [f.id, fundStatusLine(await readValidCache(fileCache, f.id).catch(() => null), now)] as const,
      ),
    ).then((pairs) => {
      if (alive) setLines(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [list, status.version]);

  const goFunds = () => router.push(FUNDS_TAB_PATH);

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <View style={styles.titleWrap}>
          <Text style={styles.title} accessibilityRole="header">내 펀드</Text>
          {status.running && state.kind === 'funds' ? <Text style={styles.checking}>확인 중…</Text> : null}
        </View>
        {state.kind === 'funds' ? (
          <Pressable onPress={goFunds} style={styles.more} accessibilityRole="link" accessibilityLabel="내 펀드 전체 보기">
            <Text style={styles.moreText}>{state.more > 0 ? `전체 ${state.funds.length + state.more}개 보기 ›` : '전체 보기 ›'}</Text>
          </Pressable>
        ) : null}
      </View>

      {state.kind === 'loading' ? (
        <Card style={styles.loading}>
          <ActivityIndicator />
        </Card>
      ) : null}

      {state.kind === 'guest' ? (
        <Card style={styles.banner}>
          <Text style={styles.bannerTitle}>🔒 내 펀드 수익률 확인하기</Text>
          <Text style={styles.bannerText}>로그인하면 내 펀드 수익률과 운용 리포트를 한눈에 볼 수 있어요.</Text>
          <View style={styles.action}>
            <Button label="로그인하고 내 펀드 보기 ›" onPress={openFundLoginSheet} />
          </View>
        </Card>
      ) : null}

      {state.kind === 'empty' ? (
        <Card style={styles.banner}>
          <Text style={styles.bannerTitle}>💰 등록된 펀드가 아직 없어요</Text>
          <Text style={styles.bannerText}>내 펀드를 등록하고 수익률 리포트를 받아보세요.</Text>
          <View style={styles.action}>
            <Button label="+ 내 펀드 등록하기 ›" onPress={goFunds} />
          </View>
        </Card>
      ) : null}

      {state.kind === 'error' ? (
        <Card style={styles.errorRow}>
          <Text style={styles.errorText}>저장된 펀드 목록을 읽지 못했어요</Text>
          <Pressable onPress={goFunds} style={styles.more} accessibilityRole="button">
            <Text style={styles.moreText}>내 펀드 열기 ›</Text>
          </Pressable>
        </Card>
      ) : null}

      {state.kind === 'funds' ? (
        <View style={styles.group}>
          {state.funds.map((f, i) => (
            <Pressable
              key={f.id}
              onPress={() => router.push(`/fund/${f.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${displayName(f)} 리포트 보기`}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowGap, pressed && styles.pressed]}>
              <Text style={styles.emoji}>📈</Text>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>{displayName(f)}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {lines[f.id] || '리포트를 열어 최신 수익률을 확인해 보세요'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.gap(1.5) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleWrap: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(1) },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  checking: { fontSize: 12, color: theme.colors.textSecondary },
  more: { minHeight: 44, justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  loading: { alignItems: 'center', paddingVertical: theme.gap(3) },
  banner: { backgroundColor: theme.colors.surfaceBlue, gap: theme.gap(0.5) },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  bannerText: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
  action: { marginTop: theme.gap(1.5) },
  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
  errorText: { flexShrink: 1, fontSize: 14, color: theme.colors.textSecondary },
  group: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    minHeight: 64,
    paddingHorizontal: theme.gap(2),
    paddingVertical: theme.gap(1.5),
  },
  rowGap: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  pressed: { opacity: 0.7 },
  emoji: { fontSize: 20 },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  rowSub: { fontSize: 13, color: theme.colors.textSecondary, fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 18, color: theme.colors.textSecondary },
}));
