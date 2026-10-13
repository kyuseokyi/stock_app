import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card } from '@/ui';

import { getAcademyQuiz, submitAcademy } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { currentPrivateGen, useTradingGameStore } from '../store';
import type { AcademyQuiz, AcademySubmitResult } from '../types';
import { Sheet } from './sheet';

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T };

/** 아카데미 시트 — 리스크 관리 3문항. 모두 맞히면 5배 레버리지 해금(재응시 무제한). 로그인 전용 */
export function AcademySheet({ onClose }: { onClose: () => void }) {
  const setAcademyUnlocked = useTradingGameStore((s) => s.setAcademyUnlocked);
  const pushToast = useTradingGameStore((s) => s.pushToast);
  const [state, setState] = useState<Load<AcademyQuiz>>({ kind: 'loading' });
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<AcademySubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const gen = currentPrivateGen();
    setState({ kind: 'loading' });
    getAcademyQuiz()
      .then((data) => {
        if (cancelled) return;
        setState({ kind: 'ok', data });
        if (data.unlocked) setAcademyUnlocked(true, gen); // 다른 기기에서 해금한 경우 동기화
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, setAcademyUnlocked]);

  const submit = async () => {
    if (submitting) return;
    const gen = currentPrivateGen();
    setSubmitting(true);
    try {
      const res = await submitAcademy(answers);
      setResult(res);
      if (res.unlocked) {
        setAcademyUnlocked(true, gen);
        pushToast({ kind: 'info', icon: '🔓', message: '5배 레버리지가 해금됐어요' });
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    setAnswers({});
    setResult(null);
  };

  return (
    <Sheet title="🎓 아카데미" onClose={onClose}>
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
      {state.kind === 'ok' && state.data.unlocked && result === null ? (
        <Text style={styles.unlockedBig}>🔓 5배 레버리지가 해금됐어요</Text>
      ) : null}
      {state.kind === 'ok' && (!state.data.unlocked || result !== null) ? (
        <>
          <Text style={styles.muted}>세 문제를 모두 맞히면 5배 레버리지가 열려요.</Text>
          {state.data.questions.map((q, qi) => {
            const r = result?.results.find((x) => x.id === q.id) ?? null;
            const locked = result !== null || submitting;
            return (
              <Card key={q.id}>
                <Text style={styles.question}>
                  {qi + 1}. {q.question}
                  {r ? ` ${r.correct ? '✅' : '❌'}` : ''}
                </Text>
                <View style={styles.choices} accessibilityRole="radiogroup">
                  {q.choices.map((c, ci) => {
                    const selected = answers[q.id] === ci;
                    return (
                      <Pressable
                        key={ci}
                        disabled={locked}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: locked }}
                        onPress={() => setAnswers((a) => ({ ...a, [q.id]: ci }))}
                        style={[styles.choice, selected && styles.choiceOn]}>
                        <View style={[styles.radio, selected && styles.radioOn]} />
                        <Text style={styles.choiceText}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {r ? (
                  <View style={styles.explain}>
                    <Text style={styles.answer}>정답: {q.choices[r.answer] ?? '—'}</Text>
                    <Text style={styles.muted}>{r.explanation}</Text>
                  </View>
                ) : null}
              </Card>
            );
          })}
          {result === null ? (
            <Button
              label="제출"
              disabled={state.data.questions.some((q) => answers[q.id] === undefined)}
              loading={submitting}
              onPress={() => void submit()}
            />
          ) : result.unlocked ? (
            <Text style={styles.unlocked}>🔓 5배 레버리지가 해금됐어요</Text>
          ) : (
            <Button label="다시 도전" variant="secondary" onPress={retry} />
          )}
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  unlockedBig: {
    paddingVertical: theme.gap(5),
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  unlocked: { textAlign: 'center', fontSize: 16, fontWeight: '700', color: theme.colors.primary },
  question: { fontSize: 15, fontWeight: '600', color: theme.colors.text, lineHeight: 22 },
  choices: { gap: theme.gap(0.75), marginTop: theme.gap(1) },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.gap(1),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(1.5),
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.background,
  },
  choiceOn: { backgroundColor: theme.colors.primarySoft },
  radio: {
    width: 18,
    height: 18,
    marginTop: 1,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  radioOn: { borderColor: theme.colors.primary, borderWidth: 6 },
  choiceText: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
  explain: {
    marginTop: theme.gap(1),
    padding: theme.gap(1.5),
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.background,
    gap: theme.gap(0.5),
  },
  answer: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
}));
