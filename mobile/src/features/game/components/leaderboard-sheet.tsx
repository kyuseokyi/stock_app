import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button, Chip } from '@/ui';

import { getHallOfFame, getLeaderboard } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { RANKING_REFRESH_MS, useForegroundInterval } from '../lib/foreground-interval';
import { rankingTabs, type RankingTab } from '../lib/ranking-period';
import type { HallOfFameRow, LeaderboardRow, SeasonPeriod } from '../types';
import { PeriodRankingTab } from './period-ranking-tab';
import { Sheet } from './sheet';

type Tab = RankingTab;
type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T };

type Props = {
  seasonId: number;
  /** 시즌 기간 — quarter 면 월간 탭 노출 */
  seasonPeriod?: SeasonPeriod;
  /** 로그인 유저 id(비로그인 null) — 내 행 강조용 */
  myUserId: number | null;
  onClose: () => void;
};

/** 승률은 0~100 부호 없는 퍼센트(formatPct 는 + 부호를 붙이므로 쓰지 않는다) */
const winRate = (n: number): string => `${n.toFixed(1)}%`;

/** 명예의 전당 행(시즌 desc · 순위 asc 정렬 유지)을 시즌별로 묶는다 */
function groupBySeason(rows: HallOfFameRow[]): { seasonId: number; seasonNumber: number; rows: HallOfFameRow[] }[] {
  const groups: { seasonId: number; seasonNumber: number; rows: HallOfFameRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.seasonId === r.season_id) last.rows.push(r);
    else groups.push({ seasonId: r.season_id, seasonNumber: r.season_number, rows: [r] });
  }
  return groups;
}

/** 랭킹 시트 — 주간 / (분기 시즌) 월간 / 시즌 Top 100 / 명예의 전당(MBTI). 공개 API 라 비로그인도 열람. 열릴 때·탭 전환 시 활성 탭만 로드,
 * 열려 있는 동안 주간·월간·시즌 탭은 15초마다 조용히 갱신(앱이 포그라운드일 때만) */
export function LeaderboardSheet({ seasonId, seasonPeriod, myUserId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('weekly');
  const [board, setBoard] = useState<Load<LeaderboardRow[]>>({ kind: 'loading' });
  const [hof, setHof] = useState<Load<HallOfFameRow[]>>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const epoch = useRef(0); // 탭·시즌이 바뀌면 늦게 온 조용한 갱신 응답을 버린다

  useEffect(() => {
    if (tab === 'weekly' || tab === 'monthly') return; // 주간·월간 탭은 자체 로드(PeriodRankingTab)
    let cancelled = false;
    epoch.current += 1;
    if (tab === 'season') {
      setBoard({ kind: 'loading' });
      getLeaderboard(seasonId)
        .then((data) => {
          if (!cancelled) setBoard({ kind: 'ok', data });
        })
        .catch((err: unknown) => {
          if (!cancelled) setBoard({ kind: 'error', message: gameErrorMessage(err) });
        });
    } else {
      setHof({ kind: 'loading' });
      getHallOfFame()
        .then((data) => {
          if (!cancelled) setHof({ kind: 'ok', data });
        })
        .catch((err: unknown) => {
          if (!cancelled) setHof({ kind: 'error', message: gameErrorMessage(err) });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tab, seasonId, reloadKey]);

  // 시즌 Top 100 은 열려 있는 동안 로딩 표시 없이 갱신(실패하면 기존 목록 유지). 명예의 전당은 바뀌지 않아 제외
  useForegroundInterval(
    () => {
      if (board.kind !== 'ok') return;
      const my = epoch.current;
      getLeaderboard(seasonId)
        .then((data) => {
          if (epoch.current === my) setBoard({ kind: 'ok', data });
        })
        .catch(() => {});
    },
    RANKING_REFRESH_MS,
    tab === 'season',
  );

  const current = tab === 'season' ? board : hof;
  const selfLoading = tab === 'weekly' || tab === 'monthly'; // 자체 로드 탭은 아래 공통 로딩/오류 표시 제외

  return (
    <Sheet title="🏆 랭킹" onClose={onClose}>
      {/* 탭 4개(분기 시즌)도 좁은 화면에서 잘리지 않게 가로 스크롤 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {rankingTabs(seasonPeriod).map((t) => (
          <Chip key={t.key} label={t.label} selected={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </ScrollView>

      {tab === 'weekly' ? <PeriodRankingTab key="week" period="week" seasonId={seasonId} myUserId={myUserId} /> : null}
      {tab === 'monthly' ? <PeriodRankingTab key="month" period="month" seasonId={seasonId} myUserId={myUserId} /> : null}

      {!selfLoading && current.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator />
        </View>
      ) : null}
      {!selfLoading && current.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.muted}>{current.message}</Text>
          <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={() => setReloadKey((k) => k + 1)} />
        </View>
      ) : null}

      {tab === 'season' && board.kind === 'ok' ? (
        board.data.length === 0 ? (
          <Text style={[styles.muted, styles.empty]}>아직 순위가 없어요</Text>
        ) : (
          <View>
            {board.data.map((r) => {
              const mine = myUserId !== null && r.user_id === myUserId;
              return (
                <View key={r.user_id} style={[styles.row, mine && styles.mine]}>
                  <Text style={styles.rank}>{r.rank}</Text>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.nickname ?? '익명'}
                    {mine ? <Text style={styles.me}> 나</Text> : null}
                  </Text>
                  <AmountText value={r.roi_pct} kind="pct" size={14} weight="600" />
                  <Text style={styles.win}>승률 {winRate(r.win_rate)}</Text>
                </View>
              );
            })}
          </View>
        )
      ) : null}

      {tab === 'hof' && hof.kind === 'ok' ? (
        hof.data.length === 0 ? (
          <Text style={[styles.muted, styles.empty]}>아직 명예의 전당이 비어 있어요</Text>
        ) : (
          <View style={styles.groups}>
            {groupBySeason(hof.data).map((g) => (
              <View key={g.seasonId}>
                <Text style={styles.groupTitle}>시즌 {g.seasonNumber}</Text>
                {g.rows.map((r) => (
                  <View key={r.rank} style={styles.row}>
                    <Text style={styles.rank}>{r.rank}</Text>
                    <View style={styles.nameBox}>
                      <Text style={styles.nameText} numberOfLines={1}>
                        {r.nickname}
                      </Text>
                      {r.trading_mbti ? (
                        <Text style={styles.mbti} numberOfLines={1}>
                          {r.trading_mbti}
                        </Text>
                      ) : null}
                    </View>
                    <AmountText value={r.final_roi} kind="pct" size={14} weight="600" />
                    <Text style={styles.win}>승률 {winRate(r.win_rate)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  tabs: { flexDirection: 'row', gap: theme.gap(1) },
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  empty: { paddingVertical: theme.gap(5) },
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
  me: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  nameBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75), minWidth: 0 },
  nameText: { flexShrink: 1, fontSize: 14, color: theme.colors.text },
  mbti: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '500',
    color: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(1),
    paddingVertical: 2,
    overflow: 'hidden',
  },
  win: { width: 76, textAlign: 'right', fontSize: 12, color: theme.colors.textSecondary },
  groups: { gap: theme.gap(2.5) },
  groupTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(0.5) },
}));
