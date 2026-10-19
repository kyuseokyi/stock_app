import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/store';
import { AppToaster } from '@/ui';

export default function RootLayout() {
  // 앱 시작 시 1회, SecureStore에 저장된 토큰/유저를 복원한다. 복원 전에는 로그아웃 상태로 렌더링된다.
  useEffect(() => {
    // 복원 후 세션 확인(실행 시 1회), 이후 포그라운드 복귀마다(60초 간격 제한) — 만료·다른 기기 로그인 반영
    void useAuthStore
      .getState()
      .hydrate()
      .then(() => useAuthStore.getState().validateSession(true));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void useAuthStore.getState().validateSession();
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="blog/[id]" options={{ headerShown: true, title: '글 상세' }} />
        <Stack.Screen name="fund/index" options={{ headerShown: true, title: '내 펀드 수익' }} />
        <Stack.Screen name="fund/[id]" options={{ headerShown: true, title: '펀드 리포트' }} />
        <Stack.Screen name="fund/history/[id]" options={{ headerShown: true, title: '수익 히스토리' }} />
        <Stack.Screen name="fund/backup" options={{ headerShown: true, title: '기록 백업' }} />
      </Stack>
      <AppToaster />
    </>
  );
}
