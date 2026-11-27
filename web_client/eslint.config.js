// Vite React(TS) 표준 구성 — 실행: npm run lint
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    rules: {
      // React Compiler 대비 규칙 — 기존 화면의 동작하는 패턴을 대량으로 잡으므로
      // 회귀 위험 없이 점진적으로 고치도록 경고로 둔다(화면 수정 시 함께 정리). mobile 과 같은 기준.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
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
])
