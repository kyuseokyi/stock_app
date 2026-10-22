import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 입력칸이 있는 시트 — 키보드가 올라오면 시트를 밀어 올린다(기본 꺼짐: 기존 시트 동작 그대로) */
  avoidKeyboard?: boolean;
  /** false 면 닫을 수 없는 시트 — ✕·배경 탭·Android 뒤로가기 모두 무시(필수 안내용). 기본 true(기존 동작) */
  dismissible?: boolean;
};

/**
 * 내용 높이만큼만 올라오는 작은 바텀시트 — 확인·선택처럼 짧은 내용용(긴 목록은 game 의 Sheet).
 * 투명 RN Modal + 반투명 배경(탭하면 닫힘), Android 뒤로가기는 onRequestClose.
 * 호출부가 열 때 마운트·닫을 때 언마운트한다.
 */
export function BottomSheet({ title, onClose, children, avoidKeyboard = false, dismissible = true }: Props) {
  const insets = useSafeAreaInsets();
  const Overlay = avoidKeyboard ? KeyboardAvoidingView : View;
  const overlayProps = avoidKeyboard ? { behavior: Platform.OS === 'ios' ? ('padding' as const) : undefined } : {};
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismissible ? onClose : noop}>
      <Overlay style={styles.overlay} {...overlayProps}>
        {dismissible ? (
          <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />
        ) : (
          <View style={styles.backdrop} />
        )}
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            {dismissible && (
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
                <Text style={styles.close}>✕</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.content}>{children}</View>
        </View>
      </Overlay>
    </Modal>
  );
}

const noop = () => {};

const styles = StyleSheet.create((theme) => ({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(37, 34, 58, 0.4)' },
  panel: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.border,
    marginTop: theme.gap(1),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(1.5),
    paddingBottom: theme.gap(1),
  },
  title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  close: { fontSize: 18, color: theme.colors.textSecondary },
  content: { paddingHorizontal: theme.gap(2.5), gap: theme.gap(1.5) },
}));
