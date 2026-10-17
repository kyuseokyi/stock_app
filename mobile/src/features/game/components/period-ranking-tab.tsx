import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button } from '@/ui';

import { gameErrorMessage } from '../lib/errors';
import { RANKING_REFRESH_MS, useForegroundInterval } from '../lib/foreground-interval';
import { PERIOD_TEXT, rankingRuleText, type RankingPeriod } from '../lib/ranking-period';
import { formatRewardWon, formatWeekRange } from '../lib/weekly';
import { loadPeriodRanking, type PeriodRankingData } from '../ranking-data';
import { useRewardConfig } from '../use-reward-config';

type Props = { period: RankingPeriod; seasonId: number; myUserId: number | null };
type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: PeriodRankingData };

const MEDAL = ['🥇', '🥈', '🥉'];

/** 주간·월간 탭 — 이번 기간·보상 안내·내 순위·직전 기간 Top 3·Top 100. 내 순위·직전 기간은 실패해도 목록은 표시 */
export function PeriodRankingTab({ period, seasonId, myUserId }: Props) {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const rewardConfig = useRewardConfig();
  const text = PERIOD_TEXT[period];
  const epoch = useRef(0); // 조건이 바뀌면 늦게 온 조용한 갱신 응답을 버린다

  useEffect(() => {
    let cancelled = false;
    epoch.current += 1;
    setState({ kind: 'loading' });
    loadPeriodRanking(period, seasonId, myUserId !== null)
      .then((data) => {
        if (!cancelled) setState({ kind: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [period, seasonId, myUserId, reloadKey]);

  // 열려 있는 동안 로딩 표시 없이 갱신(실패하면 기존 목록 유지). 첫 로드 중·오류 화면은 그대로
  useForegroundInterval(() => {
    if (state.kind !== 'ok') return;
    const my = epoch.current;
    loadPeriodRanking(period, seasonId, myUserId !== null, state.data.last)
      .then((data) => {
        if (epoch.current === my) setState({ kind: 'ok', data });
      })
      .catch(() => {});
  }, RANKING_REFRESH_MS);

  if (state.kind === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator />
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.state}>
        <Text style={styles.muted}>{state.message}</Text>
        <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={() => setReloadKey((k) => k + 1)} />
      </View>
    );
  }

  const { board, me, last } = state.data;
  return (
    <View style={styles.wrap}>
      <View>
        {board.start_at && board.end_at ? (
          <Text style={styles.period}>{formatWeekRange(board.start_at, board.end_at)}</Text>
        ) : null}
        <Text style={styles.rule}>
          {rankingRuleText(period, period === 'month' ? rewardConfig.monthly : rewardConfig.weekly)}
        </Text>
      </View>

      {me && me.rank !== null && me.roi !== null ? (
        <View style={[styles.row, styles.mine]}>
          <Text style={styles.name}>
            {text.myRank} <Text style={styles.bold}>{me.rank}위</Text> / {me.total}명
          </Text>
          <AmountText value={me.roi} kind="pct" size={14} weight="600" />
        </View>
      ) : null}

      {last && last.entries.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{text.lastTop}</Text>
          {last.entries.map((e) => (
            <View key={e.rank} style={styles.lastRow}>
              <Text style={styles.medal}>{MEDAL[e.rank - 1] ?? e.rank}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {e.nickname ?? '익명'}
              </Text>
              <AmountText value={e.roi} kind="pct" size={13} weight="500" />
              {e.reward_amount > 0 ? <Text style={styles.reward}>{formatRewardWon(e.reward_amount)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {board.entries.length === 0 ? (
        <Text style={[styles.muted, styles.empty]}>{text.empty}</Text>
      ) : (
        <View>
          {board.entries.map((r) => {
            const mine = myUserId !== null && r.user_id === myUserId;
            return (
              <View key={r.user_id} style={[styles.row, mine && styles.mine]}>
                <Text style={styles.rank}>{r.rank}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {r.nickname ?? '익명'}
                  {mine ? <Text style={styles.me}> 나</Text> : null}
                </Text>
                <AmountText value={r.roi} kind="pct" size={14} weight="600" />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(2) },
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  empty: { paddingVertical: theme.gap(3) },
  period: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  rule: { marginTop: 2, fontSize: 12, color: theme.colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(1.5),
    borderRadius: theme.radius.input,
  },
  mine: { backgroundColor: theme.colors.primarySoft },
  rank: { width: 28, fontSize: 14, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  name: { flex: 1, fontSize: 14, color: theme.colors.text },
  bold: { fontWeight: '700' },
  me: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    padding: theme.gap(1.5),
    gap: theme.gap(0.5),
  },
  cardTitle: { fontSize: 12, fontWeight: '700', color: theme.colors.text },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  medal: { width: 22, fontSize: 14 },
  reward: { fontSize: 12, color: theme.colors.textSecondary },
}));
