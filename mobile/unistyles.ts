/**
 * Unistyles v3 전역 설정 — 앱 진입 전에 1회 실행되어야 한다(index.ts에서 import).
 * 테마는 OS 라이트/다크에 자동 대응(adaptiveThemes)한다.
 */
import { StyleSheet } from 'react-native-unistyles';

// 모든 테마 공유값. gap(1)=8, gap(2)=16 ...
const shared = {
  gap: (v: number) => v * 8,
  radius: { chip: 999, button: 14, input: 12, card: 20 },
};

const lightTheme = {
  colors: {
    background: '#ffffff',
    surface: '#f2f4f6',
    border: '#e5e8eb',
    text: '#191f28',
    textSecondary: '#8b95a1',
    primary: '#3182f6', // 토스 블루
    primarySoft: '#e8f1fe', // 연한 포인트 배경
    up: '#f04452', // 상승/수익 = 빨강 (국내 관례)
    down: '#3182f6', // 하락/손실 = 파랑
  },
  ...shared,
};

const darkTheme = {
  colors: {
    background: '#17171c',
    surface: '#202127',
    border: '#2b2d33',
    text: '#f4f6f8',
    textSecondary: '#9aa0aa',
    primary: '#4a94f8',
    primarySoft: '#1e2a3d',
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
