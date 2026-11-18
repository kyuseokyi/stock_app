import { router } from 'expo-router';
import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button } from '@/ui';

import { closeFundLoginSheet, FUND_LOGIN_DESCRIPTION, FUND_LOGIN_TITLE, FUNDS_TAB_PATH, LOGIN_PATH, useFundLoginSheet } from '../fund-gate';
import { rememberLoginReturn } from '../login-return';

/**
 * 비로그인으로 '내 펀드' 탭·홈 카드를 눌렀을 때의 로그인 안내 시트 — 게임 탭 로그인 시트와 같은 모양.
 * 탭 레이아웃((tabs)/_layout.tsx)이 한 번만 그리고, 열림 상태는 useFundLoginSheet 가 들고 있다.
 */
export function FundLoginSheet() {
  const open = useFundLoginSheet((s) => s.open);
  if (!open) return null;
  const goLogin = () => {
    closeFundLoginSheet();
    rememberLoginReturn(FUNDS_TAB_PATH); // 로그인 성공하면 내 펀드로 자동 복귀(내정보가 1회 소비)
    router.push(LOGIN_PATH);
  };
  return (
    <BottomSheet title={FUND_LOGIN_TITLE} onClose={closeFundLoginSheet}>
      <Text style={styles.text}>{FUND_LOGIN_DESCRIPTION}</Text>
      <Button label="로그인하러 가기" onPress={goLogin} />
      <Button label="닫기" variant="secondary" onPress={closeFundLoginSheet} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: 15, lineHeight: 22, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
}));
