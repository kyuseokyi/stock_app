import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { HistoryView } from '@/features/fund/components/history-view';
import { toHistoryView, type FundHistory, type HistoryRange } from '@/features/fund/core';
import { loadFunds } from '@/features/fund/fund-store';
import { loadHistory } from '@/features/fund/history-store';
import { reportColors } from '@/features/fund/report-colors';
import { Chip, ListState } from '@/ui';

const RANGES: [HistoryRange, string][] = [
  ['1m', '1개월'],
  ['3m', '3개월'],
  ['all', '전체'],
];

// 펀드 수익 히스토리 — 기기에 쌓인 계좌별 기록(차트 + 날짜별 목록). 계좌·기간 선택은 네이티브 칩.
export default function FundHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const [history, setHistory] = useState<FundHistory | null | undefined>(undefined); // undefined=읽는 중, null=펀드 없음
  const [account, setAccount] = useState('');
  const [range, setRange] = useState<HistoryRange>('3m');

  useEffect(() => {
    let alive = true;
    loadFunds()
      .then(async (l) => {
        const f = l.find((x) => x.id === id);
        const h = f ? await loadHistory(f) : null;
        if (alive) setHistory(h);
      })
      .catch(() => {
        if (alive) setHistory(null);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const view = useMemo(() => (history ? toHistoryView(history, account, range) : null), [history, account, range]);
  const colors = useMemo(() => reportColors(theme.colors), [theme.colors]);

  if (!user) return <Redirect href="/profile" />;
  if (history === undefined) {
    return (
      <View style={styles.flex}>
        <ListState mode="loading" />
      </View>
    );
  }
  if (!view) {
    return (
      <View style={styles.flex}>
        <ListState mode="empty" emoji="🔍" title="펀드를 찾을 수 없어요" hint="목록에서 다시 선택해 주세요." />
      </View>
    );
  }
  return (
    <View style={styles.flex}>
      <View style={styles.bar}>
        {view.accounts.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {view.accounts.map((a) => (
              <Chip key={a} label={a} selected={a === view.account} onPress={() => setAccount(a)} />
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.chips}>
          {RANGES.map(([r, label]) => (
            <Chip key={r} label={label} selected={r === range} onPress={() => setRange(r)} />
          ))}
        </View>
      </View>
      <HistoryView view={view} colors={colors} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  bar: { paddingHorizontal: theme.gap(2), paddingTop: theme.gap(1.5), gap: theme.gap(1) },
  chips: { flexDirection: 'row', gap: theme.gap(1) },
}));
