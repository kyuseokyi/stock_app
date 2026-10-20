import { DarkTheme, DefaultTheme } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { UnistylesRuntime, useUnistyles } from 'react-native-unistyles';

/**
 * OS 라이트/다크를 따라 앱 테마를 바꾸고, 헤더용 내비게이션 테마를 돌려준다(루트 레이아웃에서 1회 사용).
 *
 * Unistyles 의 adaptiveThemes 는 Android 에서 설정 변경 알림을 받은 뒤 앱 전체(Application)
 * 설정을 읽는데, MainActivity 가 uiMode 변경을 직접 처리(configChanges)하면 그 값이 늦게 갱신돼
 * 한 단계 늦은 테마가 적용된다. RN useColorScheme 은 Activity 의 새 설정을 읽어 정확하므로 이것으로 맞춘다.
 */
export function useSystemTheme() {
  const scheme = useColorScheme();
  const { theme } = useUnistyles();
  // theme 은 렌더마다 새 Proxy 라 의존성으로 쓰지 않고 색 문자열만 쓴다(렌더 중 읽어 테마 변경 구독은 유지)
  const { primary, background, surface: card, text, border } = theme.colors;

  useEffect(() => {
    UnistylesRuntime.setTheme(scheme === 'dark' ? 'dark' : 'light');
  }, [scheme]);

  return useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, primary, background, card, text, border } };
  }, [scheme, primary, background, card, text, border]);
}
