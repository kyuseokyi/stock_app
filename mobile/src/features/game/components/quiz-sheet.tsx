import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button, formatWon } from '@/ui';

import { getRandomQuiz, submitQuiz } from '../api';
import { apiErrorCode, gameErrorMessage } from '../lib/errors';
import { quizSecondsLeft } from '../lib/quiz';
import { currentPrivateGen, useTradingGameStore } from '../store';
import type { QuizChoice, QuizQuestion, QuizResult } from '../types';
import { CandleChart } from './candle-chart';
import { Sheet } from './sheet';

const TICK_MS = 200;

// result === null → 0초까지 고르지 않아 제출하지 않은 로컬 시간 초과(정답 미공개)
type Phase =
  | { kind: 'intro' }
  | { kind: 'loading' }
  | { kind: 'playing'; quiz: QuizQuestion; startedAt: number }
  | { kind: 'submitting'; quiz: QuizQuestion; choice: QuizChoice }
  | { kind: 'result'; result: QuizResult | null; choice: QuizChoice | null }
  | { kind: 'error'; message: string; retryable: boolean }
  | { kind: 'exhausted' };

const choiceLabel = (c: QuizChoice): string => (c === 'UP' ? '📈 상승' : '📉 하락');

function rewardLine(r: QuizResult): string | null {
  if (r.rewarded) return `+${formatWon(r.reward_cash)} 지급`;
  if (r.timed_out) return '시간 초과로 보상 없음';
  if (r.correct) return '정답이에요! 이번에는 보상이 지급되지 않았어요 (하루 3회 한도 또는 보상 지급 불가)';
  return null;
}

/**
 * 야간 10초 차트 퀴즈 — intro → loading → playing → submitting → result (오류 시 error). (web ChartQuizModal 과 동일 규칙)
 * 판정은 서버 시각 기준(10초 + 유예 3초). 카운트다운은 연출이며 0초가 되면 제출하지 않고 로컬 시간 초과 처리.
 */
