/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 파스텔 테마(C안: 라벤더 바탕 + 흰 카드, 핑크는 포인트·블루는 배너) — docs/superpowers/specs/2026-10-14-pastel-theme-design.md
        // 글자로 쓰는 색은 WCAG 2.2 AA(4.5:1)를 쓰이는 가장 어두운 바탕(fill·brand-soft·각 soft 배지)에서도 넘게 명도만 낮췄다(색상 유지, 2026-10-23 audit).
        // brand: 파스텔 블루 CTA 배경(DEFAULT, 위 글자는 ink — 흰 글자는 3.1:1 미달) / 선택 칩·내 행 배경(soft) / 블루 글자·링크(strong)
        brand: { DEFAULT: '#6f8ef0', soft: '#e2ecff', strong: '#4963c1' },
        up: { DEFAULT: '#b6265d', soft: '#fbd6e4' }, // 상승·수익 = 핑크레드 / BUY·수익 배지 배경
        down: { DEFAULT: '#3c5dc1', soft: '#d8e3fd' }, // 하락·손실 = 블루 / SELL·손실 배지 배경
        ink: { DEFAULT: '#25223a', muted: '#6a6681' }, // 본문 / 보조
        canvas: '#f7f5ff', // 화면 바탕(연 라벤더)
        surface: '#ffffff', // 모든 카드(라벤더 위 흰색)
        fill: '#efebfb', // 칩·입력·드롭다운 트리거 배경(흰 카드 위에서 보이도록)
        sky: { soft: '#e2ecff' }, // 블루 배너(코치·퀴즈)만
        accent: '#aa5278', // 내비 선택 글자·밑줄(핑크 포인트)
        line: '#ebe7f7', // border
        kakao: '#FEE500', // 카카오 로그인 버튼(공급자 가이드 색)
        naver: '#03C75A', // 네이버 로그인 버튼(공급자 가이드 색 — 흰 글자 대비는 낮지만 공식 가이드가 정한 조합이라 유지)
      },
      borderRadius: { card: '20px', btn: '14px', field: '12px' },
    },
  },
  plugins: [],
}
