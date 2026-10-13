import { ActivityIndicator, Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { SocialProvider } from './api';

const LABELS: Record<SocialProvider, string> = {
  kakao: '카카오로 시작하기',
  naver: '네이버로 시작하기',
};

type Props = {
  provider: SocialProvider;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

/** 간편 로그인 버튼 — 공급자 가이드 색(카카오 #FEE500/검정, 네이버 #03C75A/흰). 토스 버튼과 같은 높이 56·radius. */
export function SocialButton({ provider, onPress, loading = false, disabled = false }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={LABELS[provider]}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[provider],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}>
      {loading ? (
        <ActivityIndicator color={provider === 'kakao' ? '#191919' : '#ffffff'} />
      ) : (
        <Text style={[styles.label, provider === 'kakao' ? styles.kakaoLabel : styles.naverLabel]}>
          {LABELS[provider]}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  base: {
    height: 56,
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: theme.gap(2),
  },
  kakao: { backgroundColor: '#FEE500' },
  naver: { backgroundColor: '#03C75A' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '700' },
  kakaoLabel: { color: '#191919' },
  naverLabel: { color: '#ffffff' },
}));
