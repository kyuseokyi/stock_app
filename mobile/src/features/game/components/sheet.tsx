import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { GameToaster } from './game-toaster';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * 게임 공용 시트 — RN Modal(slide + iOS pageSheet). Android 뒤로가기·iOS 아래로 쓸어 닫기는 onRequestClose.
 * 호출부가 열 때 마운트·닫을 때 언마운트한다(열 때마다 로컬 state 초기화·데이터 새로 로드 — web 모달과 동일).
 * RN Modal 은 별도 창이라 화면의 토스트가 가려지므로 시트 안에 GameToaster 를 함께 둔다.
 */
export function Sheet({ title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  // iOS pageSheet 는 상태바 아래에서 시작하므로 상단 안전영역 불필요. Android(전체 화면)·web 은 top 포함.
  // 주의: safe-area-context 의 SafeAreaView 같은 서드파티 컴포넌트에 Unistyles 스타일을 넘기면 web 에서 배경이 적용되지 않는다
  //       (Unistyles 는 RN 기본 컴포넌트에만 스타일을 바인딩) → RN View + inset 패딩으로 처리.
  const padTop = Platform.OS === 'ios' ? 0 : insets.top;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: padTop, paddingBottom: insets.bottom }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        <GameToaster insetTop={Platform.OS !== 'ios'} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
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
  content: { paddingHorizontal: theme.gap(2.5), paddingBottom: theme.gap(4), gap: theme.gap(1.5) },
}));
