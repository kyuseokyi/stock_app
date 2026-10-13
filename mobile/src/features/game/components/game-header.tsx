import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Card, formatWon } from '@/ui';

import { daysUntil } from '../lib/format';
import type { Account, MyRank, Season, Streak } from '../types';

type Props = {
  season: Season;
  account: Account | null;
  myRank: MyRank | null;
  loggedIn: boolean;
  streak: Streak | null;
  /** 퀴즈 진입 버튼 노출(서버가 퀴즈 기능을 끈 경우 false) */
  showQuiz: boolean;
  onOpenRanking: () => void;
  onOpenQuest: () => void;
  onOpenQuiz: () => void;
  /** Streak 칩 탭 → 연속 출석 보상 시트 */
  onOpenStreak: () => void;
};

function NavButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.nav, pressed && styles.pressed]}>
      <Text style={styles.navLabel}>{label}</Text>
    </Pressable>
  );
}

/** 시즌·종목·D-day + Streak 칩 + 내 순위/수익률 + 자본금 + 랭킹·퀘스트·퀴즈 진입 버튼 */
export function GameHeader({
  season,
  account,
  myRank,
  loggedIn,
  streak,
  showQuiz,
  onOpenRanking,
  onOpenQuest,
  onOpenQuiz,
  onOpenStreak,
}: Props) {
  const dday = daysUntil(season.end_at);
  const rank = myRank?.rank ?? null;
  const roi = myRank?.roi_pct ?? null;
  const showStreak = loggedIn && streak !== null && streak.enabled && streak.current_streak >= 1;

  return (
    <Card>
      <View style={styles.metaRow}>
        <Text style={styles.season}>
          시즌 {season.season_number}기{dday !== null ? ` · 종료 D-${dday}` : ''}
        </Text>
        {showStreak && streak !== null ? (
          <Pressable
            onPress={onOpenStreak}
            accessibilityRole="button"
            accessibilityLabel={`${streak.current_streak}일 연속 · 최고 기록 ${streak.highest_streak}일 · 연속 출석 보상 보기`}
            style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.streak}>
              🔥 {streak.current_streak}일 연속{streak.rewards.some((r) => r.claimable) ? ' 🎁' : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.stock}>
        {season.stock_name} <Text style={styles.ticker}>({season.ticker})</Text>
      </Text>

      <View style={styles.rankRow}>
        {!loggedIn ? (
          <Text style={styles.muted}>로그인하고 시즌에 참여하세요</Text>
        ) : rank !== null ? (
          <View style={styles.inline}>
            <Text style={styles.rank}>내 순위 {rank}위</Text>
            {roi !== null ? <AmountText value={roi} kind="pct" size={15} /> : null}
          </View>
        ) : (
          <Text style={styles.muted}>첫 거래 후 순위가 집계돼요</Text>
        )}
      </View>

      <View style={styles.inline}>
        <Text style={styles.muted}>자본금</Text>
        <Text style={styles.asset}>{account ? formatWon(account.total_asset) : '—'}</Text>
      </View>

      <View style={styles.navRow}>
        <NavButton label="🏆 랭킹" onPress={onOpenRanking} />
        <NavButton label="🎯 퀘스트" onPress={onOpenQuest} />
        {showQuiz ? <NavButton label="🧩 퀴즈" onPress={onOpenQuiz} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(0.75) },
  season: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
  streak: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.up,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(1),
    paddingVertical: 2,
    overflow: 'hidden',
  },
  stock: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  ticker: { fontSize: 14, fontWeight: '500', color: theme.colors.textSecondary },
  rankRow: { marginTop: theme.gap(0.5) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  rank: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  asset: { fontSize: 17, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1), marginTop: theme.gap(1) },
  nav: {
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.background,
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1.5),
  },
  pressed: { opacity: 0.7 },
  navLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
}));
