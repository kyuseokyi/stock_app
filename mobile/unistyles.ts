/**
 * Unistyles v3 전역 설정 — 앱 진입 전에 1회 실행되어야 한다(index.ts에서 import).
 * 테마는 OS 라이트/다크에 자동 대응(adaptiveThemes)한다.
 */
import { StyleSheet } from 'react-native-unistyles';

// 모든 테마가 공유하는 값(간격 헬퍼 등). gap(1)=8, gap(2)=16 ...
const shared = {
  gap: (v: number) => v * 8,
};

const lightTheme = {
  colors: {
    background: '#ffffff',
    surface: '#f5f6f8',
    border: '#e2e5ea',
    text: '#0b0d12',
    textSecondary: '#60646c',
    primary: '#208aef',
    up: '#e23f3f', // 상승 = 빨강 (국내 관례)
    down: '#2f6bff', // 하락 = 파랑
  },
  ...shared,
};

const darkTheme = {
  colors: {
    background: '#0b0d12',
    surface: '#16191f',
    border: '#252a32',
    text: '#f5f7fa',
    textSecondary: '#9aa0aa',
    primary: '#3c9bff',
    up: '#ff5b5b',
    down: '#5b8cff',
  },
  ...shared,
};

const appThemes = {
  light: lightTheme,
  dark: darkTheme,
};

const breakpoints = {
  xs: 0, // 필수 baseline
  sm: 300,
  md: 500,
  lg: 800,
  xl: 1200,
};

type AppThemes = typeof appThemes;
type AppBreakpoints = typeof breakpoints;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  settings: {
    adaptiveThemes: true, // OS 색상 모드에 따라 light/dark 자동 전환
  },
  breakpoints,
  themes: appThemes,
});
