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
  /** 📖 규칙 → 규칙 시트(공개) */
  onOpenRules: () => void;
};

function NavButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.nav, pressed && styles.pressed]}>
      <Text style={styles.navLabel}>{label}</Text>
    </Pressable>
  );
}

/** 시즌·종목·D-day + Streak 칩 + 내 순위/수익률 + 자본금 + 랭킹·퀘스트·퀴즈·규칙 진입 버튼(좁은 화면은 줄바꿈) */
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
  onOpenRules,
}: Props) {
  const dday = daysUntil(season.end_at);
  const rank = myRank?.rank ?? null;
  const roi = myRank?.roi_pct ?? null;
  const showStreak = loggedIn && streak !== null && streak.enabled && streak.current_streak >= 1;

  // 컴팩트: 1줄 종목·시즌 / 2줄 순위·자본금 / 3줄 진입 버튼(한 줄 고정) — 차트가 첫 화면에 크게 들어오게
  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.stock} numberOfLines={1}>
          {season.stock_name} <Text style={styles.ticker}>{season.ticker}</Text>
        </Text>
        <Text style={styles.season}>
          {season.season_number}기{dday !== null ? ` · D-${dday}` : ''}
        </Text>
        {showStreak && streak !== null ? (
          <Pressable
            onPress={onOpenStreak}
            accessibilityRole="button"
            accessibilityLabel={`${streak.current_streak}일 연속 · 최고 기록 ${streak.highest_streak}일 · 연속 출석 보상 보기`}
            style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.streak}>
              🔥{streak.current_streak}
              {streak.rewards.some((r) => r.claimable) ? ' 🎁' : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.statusRow}>
        {!loggedIn ? (
          <Text style={styles.muted} numberOfLines={1}>
            로그인하고 시즌에 참여하세요
          </Text>
        ) : rank !== null ? (
          <View style={styles.inline}>
            <Text style={styles.rank}>{rank}위</Text>
            {roi !== null ? <AmountText value={roi} kind="pct" size={13} /> : null}
          </View>
        ) : (
          <Text style={styles.muted} numberOfLines={1}>
            첫 거래 후 순위가 집계돼요
          </Text>
        )}
        <View style={styles.inline}>
          <Text style={styles.muted}>자본금</Text>
          <Text style={styles.asset}>{account ? formatWon(account.total_asset) : '—'}</Text>
        </View>
      </View>

      <View style={styles.navRow}>
        <NavButton label="🏆 랭킹" onPress={onOpenRanking} />
        <NavButton label="🎯 퀘스트" onPress={onOpenQuest} />
        {showQuiz ? <NavButton label="🧩 퀴즈" onPress={onOpenQuiz} /> : null}
        <NavButton label="📖 규칙" onPress={onOpenRules} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, paddingVertical: theme.gap(1.5), gap: theme.gap(0.75) },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  season: { fontSize: 12, fontWeight: '600', color: theme.colors.primary, marginLeft: 'auto' },
  streak: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.up,
    backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(0.75),
    paddingVertical: 2,
    overflow: 'hidden',
  },
  stock: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: theme.colors.text },
  ticker: { fontSize: 12, fontWeight: '500', color: theme.colors.textSecondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5) },
  rank: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  muted: { flexShrink: 1, fontSize: 12, color: theme.colors.textSecondary },
  asset: { fontSize: 14, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  // 버튼 4개를 한 줄에 균등 배치(줄바꿈 없음)
  navRow: { flexDirection: 'row', gap: theme.gap(0.75) },
  nav: {
    flex: 1,
    alignItems: 'center',
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.fill,
    paddingVertical: theme.gap(0.5),
  },
  pressed: { opacity: 0.7 },
  navLabel: { fontSize: 12, fontWeight: '600', color: theme.colors.text },
}));
