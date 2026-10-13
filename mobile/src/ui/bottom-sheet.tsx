import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * 내용 높이만큼만 올라오는 작은 바텀시트 — 확인·선택처럼 짧은 내용용(긴 목록은 game 의 Sheet).
 * 투명 RN Modal + 반투명 배경(탭하면 닫힘), Android 뒤로가기는 onRequestClose.
 * 호출부가 열 때 마운트·닫을 때 언마운트한다.
 */
export function BottomSheet({ title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <View style={styles.content}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

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
