// https://docs.expo.dev/guides/using-eslint/ — 실행: npm run lint (= expo lint)
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // 빌드 산출물·네이티브 프로젝트(prebuild)·생성 번들은 검사하지 않는다
    ignores: ['dist/*', 'web-build/*', '.expo/*', 'android/*', 'ios/*', '**/*.generated.ts'],
  },
  {
    // 재발 방지 — 인자 없는 스토어 훅 호출(전체 구독)은 아무 필드가 바뀌어도 다시 그려진다
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'CallExpression[callee.name=/^use[A-Z][A-Za-z]*(Store|Sheet)$/][arguments.length=0]',
        message: '스토어 전체 구독 금지 — useX((s) => s.f) 또는 useX(useShallow((s) => ({ ... }))) 를 쓰세요',
      }],
    },
  },
]);
