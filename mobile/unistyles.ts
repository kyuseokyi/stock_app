/**
 * Unistyles v3 전역 설정 — 앱 진입 전에 1회 실행되어야 한다(index.ts에서 import).
 * 테마는 OS 라이트/다크를 따른다 — 시작 값은 여기서, 이후 변경은 src/hooks/use-system-theme 이 맞춘다
 * (adaptiveThemes 는 Android 에서 한 단계 늦은 테마가 적용돼 쓰지 않음).
 * 팔레트: 파스텔 C안(라벤더 바탕 + 흰 카드, 핑크는 포인트·블루는 배너) — docs/superpowers/specs/2026-10-14-pastel-theme-design.md
 */
import { Appearance } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

// 모든 테마 공유값. gap(1)=8, gap(2)=16 ...
const shared = {
  gap: (v: number) => v * 8,
  radius: { chip: 999, button: 14, input: 12, card: 20 },
};

const lightTheme = {
  colors: {
    background: '#f7f5ff', // 아주 연한 라벤더 바탕
    surface: '#ffffff', // 모든 카드(라벤더 위 흰색)
    fill: '#efebfb', // 칩·입력·드롭다운 트리거 배경(흰 카드 위에서 보이도록)
    surfaceBlue: '#e2ecff', // 블루 배너(코치·퀴즈·안내)만
    border: '#ebe7f7',
    text: '#25223a',
    textSecondary: '#8e8aa6',
    primary: '#6f8ef0', // 파스텔 블루(CTA·선택·링크)
    primarySoft: '#e2ecff', // 선택 칩·내 행 배경
    onPrimary: '#ffffff', // primary·accent 바탕 위 글자
    accent: '#e88ab0', // 핑크 포인트(탭바 선택·배지)
    up: '#c93a6c', // 상승/수익 글자 = 핑크레드 (국내 관례)
    upSoft: '#fbd6e4', // BUY 버튼·수익 배지 배경
    down: '#4f73d9', // 하락/손실 글자 = 블루
    downSoft: '#d8e3fd', // SELL 버튼·손실 배지 배경
  },
  ...shared,
};

const darkTheme = {
  colors: {
    background: '#1a1826',
    surface: '#24212f',
    fill: '#2c2839',
    surfaceBlue: '#222c45',
    border: '#322e40',
    text: '#f3f1fa',
    textSecondary: '#a6a1bd',
    primary: '#9fb4f7',
    primarySoft: '#2a3150',
    onPrimary: '#ffffff',
    accent: '#f0a0c0',
    up: '#ff7aa2',
    upSoft: '#3d2230',
    down: '#8aa4ff',
    downSoft: '#23305a',
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
    // 시작 테마 = OS 색상 모드. 실행 중 변경은 useSystemTheme(루트 레이아웃)이 setTheme 으로 반영
    initialTheme: () => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'),
  },
  breakpoints,
  themes: appThemes,
});
