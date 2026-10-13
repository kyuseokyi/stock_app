import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card, formatWon } from '@/ui';

import { claimQuest, getQuests } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { currentPrivateGen, useTradingGameStore } from '../store';
import type { Quest, QuestList } from '../types';
import { Sheet } from './sheet';

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T };

function rewardLabel(q: Quest): string {
  if (q.reward_cash !== null) return `+${formatWon(q.reward_cash)}`;
  if (q.reward_badge !== null) return '🏅 뱃지';
  return '';
}

type QuestCardProps = {
  quest: Quest;
  claiming: boolean;
  onClaim: () => void;
};

function QuestCard({ quest, claiming, onClaim }: QuestCardProps) {
  const done = Math.min(quest.progress, quest.target);
  const pct = quest.target > 0 ? (done / quest.target) * 100 : 0;
  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.texts}>
          <Text style={styles.title}>{quest.title}</Text>
          <Text style={styles.desc}>{quest.description}</Text>
        </View>
        <Text style={styles.reward}>{rewardLabel(quest)}</Text>
      </View>
      <View style={styles.progressRow}>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: quest.target, now: done }}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.count}>
          {done}/{quest.target}
        </Text>
      </View>
      <View style={styles.action}>
        {quest.claimed ? (
          <Button label="받음 ✓" variant="secondary" disabled fullWidth={false} onPress={() => {}} />
        ) : quest.completed ? (
          <Button label="보상 받기" loading={claiming} fullWidth={false} onPress={onClaim} />
        ) : (
          <Button label="진행 중" variant="secondary" disabled fullWidth={false} onPress={() => {}} />
        )}
      </View>
    </Card>
  );
}

/** 퀘스트 시트 — Q1~Q3 진행률·보상 수령·보유 뱃지. 로그인 전용(게임 화면이 비로그인 시 내정보 탭으로 보낸다) */
export function QuestSheet({ onClose }: { onClose: () => void }) {
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading);
  const pushToast = useTradingGameStore((s) => s.pushToast);
  const [state, setState] = useState<Load<QuestList>>({ kind: 'loading' });
  const [claiming, setClaiming] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    getQuests()
      .then((data) => {
        if (!cancelled) setState({ kind: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const claim = async (code: string) => {
    if (claiming !== null) return;
    const gen = currentPrivateGen();
    setClaiming(code);
    try {
      const res = await claimQuest(code);
      setState((s) => {
        if (s.kind !== 'ok') return s;
        const quests = s.data.quests.map((q) => (q.code === res.quest.code ? res.quest : q));
        const badge = res.badge;
        const badges =
          badge && !s.data.badges.some((b) => b.code === badge.code) ? [...s.data.badges, badge] : s.data.badges;
        return { kind: 'ok', data: { quests, badges } };
      });
      if (gen === currentPrivateGen()) {
        void refreshTrading(); // 현금 보상 → 헤더 자본금 반영
        pushToast({ kind: 'info', icon: '🎁', message: '보상을 받았어요' });
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) });
    } finally {
      setClaiming(null);
    }
  };

  return (
    <Sheet title="🎯 퀘스트" onClose={onClose}>
      {state.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator />
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.muted}>{state.message}</Text>
          <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={() => setReloadKey((k) => k + 1)} />
        </View>
      ) : null}
      {state.kind === 'ok' ? (
        <>
          {state.data.quests.map((q) => (
            <QuestCard key={q.code} quest={q} claiming={claiming === q.code} onClaim={() => void claim(q.code)} />
          ))}
          {state.data.badges.length > 0 ? (
            <View style={styles.badges}>
              <Text style={styles.badgeTitle}>보유 뱃지</Text>
              <View style={styles.badgeRow}>
                {state.data.badges.map((b) => (
                  <Text key={b.code} style={styles.badge}>
                    🏅 {b.name}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1.5) },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  desc: { fontSize: 13, color: theme.colors.textSecondary },
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
  count: { width: 40, textAlign: 'right', fontSize: 12, color: theme.colors.textSecondary, fontVariant: ['tabular-nums'] },
  action: { marginTop: theme.gap(1), alignItems: 'flex-end' },
  badges: { gap: theme.gap(1), paddingTop: theme.gap(1) },
  badgeTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  badge: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(0.75),
    overflow: 'hidden',
  },
}));
