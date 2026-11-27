import { QueryClientProvider } from '@tanstack/react-query';
import { type Href, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppUpdateGate } from '@/features/app-update/components/update-modal'; // 점검·스토어/OTA 업데이트 안내(실패는 조용히)
import { useAuthStore } from '@/features/auth/store';
import { TermsGate } from '@/features/auth/terms-gate'; // 약관 미동의 로그인 사용자 — 닫을 수 없는 동의 시트
import { useBackgroundTasks } from '@/features/fund/background/tasks';
import { useFundAutoRefresh } from '@/features/fund/auto-refresh';
import { useFundSignal } from '@/features/fund/fund-signal';
import { usePushSetup } from '@/features/push/handlers';
import { lastScreenerFeatures } from '@/features/screener/use-screener-features';
import { stockBackHref } from '@/features/screener/visibility';
import { useSystemTheme } from '@/hooks/use-system-theme';
import { getQueryClient } from '@/lib/query-client';
import { ApiProgressBar, AppToaster, HeaderBack } from '@/ui';

/** 탭 밖 화면 헤더 — iOS·Android 같은 모양(꺾쇠 + 가운데 제목). fallback: 푸시·딥링크로 바로 열었을 때 돌아갈 곳.
 *  bottom: 아래 시스템 바(내비게이션 바·홈 인디케이터) 높이 — Android 15+ edge-to-edge 에선 화면이 그 밑까지 그려져
 *  스크롤 끝 내용·하단 입력창이 가려진다. 헤더가 위쪽을 맡으니 아래만 화면 공통으로 비운다(화면별로 챙기지 않게). */
function detail(title: string, fallback: Href | (() => Href), bottom: number) {
  return {
    headerShown: true,
    contentStyle: { paddingBottom: bottom },
    title,
    headerTitleAlign: 'center' as const,
    headerShadowVisible: false,
    headerLeft: () => <HeaderBack fallback={fallback} />,
  };
}

export default function RootLayout() {
  useFundAutoRefresh(); // 실행·복귀 시 등록 펀드 자동 갱신(로그인 상태일 때만)
  useFundSignal(); // 앱이 열려 있을 때 관리자 리포트 업데이트 신호(SSE) → 자동 갱신
  usePushSetup(); // 푸시 채널·알림 탭(→ 펀드 화면 + 강제 갱신)·등록 동기화(설정 안 됐으면 아무 일 없음)
  useBackgroundTasks(); // 정기 백그라운드 기록 등록·해제
  const navTheme = useSystemTheme(); // OS 라이트/다크 → 앱 테마·헤더 색
  const { bottom } = useSafeAreaInsets(); // 상세 화면 아래 시스템 바 여백(detail)
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
    // 가장 바깥 — 시트·모달(AppUpdateGate·TermsGate 등)까지 모두 같은 Query 클라이언트를 본다
    <QueryClientProvider client={getQueryClient()}>
      <ThemeProvider value={navTheme}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="blog/[id]" options={detail('글 상세', '/community', bottom)} />
          <Stack.Screen name="blocked-users" options={detail('차단한 사용자', '/profile', bottom)} />
          <Stack.Screen name="fund/index" options={detail('내 펀드 수익', '/profile', bottom)} />
          <Stack.Screen name="fund/[id]" options={detail('펀드 리포트', '/fund', bottom)} />
          <Stack.Screen name="fund/history/[id]" options={detail('수익 히스토리', '/fund', bottom)} />
          <Stack.Screen name="fund/backup" options={detail('기록 백업', '/fund', bottom)} />
          <Stack.Screen name="market/[kind]/[id]" options={detail('그룹 상세', '/market', bottom)} />
          <Stack.Screen name="stock/[ticker]" options={detail('종목 상세', () => stockBackHref(lastScreenerFeatures()), bottom)} />
        </Stack>
        <AppToaster />
        <ApiProgressBar />
        <AppUpdateGate />
        <TermsGate />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
