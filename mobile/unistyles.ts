/**
 * Unistyles v3 전역 설정 — 앱 진입 전에 1회 실행되어야 한다(index.ts에서 import).
 * 테마는 OS 라이트/다크에 자동 대응(adaptiveThemes)한다.
 * 팔레트: 파스텔 C안(라벤더 바탕 + 핑크·블루) — docs/superpowers/specs/2026-10-14-pastel-theme-design.md
 */
import { StyleSheet } from 'react-native-unistyles';

// 모든 테마 공유값. gap(1)=8, gap(2)=16 ...
const shared = {
  gap: (v: number) => v * 8,
  radius: { chip: 999, button: 14, input: 12, card: 20 },
};

const lightTheme = {
  colors: {
    background: '#f7f5ff', // 아주 연한 라벤더 바탕
    surface: '#ffffff', // 칩·입력·일반 카드(라벤더 위 흰색)
    surfacePink: '#fde4ee', // 핑크 카드
    surfaceBlue: '#e2ecff', // 블루 카드
    border: '#ebe7f7',
    text: '#25223a',
    textSecondary: '#8e8aa6',
    primary: '#6f8ef0', // 파스텔 블루(CTA·선택·링크)
    primarySoft: '#e2ecff', // 선택 칩·내 행 배경
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
    surfacePink: '#3a2433',
    surfaceBlue: '#222c45',
    border: '#322e40',
    text: '#f3f1fa',
    textSecondary: '#a6a1bd',
    primary: '#9fb4f7',
    primarySoft: '#2a3150',
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
    adaptiveThemes: true, // OS 색상 모드에 따라 light/dark 자동 전환
  },
  breakpoints,
  themes: appThemes,
});
