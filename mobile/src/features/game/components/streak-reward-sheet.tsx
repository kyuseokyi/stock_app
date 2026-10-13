import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card, formatWon } from '@/ui';

import { claimStreakReward } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { currentPrivateGen, useTradingGameStore } from '../store';
import type { StreakReward } from '../types';
import { Sheet } from './sheet';

type MilestoneCardProps = {
  reward: StreakReward;
  current: number;
  claiming: boolean;
  onClaim: () => void;
};

function MilestoneCard({ reward, current, claiming, onClaim }: MilestoneCardProps) {
  const done = Math.min(current, reward.milestone);
  const pct = (done / reward.milestone) * 100;
  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>🔥 {reward.milestone}일 연속</Text>
        <Text style={styles.reward}>+{formatWon(reward.amount)}</Text>
      </View>
      <View style={styles.progressRow}>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: reward.milestone, now: done }}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.count}>
          {done}/{reward.milestone}
        </Text>
      </View>
      <View style={styles.action}>
        {reward.claimed ? (
          <Button label="받음 ✓" variant="secondary" disabled fullWidth={false} onPress={() => {}} />
        ) : reward.claimable ? (
          <Button label="보상 받기" loading={claiming} fullWidth={false} onPress={onClaim} />
        ) : (
          <Button label="진행 중" variant="secondary" disabled fullWidth={false} onPress={() => {}} />
        )}
      </View>
    </Card>
  );
}

/** 연속 출석 마일스톤 보상 시트 — 시즌마다 마일스톤별 1회. 로그인 전용(헤더 칩은 로그인·Streak 활성 때만 노출) */
export function StreakRewardSheet({ onClose }: { onClose: () => void }) {
  const streak = useTradingGameStore((s) => s.streak);
  const refreshStreak = useTradingGameStore((s) => s.refreshStreak);
  const setStreak = useTradingGameStore((s) => s.setStreak);
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading);
  const pushToast = useTradingGameStore((s) => s.pushToast);
  const [claiming, setClaiming] = useState<number | null>(null);

  // 퀴즈·주문 후 새로 받을 수 있게 된 보상까지 반영하도록 열 때 최신화
  useEffect(() => {
    void refreshStreak();
  }, [refreshStreak]);

  const claim = async (milestone: number) => {
    if (claiming !== null) return;
    const gen = currentPrivateGen();
    setClaiming(milestone);
    try {
      const res = await claimStreakReward(milestone);
      setStreak(res.streak, gen);
      if (gen === currentPrivateGen()) {
        void refreshTrading(); // 현금 보상 → 헤더 자본금 반영
        pushToast({ kind: 'info', icon: '🎁', message: '보상을 받았어요' });
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) });
      void refreshStreak(); // 끊김·중복 등 서버 상태로 동기화
    } finally {
      setClaiming(null);
    }
  };

  const rewards = streak?.rewards ?? [];
  const current = streak?.current_streak ?? 0;

  return (
    <Sheet title="🔥 연속 출석 보상" onClose={onClose}>
      <Text style={styles.muted}>지금 {current}일 연속 출석 중이에요. 연속이 끊기기 전에 받아야 해요.</Text>
      {rewards.length === 0 ? (
        <View style={styles.state}>
          <Text style={styles.muted}>지금은 받을 수 있는 보상이 없어요</Text>
        </View>
      ) : (
        rewards.map((r) => (
          <MilestoneCard
            key={r.milestone}
            reward={r}
            current={current}
            claiming={claiming === r.milestone}
            onClaim={() => void claim(r.milestone)}
          />
        ))
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: { paddingVertical: theme.gap(5), alignItems: 'center' },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1.5) },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  reward: { fontSize: 14, fontWeight: '600', color: theme.colors.up },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), marginTop: theme.gap(1) },
  track: {
    flex: 1,
    height: 8,
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: theme.radius.chip, backgroundColor: theme.colors.primary },
  count: { width: 48, textAlign: 'right', fontSize: 12, color: theme.colors.textSecondary, fontVariant: ['tabular-nums'] },
  action: { marginTop: theme.gap(1), alignItems: 'flex-end' },
}));
