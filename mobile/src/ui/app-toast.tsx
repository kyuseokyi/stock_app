import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { create } from 'zustand';

const TTL_MS = 3_000;

type AppToast = { id: number; message: string };

type AppToastState = {
  toasts: AppToast[];
  show: (message: string) => void;
  dismiss: (id: number) => void;
};

let seq = 0;

/** 앱 전역 토스트(게임 외 화면용 — 게임은 GameToaster). 루트 레이아웃의 <AppToaster/> 가 그린다. */
export const useAppToastStore = create<AppToastState>((set) => ({
  toasts: [],
  show: (message) => set((s) => ({ toasts: [...s.toasts, { id: ++seq, message }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 어디서든 호출 가능한 단축 함수 */
export function showToast(message: string): void {
  useAppToastStore.getState().show(message);
}

function ToastItem({ toast }: { toast: AppToast }) {
  const dismiss = useAppToastStore((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), TTL_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);
  return (
    <Pressable onPress={() => dismiss(toast.id)} accessibilityRole="alert" style={styles.toast}>
      <Text style={styles.message}>{toast.message}</Text>
    </Pressable>
  );
}

/** 하단(탭바 위) 오버레이 토스트 — 각 3초 후 자동 닫힘, 탭하여 닫기 */
export function AppToaster() {
  const toasts = useAppToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.stack, { bottom: insets.bottom + 72 }]}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { position: 'absolute', left: theme.gap(2), right: theme.gap(2), gap: theme.gap(1), zIndex: 50 },
  toast: {
    alignSelf: 'center',
    backgroundColor: theme.colors.text,
    borderRadius: theme.radius.chip,
    paddingVertical: theme.gap(1.25),
    paddingHorizontal: theme.gap(2.5),
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  message: { fontSize: 14, fontWeight: '600', color: theme.colors.background },
}));
