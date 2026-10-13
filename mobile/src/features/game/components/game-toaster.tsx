import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useTradingGameStore, type GameToast } from '../store';

const TTL_MS = 5_000;

function ToastItem({ toast }: { toast: GameToast }) {
  const dismiss = useTradingGameStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), TTL_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);

  return (
    <Pressable
      onPress={() => dismiss(toast.id)}
      accessibilityRole="alert"
      accessibilityHint="탭하면 닫혀요"
      style={[styles.toast, toast.kind === 'error' && styles.error]}>
      <Text style={styles.icon}>{toast.icon}</Text>
      <Text style={styles.message}>{toast.message}</Text>
    </Pressable>
  );
}

type Props = {
  /** 안전영역 상단 여백 적용 여부 — 화면 위 오버레이는 true, 시트(이미 상단 여백 있음) 안에서는 false */
  insetTop?: boolean;
};

/**
 * 게임 넛지/오류 토스트 — 상단 오버레이, 각 5초 후 자동 닫힘, 탭하여 닫기.
 * RN Modal 은 별도 창이라 화면 오버레이가 시트 위로 올라오지 못한다 → 시트(Sheet) 안에도 하나 렌더한다.
 */
export function GameToaster({ insetTop = true }: Props) {
  const toasts = useTradingGameStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.stack, { top: (insetTop ? insets.top : 0) + 8 }]}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { position: 'absolute', left: theme.gap(2), right: theme.gap(2), gap: theme.gap(1), zIndex: 50 },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.gap(1.5),
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  error: { borderColor: theme.colors.up },
  icon: { fontSize: 18 },
  message: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
}));
