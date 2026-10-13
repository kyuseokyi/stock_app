import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button } from '@/ui';

import { getWeeklyLeaderboard, getWeeklyMyRank, getWeeklyResults } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { formatRewardWon, formatWeekRange, WEEKLY_RULE } from '../lib/weekly';
import type { WeeklyBoard, WeeklyMyRank, WeeklyResultWeek } from '../types';

type Props = { seasonId: number; myUserId: number | null };
type Data = { board: WeeklyBoard; me: WeeklyMyRank | null; last: WeeklyResultWeek | null };
type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: Data };

const MEDAL = ['🥇', '🥈', '🥉'];

/** 주간 탭 — 이번 주 기간·내 순위·지난주 Top 3·Top 100. 내 순위·지난주는 실패해도 목록은 표시 */
export function WeeklyRankingTab({ seasonId, myUserId }: Props) {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    Promise.all([
      getWeeklyLeaderboard(seasonId),
      myUserId !== null ? getWeeklyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
      getWeeklyResults(seasonId, 1).catch((): WeeklyResultWeek[] => []),
    ])
      .then(([board, me, results]) => {
        if (!cancelled) setState({ kind: 'ok', data: { board, me, last: results[0] ?? null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId, myUserId, reloadKey]);

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
        <Text style={styles.period}>{formatWeekRange(board.start_at, board.end_at)}</Text>
        <Text style={styles.rule}>{WEEKLY_RULE}</Text>
      </View>

      {me && me.rank !== null && me.weekly_roi !== null ? (
        <View style={[styles.row, styles.mine]}>
          <Text style={styles.name}>
            내 주간 순위 <Text style={styles.bold}>{me.rank}위</Text> / {me.total}명
          </Text>
          <AmountText value={me.weekly_roi} kind="pct" size={14} weight="600" />
        </View>
      ) : null}

      {last && last.entries.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>지난주 Top 3</Text>
          {last.entries.map((e) => (
            <View key={e.rank} style={styles.lastRow}>
              <Text style={styles.medal}>{MEDAL[e.rank - 1] ?? e.rank}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {e.nickname ?? '익명'}
              </Text>
              <AmountText value={e.weekly_roi} kind="pct" size={13} weight="500" />
              {e.reward_amount > 0 ? <Text style={styles.reward}>{formatRewardWon(e.reward_amount)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {board.entries.length === 0 ? (
        <Text style={[styles.muted, styles.empty]}>이번 주 순위가 아직 없어요</Text>
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
                <AmountText value={r.weekly_roi} kind="pct" size={14} weight="600" />
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
