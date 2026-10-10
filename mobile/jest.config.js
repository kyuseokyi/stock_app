/** 순수 TS 로직 단위 테스트용. RN 컴포넌트 렌더 테스트는 범위 밖(러너 미신설). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts'], // .test.ts만(순수 로직). .test.tsx(렌더)는 대상 아님
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
