/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 파스텔 테마(C안: 라벤더 바탕 + 핑크·블루) — docs/superpowers/specs/2026-10-14-pastel-theme-design.md
        brand: { DEFAULT: '#6f8ef0', soft: '#e2ecff' }, // 파스텔 블루 CTA / 선택 칩·내 행
        up: { DEFAULT: '#c93a6c', soft: '#fbd6e4' }, // 상승·수익 = 핑크레드 / BUY·수익 배지 배경
        down: { DEFAULT: '#4f73d9', soft: '#d8e3fd' }, // 하락·손실 = 블루 / SELL·손실 배지 배경
        ink: { DEFAULT: '#25223a', muted: '#8e8aa6' }, // 본문 / 보조
        canvas: '#f7f5ff', // 화면 바탕(연 라벤더)
        surface: '#ffffff', // 칩·입력·일반 카드(라벤더 위 흰색)
        pink: { soft: '#fde4ee' }, // 핑크 카드
        sky: { soft: '#e2ecff' }, // 블루 카드
        accent: '#e88ab0', // 내비 선택·배지(핑크 포인트)
        line: '#ebe7f7', // border
        kakao: '#FEE500', // 카카오 로그인 버튼(공급자 가이드 색)
        naver: '#03C75A', // 네이버 로그인 버튼(공급자 가이드 색)
      },
      borderRadius: { card: '20px', btn: '14px', field: '12px' },
    },
  },
  plugins: [],
}
