import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/store';
import { useBackgroundTasks } from '@/features/fund/background/tasks';
import { useFundAutoRefresh } from '@/features/fund/auto-refresh';
import { useFundSignal } from '@/features/fund/fund-signal';
import { usePushSetup } from '@/features/push/handlers';
import { useSystemTheme } from '@/hooks/use-system-theme';
import { ApiProgressBar, AppToaster } from '@/ui';

export default function RootLayout() {
  useFundAutoRefresh(); // 실행·복귀 시 등록 펀드 자동 갱신(로그인 상태일 때만)
  useFundSignal(); // 앱이 열려 있을 때 관리자 리포트 업데이트 신호(SSE) → 자동 갱신
  usePushSetup(); // 푸시 채널·알림 탭(→ 펀드 화면 + 강제 갱신)·등록 동기화(설정 안 됐으면 아무 일 없음)
  useBackgroundTasks(); // 정기 백그라운드 기록 등록·해제
  const navTheme = useSystemTheme(); // OS 라이트/다크 → 앱 테마·헤더 색
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
    <ThemeProvider value={navTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="blog/[id]" options={{ headerShown: true, title: '글 상세' }} />
        <Stack.Screen name="fund/index" options={{ headerShown: true, title: '내 펀드 수익' }} />
        <Stack.Screen name="fund/[id]" options={{ headerShown: true, title: '펀드 리포트' }} />
        <Stack.Screen name="fund/history/[id]" options={{ headerShown: true, title: '수익 히스토리' }} />
        <Stack.Screen name="fund/backup" options={{ headerShown: true, title: '기록 백업' }} />
        <Stack.Screen name="market/[kind]/[id]" options={{ headerShown: true, title: '그룹 상세' }} />
        <Stack.Screen name="stock/[ticker]" options={{ headerShown: true, title: '종목 상세' }} />
      </Stack>
      <AppToaster />
      <ApiProgressBar />
    </ThemeProvider>
  );
}
