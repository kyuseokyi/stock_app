/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#3182f6', soft: '#e8f1fe' }, // 토스 블루 / 연한 포인트
        up: '#f04452', // 상승·수익 = 빨강 (국내 관례)
        down: '#3182f6', // 하락·손실 = 파랑
        ink: { DEFAULT: '#191f28', muted: '#8b95a1' }, // 본문 / 보조
        surface: '#f2f4f6',
        line: '#e5e8eb', // border
      },
      borderRadius: { card: '20px', btn: '14px', field: '12px' },
    },
  },
  plugins: [],
}
