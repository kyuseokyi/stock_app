import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { fundRefresher, markAddedDuringRun } from '@/features/fund/auto-refresh';
import { ReportView } from '@/features/fund/components/report-view';
import {
  defaultName,
  displayName,
  evalDateOf,
  formatChecked,
  formatValue,
  useFundReport,
  type FundEntry,
} from '@/features/fund/core';
import { fileCache, loadFunds, renameFundAs } from '@/features/fund/fund-store';
import { recordFetched } from '@/features/fund/record';
import { reportColors } from '@/features/fund/report-colors';
import { Button, ListState } from '@/ui';

// 펀드 리포트 — 캐시를 먼저 보여주고 열 때마다 원본을 다시 가져온다(헤더 새로고침 버튼으로 수동 갱신).
export default function FundReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const ownerId = user?.id ?? null;
  // 펀드는 읽은 계정(uid)과 함께 보관 — 계정이 바뀌면 읽는 중(undefined)으로 보고 다시 읽는다
  const [loaded, setLoaded] = useState<{ uid: number; fund: FundEntry | null } | null>(null);
  const fund: FundEntry | null | undefined = loaded !== null && loaded.uid === ownerId ? loaded.fund : undefined; // undefined=읽는 중, null=없음

  useEffect(() => {
    if (ownerId === null) return; // 로그인 안 됨 — 아래 Redirect
    let alive = true;
    const uid = ownerId;
    void loadFunds(uid)
      .then((l) => {
        if (alive) setLoaded({ uid, fund: l.find((f) => f.id === id) ?? null });
      })
      .catch(() => {
        if (alive) setLoaded({ uid, fund: null }); // 목록을 못 읽으면 무한 로딩 대신 '찾을 수 없어요'
      });
    return () => {
      alive = false;
    };
  }, [id, ownerId]);

  const { entry, refreshing, error, refresh, reload } = useFundReport(fund ?? null, fileCache);
  const colors = useMemo(() => reportColors(theme.colors), [theme.colors]);

  // 새로 가져오기에 성공한 회차만 기록(캐시만 보일 때·실패했을 때는 기록하지 않음). 같은 날짜는 덮어쓴다.
  useEffect(() => {
    if (!fund || !entry || refreshing || error) return;
    // 자동 갱신 중이면 백업은 갱신이 끝난 뒤 1번으로 묶는다(먼저 하면 다른 펀드의 오늘 기록이 빠진다)
    const duringRun = fundRefresher.getStatus().running;
    void recordFetched(fund, entry, { backup: !duringRun }).then((added) => {
      if (added && duringRun) markAddedDuringRun();
    });
  }, [fund, entry, refreshing, error]);

  // 자동 갱신이 이 펀드를 새로 가져왔으면 캐시만 다시 읽어 화면에 반영(다시 가져오지 않음)
  useEffect(
    () =>
      fundRefresher.subscribe(() => {
        const s = fundRefresher.getStatus();
        if (!s.running && fund && s.refreshedIds.includes(fund.id)) reload();
      }),
    [fund, reload],
  );

  // 이름 없이 등록한 펀드는 첫 리포트로 기본 이름을 붙여 저장
  // 이 펀드를 읽은 계정(uid)으로 읽고 쓴다 — 도중에 계정이 바뀌면 저장하지 않는다(renameFundAs)
  useEffect(() => {
    if (!loaded || !fund || fund.name || !entry) return;
    const uid = loaded.uid;
    const name = defaultName(entry.report);
    void renameFundAs(uid, fund.id, name)
      .then(() => setLoaded((cur) => (cur && cur.uid === uid && cur.fund?.id === fund.id ? { uid, fund: { ...fund, name } } : cur)))
      .catch(() => {}); // 이름 저장 실패·계정 바뀜은 다음에 열 때 다시 시도된다
  }, [loaded, fund, entry]);

  if (!user) return <Redirect href="/profile" />;

  const openSource = () => {
    if (fund) void Linking.openURL(fund.url);
  };
  const header = (
    <Stack.Screen
      options={{
        title: fund ? displayName(fund) : '펀드 리포트',
        headerRight: () => (
          <View style={styles.headerActions}>
            {fund ? (
              <Pressable
                onPress={() => router.push(`/fund/history/${fund.id}`)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="수익 히스토리"
              >
                <Ionicons name="stats-chart-outline" size={20} color={theme.colors.text} />
              </Pressable>
            ) : null}
            {refreshing ? (
              <ActivityIndicator />
            ) : (
              <Pressable onPress={refresh} hitSlop={8} accessibilityRole="button" accessibilityLabel="새로고침">
                <Ionicons name="refresh" size={20} color={theme.colors.text} />
              </Pressable>
            )}
          </View>
        ),
      }}
    />
  );

  if (fund === undefined) {
    return (
      <View style={styles.flex}>
        {header}
        <ListState mode="loading" />
      </View>
    );
  }
  if (fund === null) {
    return (
      <View style={styles.flex}>
        {header}
        <ListState mode="empty" emoji="🔍" title="펀드를 찾을 수 없어요" hint="목록에서 다시 선택해 주세요." />
      </View>
    );
  }
  if (!entry) {
    return (
      <View style={styles.flex}>
        {header}
        {error === 'format' ? (
          <View style={styles.center}>
            <ListState mode="error" title="원본 형식이 바뀌어 읽을 수 없어요" hint="원본 페이지에서 직접 확인해 주세요." />
            <Button label="원본 열기" variant="secondary" onPress={openSource} />
          </View>
        ) : error ? (
          <ListState
            mode="error"
            title="펀드 현황을 가져오지 못했어요"
            hint="연결을 확인하고 다시 시도해 주세요."
            onRetry={refresh}
          />
        ) : (
          <ListState mode="loading" />
        )}
      </View>
    );
  }

  const evalDate = formatValue('', evalDateOf(entry.report)).text; // YYYY.MM.DD
  return (
    <View style={styles.flex}>
      {header}
      <View style={styles.status}>
        <Text style={styles.evalDate}>{evalDate ? `기준일 ${evalDate}` : entry.report.title}</Text>
        <Text style={styles.checked}>마지막 확인 {formatChecked(entry.fetchedAt, Date.now())}</Text>
      </View>
      {error === 'fetch' ? <Banner text="최신 정보를 못 가져왔어요. 저장된 내용을 보여드려요." /> : null}
      {error === 'format' ? (
        <Banner text="원본 형식이 바뀌어 최신 내용을 읽을 수 없어요." action="원본 열기" onAction={openSource} />
      ) : null}
      {entry.missing.length > 0 ? (
        <Banner text="일부 항목이 빠졌을 수 있어요." action="원본 열기" onAction={openSource} />
      ) : null}
      <ReportView report={entry.report} colors={colors} />
    </View>
  );
}

function Banner({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={styles.bannerAction}>{action} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(2) },
  center: { flex: 1, justifyContent: 'center', padding: theme.gap(2), gap: theme.gap(2) },
  status: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(2),
    paddingBottom: theme.gap(1),
  },
  evalDate: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  checked: { fontSize: 12, color: theme.colors.textSecondary },
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.gap(1),
    marginHorizontal: theme.gap(2),
    marginBottom: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    paddingVertical: theme.gap(1.5),
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.upSoft,
  },
  bannerText: { flexShrink: 1, fontSize: 13, color: theme.colors.text },
  bannerAction: { fontSize: 13, fontWeight: '700', color: theme.colors.up },
}));
