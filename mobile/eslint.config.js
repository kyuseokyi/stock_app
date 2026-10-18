// https://docs.expo.dev/guides/using-eslint/ — 실행: npm run lint (= expo lint)
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // 빌드 산출물·네이티브 프로젝트(prebuild)·생성 번들은 검사하지 않는다
    ignores: ['dist/*', 'web-build/*', '.expo/*', 'android/*', 'ios/*', '**/*.generated.ts'],
  },
]);