export function QuizSheet({ onClose }: { onClose: () => void }) {
  const markQuizDisabled = useTradingGameStore((s) => s.markQuizDisabled);
  const setStreak = useTradingGameStore((s) => s.setStreak);
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading);
  const pushToast = useTradingGameStore((s) => s.pushToast);
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [now, setNow] = useState(() => Date.now());
  const aliveRef = useRef(true); // 언마운트 후 늦은 응답이 화면 전환·onClose 를 부르지 않도록
  const busyRef = useRef(false); // 시작/제출 중복 탭 방지(리렌더 전 연타 대비)

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 카운트다운 — playing 동안만 200ms 간격 갱신. 단계가 바뀌거나 언마운트되면 정리
  const playing = phase.kind === 'playing';
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [playing]);

  const secondsLeft = phase.kind === 'playing' ? quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, now) : 0;

  // 0초 도달(미선택) → 서버에 제출하지 않고 로컬 시간 초과. playing 에서만 전환(submitting 중엔 무시)
  useEffect(() => {
    if (phase.kind === 'playing' && secondsLeft === 0) setPhase({ kind: 'result', result: null, choice: null });
  }, [phase, secondsLeft]);

  const handleError = (err: unknown) => {
    const code = apiErrorCode(err);
    if (code === 'FEATURE_DISABLED') {
      markQuizDisabled();
      pushToast({ kind: 'info', icon: '🧩', message: gameErrorMessage(err) });
      if (aliveRef.current) onClose();
      return;
    }
    if (!aliveRef.current) return;
    if (code === 'NO_QUIZ_AVAILABLE') setPhase({ kind: 'exhausted' }); // 오류가 아니라 '다 풀었다' 안내
    else setPhase({ kind: 'error', message: gameErrorMessage(err), retryable: true });
  };

  const start = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase({ kind: 'loading' });
    try {
      const quiz = await getRandomQuiz();
      if (!aliveRef.current) return;
      const t = Date.now(); // 응답 도착 시점부터 카운트(서버 served_at 보다 늦게 시작 — 유예 3초가 흡수)
      setNow(t);
      setPhase({ kind: 'playing', quiz, startedAt: t });
    } catch (err) {
      handleError(err);
    } finally {
      busyRef.current = false;
    }
  };

  const choose = async (choice: QuizChoice) => {
    if (phase.kind !== 'playing' || busyRef.current) return;
    if (quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, Date.now()) === 0) return;
    busyRef.current = true;
    const quiz = phase.quiz;
    const gen = currentPrivateGen();
    setPhase({ kind: 'submitting', quiz, choice });
    try {
      const result = await submitQuiz(quiz.id, choice);
      if (result.streak) setStreak(result.streak, gen);
      if (result.rewarded && gen === currentPrivateGen()) void refreshTrading(); // 보상 → 헤더 자본금 반영
      if (aliveRef.current) setPhase({ kind: 'result', result, choice });
    } catch (err) {
      handleError(err);
    } finally {
      busyRef.current = false;
    }
  };

  const footer = (
    <View style={styles.footer}>
      <View style={styles.flex}>
        <Button label="다음 문제" onPress={() => void start()} />
      </View>
      <View style={styles.flex}>
        <Button label="닫기" variant="secondary" onPress={onClose} />
      </View>
    </View>
  );

  return (
    <Sheet title="🧩 야간 10초 차트 퀴즈" onClose={onClose}>
      {phase.kind === 'intro' ? (
        <>
          <View style={styles.rules}>
            <Text style={styles.rule}>📊 날짜·종목을 가린 차트를 보고 5거래일 뒤 주가 방향을 맞혀요.</Text>
            <Text style={styles.rule}>⏱ 제한 시간은 10초. 시간 안에 고르지 않으면 제출되지 않아요.</Text>
            <Text style={styles.rule}>🎁 정답이면 +₩200,000 (보상은 하루 3회까지).</Text>
          </View>
          <Button label="시작" onPress={() => void start()} />
        </>
      ) : null}

      {phase.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator />
          <Text style={styles.muted}>문제를 불러오는 중…</Text>
        </View>
      ) : null}

      {phase.kind === 'playing' || phase.kind === 'submitting' ? (
        <>
          <View style={styles.playHead}>
            <Text style={styles.ask}>5거래일 뒤 주가는?</Text>
            {phase.kind === 'playing' ? (
              <Text
                style={[styles.timer, secondsLeft <= 3 && styles.timerUrgent]}
                accessibilityLiveRegion="polite">
                ⏱ {secondsLeft}초
              </Text>
            ) : (
              <Text style={styles.muted}>채점 중…</Text>
            )}
          </View>
          <View style={styles.chartFrame}>
            <CandleChart candles={phase.quiz.chart_snapshot} height={200} showLabels={false} />
          </View>
          <View style={styles.footer}>
            <Pressable
              disabled={phase.kind !== 'playing'}
              onPress={() => void choose('UP')}
              style={[styles.pick, styles.up, phase.kind !== 'playing' && styles.disabled]}>
              <Text style={[styles.pickLabel, styles.upText]}>오를까? 📈</Text>
            </Pressable>
            <Pressable
              disabled={phase.kind !== 'playing'}
              onPress={() => void choose('DOWN')}
              style={[styles.pick, styles.down, phase.kind !== 'playing' && styles.disabled]}>
              <Text style={[styles.pickLabel, styles.downText]}>내릴까? 📉</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {phase.kind === 'result' && phase.result === null ? (
        <>
          <Text style={styles.headline}>⏰ 시간 초과</Text>
          <Text style={[styles.muted, styles.center]}>선택하지 않아 제출되지 않았어요. 정답은 공개되지 않아요.</Text>
          {footer}
        </>
      ) : null}

      {phase.kind === 'result' && phase.result !== null ? (
        <>
          <Text style={[styles.headline, phase.result.correct && styles.correct]}>
            {phase.result.correct ? '⭕ 정답이에요!' : phase.result.timed_out ? '⏰ 시간 초과' : '❌ 아쉽게 틀렸어요'}
          </Text>
          <View style={styles.lines}>
            <Text style={styles.line}>
              정답 {choiceLabel(phase.result.answer)}
              {phase.choice !== null ? <Text style={styles.muted}> · 내 선택 {choiceLabel(phase.choice)}</Text> : null}
            </Text>
            <View style={styles.inline}>
              <Text style={styles.line}>실제 5일 등락</Text>
              <AmountText value={phase.result.actual_change} kind="pct" size={14} weight="600" />
            </View>
            <Text style={styles.line}>패턴 {phase.result.pattern_type}</Text>
            {rewardLine(phase.result) !== null ? (
              <Text style={phase.result.rewarded ? styles.rewarded : styles.muted}>{rewardLine(phase.result)}</Text>
            ) : null}
          </View>
          <Text style={styles.explain}>{phase.result.explanation}</Text>
          <Text style={styles.meta}>
            종목 {phase.result.ticker} · 기준일 {phase.result.base_date}
          </Text>
          {footer}
        </>
      ) : null}

      {phase.kind === 'exhausted' ? (
        <View style={styles.state}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.ask}>준비된 문제를 모두 풀었어요</Text>
          <Text style={[styles.muted, styles.center]}>매일 밤 9시에 새 문제가 올라와요. 내일 다시 도전해 보세요!</Text>
          <View style={styles.footer}>
            <View style={styles.flex}>
              <Button label="닫기" variant="secondary" onPress={onClose} />
            </View>
          </View>
        </View>
      ) : null}

      {phase.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.line}>{phase.message}</Text>
          <View style={styles.footer}>
            {phase.retryable ? (
              <View style={styles.flex}>
                <Button label="다시 시도" onPress={() => void start()} />
              </View>
            ) : null}
            <View style={styles.flex}>
              <Button label="닫기" variant="secondary" onPress={onClose} />
            </View>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  rules: { gap: theme.gap(1), marginBottom: theme.gap(1) },
  rule: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  state: { paddingVertical: theme.gap(4), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  emoji: { fontSize: 40 },
  center: { textAlign: 'center' },
  playHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ask: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  timer: { fontSize: 18, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  timerUrgent: { color: theme.colors.up },
  chartFrame: {
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.gap(1),
    overflow: 'hidden',
  },
  footer: { flexDirection: 'row', gap: theme.gap(1.5), alignSelf: 'stretch' },
  pick: { flex: 1, height: 56, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center' },
  up: { backgroundColor: theme.colors.upSoft },
  down: { backgroundColor: theme.colors.downSoft },
  upText: { color: theme.colors.up },
  downText: { color: theme.colors.down },
  disabled: { opacity: 0.4 },
  pickLabel: { fontSize: 16, fontWeight: '700' },
  headline: {
    paddingVertical: theme.gap(1.5),
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  correct: { color: theme.colors.up },
  lines: { gap: theme.gap(0.75) },
  line: { fontSize: 14, color: theme.colors.text },
  inline: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  rewarded: { fontSize: 14, fontWeight: '600', color: theme.colors.up },
  explain: {
    fontSize: 14,
    lineHeight: 21,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.input,
    padding: theme.gap(1.5),
    overflow: 'hidden',
  },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
}));
