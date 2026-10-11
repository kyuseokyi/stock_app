# 모바일 토스 디자인 토대 + 네비게이션 재편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일 앱을 토스 라이트 디자인 언어로 통일하고, 하단 탭을 게임 중심(홈·블로그·게임·내정보)으로 재편한다.

**Architecture:** Unistyles v3 토큰(`unistyles.ts`)을 토스 팔레트로 갱신 → `src/ui/`에 재사용 공통 컴포넌트를 둠 → expo-router `(tabs)`에서 스크리너·관심종목을 제거하고 게임 탭 스켈레톤을 추가 → 기존 화면을 공통 컴포넌트/토큰으로 이행. 게임 플레이 실시간·간편로그인·내정보 게임데이터는 **범위 밖**(백엔드 선행 후속 계획).

**Tech Stack:** React Native 0.86 / Expo SDK 57 / expo-router / react-native-unistyles v3 / Zustand / TypeScript. 테스트: 순수 로직은 jest-expo 단위 테스트, 컴포넌트/화면은 `npx tsc --noEmit` + `npx expo lint` + 실기기 육안 검증(프로젝트 관례상 RN 렌더 테스트 러너는 신설하지 않음).

**관련 문서:** 스펙 [`docs/superpowers/specs/2026-10-08-mobile-screen-architecture-design.md`], 디자인 언어 [`docs/mobile_design_language.md`].

---

## 작업 전 공통 메모 (엔지니어용)

- 모든 명령은 `mobile/`에서 실행. 경로는 리포 루트 기준 표기.
- 색·간격은 **반드시 `theme.colors.*` / `theme.gap()` / `theme.radius.*`** 토큰 사용. 하드코딩 금지.
- Import alias `@/` = `mobile/src/`.
- 실기기 검증 환경은 이미 구성됨(로컬 blog:8000/auth:8001 + adb reverse + `com.stockapp.dev`). HMR이 반영 안 되면 앱 하드 리로드(기기에서 앱 재실행).
- 커밋 메시지 말미에 항상:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```

---

## File Structure

| 파일 | 책임 | 신규/수정 |
| :-- | :-- | :-- |
| `mobile/unistyles.ts` | 테마 토큰(컬러/간격/모서리) | 수정 |
| `mobile/src/ui/format.ts` | 금액·% 포맷 순수 함수 | 신규 |
| `mobile/src/ui/format.test.ts` | format 단위 테스트 | 신규 |
| `mobile/src/ui/amount-text.tsx` | 부호·색 포함 금액/% 텍스트 | 신규 |
| `mobile/src/ui/button.tsx` | 풀폭 CTA/보조 버튼 | 신규 |
| `mobile/src/ui/chip.tsx` | pill 칩(선택 토글) | 신규 |
| `mobile/src/ui/card.tsx` | surface 카드 래퍼 | 신규 |
| `mobile/src/ui/list-row.tsx` | 제목+값+`›` 리스트 행 | 신규 |
| `mobile/src/ui/list-state.tsx` | 로딩/빈/에러 상태 뷰 | 신규 |
| `mobile/src/ui/index.ts` | ui 배럴 export | 신규 |
| `mobile/jest.config.js`, `package.json` | jest-expo 테스트 셋업 | 신규/수정 |
| `mobile/src/app/(tabs)/_layout.tsx` | 탭 4개 등록·순서·아이콘 | 수정 |
| `mobile/src/app/(tabs)/game.tsx` | 게임 탭 스켈레톤 | 신규 |
| `mobile/src/app/(tabs)/screener.tsx` | 제거 | 삭제 |
| `mobile/src/app/(tabs)/watchlist.tsx` | 제거 | 삭제 |
| `mobile/src/app/(tabs)/profile.tsx` | 마이페이지 이행(토스 스타일 + 준비중 행) | 수정 |
| `mobile/src/features/blog/blog-card.tsx` | Card 컴포넌트 사용으로 이행 | 수정 |

---

## Task 1: jest-expo 단위 테스트 하네스

**Files:**
- Modify: `mobile/package.json`
- Create: `mobile/jest.config.js`
- Create: `mobile/src/ui/sanity.test.ts` (셋업 검증용, Task 3에서 제거)

- [ ] **Step 1: jest-expo 설치**

Run:
```bash
cd mobile && npx expo install jest-expo jest && npm i -D @types/jest
```
Expected: devDependencies에 `jest-expo`, `jest`, `@types/jest` 추가.

- [ ] **Step 2: jest 설정 작성**

Create `mobile/jest.config.js`:
```js
/** 순수 TS 로직 단위 테스트용. RN 컴포넌트 렌더 테스트는 범위 밖(러너 미신설). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts'], // .test.ts만(순수 로직). .test.tsx(렌더)는 대상 아님
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
```

- [ ] **Step 3: package.json에 test 스크립트 추가**

`mobile/package.json`의 `scripts`에 추가:
```json
"test": "jest"
```

- [ ] **Step 4: 셋업 검증 테스트 작성**

Create `mobile/src/ui/sanity.test.ts`:
```ts
test('jest 셋업 동작', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: 테스트 실행(통과 확인)**

Run: `cd mobile && npm test`
Expected: PASS (1 test). 실패 시 jest-expo 버전/transform 문제 → `preset`이 `jest-expo`인지, Node 버전 확인.

- [ ] **Step 6: 커밋**

```bash
git add mobile/package.json mobile/jest.config.js mobile/src/ui/sanity.test.ts
git commit -m "test(mobile): jest-expo 단위 테스트 하네스 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 2: 디자인 토큰 갱신 (토스 팔레트)

**Files:**
- Modify: `mobile/unistyles.ts`

- [ ] **Step 1: 토큰 교체/추가**

`mobile/unistyles.ts`의 `shared`, `lightTheme`, `darkTheme`를 아래로 교체:
```ts
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
```

- [ ] **Step 2: 타입체크**

Run: `cd mobile && npx tsc --noEmit`
Expected: 통과. (기존 화면들은 `primary`/`up` 토큰을 쓰므로 자동으로 새 색상이 반영됨. `primarySoft`/`radius`는 신규라 아직 미사용이어도 OK)

- [ ] **Step 3: 실기기 확인**

기기에서 기존 홈/블로그/내정보의 포인트 색이 토스 블루로 바뀌었는지 육안 확인.

- [ ] **Step 4: 커밋**

```bash
git add mobile/unistyles.ts
git commit -m "feat(mobile): 토스 디자인 토큰 적용(primary #3182f6, up #f04452, primarySoft, radius)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 3: 금액/% 포맷 순수 함수 (TDD)

**Files:**
- Create: `mobile/src/ui/format.ts`
- Create: `mobile/src/ui/format.test.ts`
- Delete: `mobile/src/ui/sanity.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `mobile/src/ui/format.test.ts`:
```ts
import { formatWon, formatSignedWon, formatPct } from './format';

describe('formatWon', () => {
  test('천단위 콤마 + 원화 기호', () => {
    expect(formatWon(12450000)).toBe('₩12,450,000');
  });
  test('0', () => {
    expect(formatWon(0)).toBe('₩0');
  });
});

describe('formatSignedWon', () => {
  test('양수는 + 부호', () => {
    expect(formatSignedWon(180000)).toBe('+₩180,000');
  });
  test('음수는 - 부호(절대값 표기)', () => {
    expect(formatSignedWon(-42000)).toBe('-₩42,000');
  });
  test('0은 부호 없음', () => {
    expect(formatSignedWon(0)).toBe('₩0');
  });
});

describe('formatPct', () => {
  test('양수 + 부호, 소수 1자리', () => {
    expect(formatPct(14.4)).toBe('+14.4%');
  });
  test('음수', () => {
    expect(formatPct(-3.25)).toBe('-3.3%');
  });
  test('0', () => {
    expect(formatPct(0)).toBe('0.0%');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npm test -- format`
Expected: FAIL ("Cannot find module './format'").

- [ ] **Step 3: 구현**

Create `mobile/src/ui/format.ts`:
```ts
/** 금액/퍼센트 표기 순수 함수. 숫자는 또렷하게, 부호/색은 호출부(AmountText)에서. */

const won = (abs: number): string => `₩${Math.round(abs).toLocaleString('en-US')}`;

/** 부호 없는 원화. 예: 12450000 → "₩12,450,000" */
export function formatWon(value: number): string {
  return won(Math.abs(value));
}

/** 부호 있는 원화. 예: 180000 → "+₩180,000", -42000 → "-₩42,000", 0 → "₩0" */
export function formatSignedWon(value: number): string {
  if (value === 0) return won(0);
  const sign = value > 0 ? '+' : '-';
  return `${sign}${won(Math.abs(value))}`;
}

/** 부호 있는 퍼센트(소수 1자리). 예: 14.4 → "+14.4%", -3.25 → "-3.3%", 0 → "0.0%" */
export function formatPct(value: number): string {
  const fixed = Math.abs(value).toFixed(1);
  if (value === 0) return `0.0%`;
  const sign = value > 0 ? '+' : '-';
  return `${sign}${fixed}%`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npm test -- format`
Expected: PASS (9 assertions). 주의: `toLocaleString('en-US')`로 콤마를 보장(기기 로캘 무관).

- [ ] **Step 5: 셋업용 임시 테스트 제거**

```bash
rm mobile/src/ui/sanity.test.ts
```

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/ui/format.ts mobile/src/ui/format.test.ts && git rm --cached mobile/src/ui/sanity.test.ts 2>/dev/null; rm -f mobile/src/ui/sanity.test.ts
git commit -m "feat(mobile): 금액/퍼센트 포맷 순수 함수 + 단위 테스트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 4: AmountText 컴포넌트

**Files:**
- Create: `mobile/src/ui/amount-text.tsx`

- [ ] **Step 1: 구현**

Create `mobile/src/ui/amount-text.tsx`:
```tsx
import { Text, type TextStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { formatPct, formatSignedWon, formatWon } from './format';

type Props = {
  value: number;
  kind: 'won' | 'pct'; // 원화 / 퍼센트
  signed?: boolean; // 부호+등락색 적용(won에서 의미, pct는 항상 부호)
  size?: number;
  weight?: TextStyle['fontWeight'];
};

/** 금액/수익률 텍스트. signed면 up(빨강)/down(파랑)으로 색을 입힌다. */
export function AmountText({ value, kind, signed = false, size = 16, weight = '700' }: Props) {
  const { theme } = useUnistyles();
  const colored = signed || kind === 'pct';
  const color = !colored
    ? theme.colors.text
    : value > 0
      ? theme.colors.up
      : value < 0
        ? theme.colors.down
        : theme.colors.textSecondary;
  const label =
    kind === 'pct' ? formatPct(value) : signed ? formatSignedWon(value) : formatWon(value);
  return <Text style={{ color, fontSize: size, fontWeight: weight }}>{label}</Text>;
}
```

- [ ] **Step 2: 타입체크**

Run: `cd mobile && npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 3: 커밋**

```bash
git add mobile/src/ui/amount-text.tsx
git commit -m "feat(mobile): AmountText(부호+등락색 금액/% 텍스트)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 5: Button 컴포넌트 (풀폭 CTA/보조)

**Files:**
- Create: `mobile/src/ui/button.tsx`

- [ ] **Step 1: 구현**

Create `mobile/src/ui/button.tsx`:
```tsx
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
};

/** 토스 스타일 버튼. primary=블루 풀폭 CTA, secondary=회색. 높이 56, radius 14. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = true,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#ffffff' : undefined} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  base: {
    height: 56,
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.gap(2),
  },
  fullWidth: { alignSelf: 'stretch' },
  primary: { backgroundColor: theme.colors.primary },
  secondary: { backgroundColor: theme.colors.surface },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '700' },
  primaryLabel: { color: '#ffffff' },
  secondaryLabel: { color: theme.colors.text },
}));
```

- [ ] **Step 2: 타입체크**

Run: `cd mobile && npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 3: 커밋**

```bash
git add mobile/src/ui/button.tsx
git commit -m "feat(mobile): Button(토스 풀폭 CTA/보조)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 6: Chip 컴포넌트

**Files:**
- Create: `mobile/src/ui/chip.tsx`

- [ ] **Step 1: 구현**

Create `mobile/src/ui/chip.tsx`:
```tsx
import { Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
};

/** pill 칩. 선택 시 primarySoft 배경 + primary 글씨. 보드/비중/배율 선택에 사용. */
export function Chip({ label, selected = false, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.label, selected && styles.labelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    borderRadius: theme.radius.chip,
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1.5),
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.primarySoft },
  label: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  labelOn: { color: theme.colors.primary },
}));
```

- [ ] **Step 2: 타입체크**

Run: `cd mobile && npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 3: 커밋**

```bash
git add mobile/src/ui/chip.tsx
git commit -m "feat(mobile): Chip(pill 선택 칩)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 7: Card + ListRow 컴포넌트

**Files:**
- Create: `mobile/src/ui/card.tsx`
- Create: `mobile/src/ui/list-row.tsx`

- [ ] **Step 1: Card 구현**

Create `mobile/src/ui/card.tsx`:
```tsx
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** surface 배경 카드. radius 20, padding gap(2). 강조 정보에만 사용. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: theme.gap(2),
    gap: theme.gap(0.5),
  },
}));
```

- [ ] **Step 2: ListRow 구현**

Create `mobile/src/ui/list-row.tsx`:
```tsx
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useUnistyles } from 'react-native-unistyles';

type Props = {
  title: string;
  subtitle?: string;
  left?: ReactNode; // 아이콘/이모지
  right?: ReactNode; // 값(없으면 chevron만)
  onPress?: () => void;
  disabled?: boolean; // "준비 중" 등 비활성
};

/** 제목+보조문구 좌측, 값+chevron 우측. 높이 ≥56, 구분선 대신 여백. */
export function ListRow({ title, subtitle, left, right, onPress, disabled = false }: Props) {
  const { theme } = useUnistyles();
  const Wrapper: typeof Pressable | typeof View = onPress && !disabled ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress && !disabled ? onPress : undefined}
      style={[styles.row, disabled && styles.rowDisabled]}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.right}>
        {right}
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    paddingVertical: theme.gap(1),
  },
  rowDisabled: { opacity: 0.4 },
  left: { width: 28, alignItems: 'center' },
  center: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  subtitle: { fontSize: 13, color: theme.colors.textSecondary },
  right: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5) },
}));
```

- [ ] **Step 3: 타입체크**

Run: `cd mobile && npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add mobile/src/ui/card.tsx mobile/src/ui/list-row.tsx
git commit -m "feat(mobile): Card + ListRow 컴포넌트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 8: ListState (로딩/빈/에러) + ui 배럴

**Files:**
- Create: `mobile/src/ui/list-state.tsx`
- Create: `mobile/src/ui/index.ts`

- [ ] **Step 1: ListState 구현**

Create `mobile/src/ui/list-state.tsx`:
```tsx
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button } from './button';

type Props =
  | { mode: 'loading' }
  | { mode: 'empty'; emoji?: string; title: string; hint?: string }
  | { mode: 'error'; title?: string; hint?: string; onRetry?: () => void };

/** 화면 중앙 상태 뷰. 토스식 구어체 기본 문구. */
export function ListState(props: Props) {
  return (
    <View style={styles.center}>
      {props.mode === 'loading' && (
        <>
          <ActivityIndicator />
          <Text style={styles.hint}>불러오고 있어요…</Text>
        </>
      )}
      {props.mode === 'empty' && (
        <>
          {props.emoji ? <Text style={styles.emoji}>{props.emoji}</Text> : null}
          <Text style={styles.title}>{props.title}</Text>
          {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
        </>
      )}
      {props.mode === 'error' && (
        <>
          <Text style={styles.title}>{props.title ?? '불러오지 못했어요'}</Text>
          {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
          {props.onRetry ? (
            <View style={styles.retry}>
              <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={props.onRetry} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.gap(1),
    padding: theme.gap(3),
    backgroundColor: theme.colors.background,
  },
  emoji: { fontSize: 40 },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text, textAlign: 'center' },
  hint: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  retry: { marginTop: theme.gap(1) },
}));
```

- [ ] **Step 2: 배럴 export 작성**

Create `mobile/src/ui/index.ts`:
```ts
export { AmountText } from './amount-text';
export { Button } from './button';
export { Card } from './card';
export { Chip } from './chip';
export { ListRow } from './list-row';
export { ListState } from './list-state';
export { formatPct, formatSignedWon, formatWon } from './format';
```

- [ ] **Step 3: 타입체크**

Run: `cd mobile && npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add mobile/src/ui/list-state.tsx mobile/src/ui/index.ts
git commit -m "feat(mobile): ListState 상태뷰 + ui 배럴 export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 9: 게임 탭 스켈레톤 화면

**Files:**
- Create: `mobile/src/app/(tabs)/game.tsx`

> 백엔드(실시간 체결/WS) 미구현이므로 **정적 스켈레톤**만. 추후 후속 계획에서 실시간 차트·주문·게이팅으로 대체한다. 지금은 "시즌 준비 중" 빈 상태 + 주문 패널 미리보기(비활성).

- [ ] **Step 1: 구현**

Create `mobile/src/app/(tabs)/game.tsx`:
```tsx
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card, Chip, ListState } from '@/ui';

export default function GameScreen() {
  const insets = useSafeAreaInsets();
  // 백엔드 미연동 — 시즌 없음 상태로 고정(스켈레톤)
  const seasonReady = false;

  if (!seasonReady) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <Text style={styles.header}>트레이딩 게임</Text>
        <ListState
          mode="empty"
          emoji="🎮"
          title="시즌을 준비하고 있어요"
          hint="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
        />
      </View>
    );
  }

  // 아래는 추후 실시간 데이터로 교체될 주문 패널 미리보기(현재 도달 불가)
  return (
    <ScrollView style={styles.flex} contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, gap: 12 }}>
      <Text style={styles.header}>트레이딩 게임</Text>
      <Card>
        <Text style={styles.cardTitle}>주문 패널 (미리보기)</Text>
        <View style={styles.chips}>
          <Chip label="25%" onPress={() => {}} />
          <Chip label="50%" onPress={() => {}} />
          <Chip label="100%" selected onPress={() => {}} />
        </View>
        <View style={styles.chips}>
          <Chip label="1x" selected onPress={() => {}} />
          <Chip label="2x" onPress={() => {}} />
          <Chip label="5x 🔒" onPress={() => {}} />
        </View>
        <Button label="🔴 BUY (상승 베팅)" onPress={() => {}} />
        <Button label="🔵 SELL (하락 베팅)" variant="secondary" onPress={() => {}} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(2),
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(1) },
  chips: { flexDirection: 'row', gap: theme.gap(1), marginBottom: theme.gap(1) },
}));
```

- [ ] **Step 2: 타입체크**

Run: `cd mobile && npx tsc --noEmit`
Expected: 통과. (`seasonReady`가 `false` 상수라 하단 미리보기 블록은 "도달 불가"지만 타입/렌더 검증용으로 유지)

- [ ] **Step 3: 커밋**

```bash
git add "mobile/src/app/(tabs)/game.tsx"
git commit -m "feat(mobile): 게임 탭 스켈레톤(시즌 준비중 빈 상태 + 주문 패널 미리보기)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 10: 탭 재편 — 스크리너·관심종목 제거, 게임 추가, 순서 변경

**Files:**
- Modify: `mobile/src/app/(tabs)/_layout.tsx`
- Delete: `mobile/src/app/(tabs)/screener.tsx`, `mobile/src/app/(tabs)/watchlist.tsx`
- Delete(사용처 소멸 시): `mobile/src/components/screen-placeholder.tsx`

> expo-router는 `(tabs)/`의 모든 파일을 라우트로 자동 등록한다. 따라서 **파일 삭제 + `_layout`의 `Tabs.Screen` 제거**를 함께 해야 탭에서 사라진다.

- [ ] **Step 1: 플레이스홀더 화면 파일 삭제**

```bash
cd mobile && rm "src/app/(tabs)/screener.tsx" "src/app/(tabs)/watchlist.tsx"
```

- [ ] **Step 2: `_layout.tsx` 교체(탭 4개, 순서 홈·블로그·게임·내정보)**

Replace entire `mobile/src/app/(tabs)/_layout.tsx` with:
```tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

export default function TabsLayout() {
  const { theme } = useUnistyles();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="blog"
        options={{
          title: '블로그',
          tabBarIcon: ({ color, size }) => <Ionicons name="newspaper-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="game"
        options={{
          title: '게임',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="game-controller-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '내정보',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 3: screen-placeholder 참조 소멸 확인 후 삭제**

Run: `cd mobile && grep -rn "screen-placeholder\|ScreenPlaceholder" src`
Expected: 결과 없음(스크리너/관심종목만 사용했음). 결과 없으면:
```bash
rm mobile/src/components/screen-placeholder.tsx
```
(만약 다른 참조가 있으면 삭제하지 말고 그대로 둔다.)

- [ ] **Step 4: 타입체크 + lint**

Run: `cd mobile && npx tsc --noEmit && npx expo lint`
Expected: 통과. 삭제된 파일 참조로 인한 에러 없어야 함.

- [ ] **Step 5: 실기기 확인**

기기에서 하단 탭이 **홈 · 블로그 · 게임 · 내정보** 4개·순서대로 보이고, 게임 탭이 "시즌 준비중" 화면을 띄우는지 확인. (HMR 미반영 시 앱 하드 리로드)

- [ ] **Step 6: 커밋**

```bash
git add -A "mobile/src/app/(tabs)" mobile/src/components
git commit -m "feat(mobile): 하단 탭 재편(홈·블로그·게임·내정보), 스크리너·관심종목 제거

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 11: blog-card → Card 컴포넌트 이행

**Files:**
- Modify: `mobile/src/features/blog/blog-card.tsx`

> 기존 카드 스타일(테두리 포함)을 공통 `Card`로 교체해 톤 통일. `stripHtml`/`fmtDate` 순수 함수와 라우팅은 유지.

- [ ] **Step 1: Pressable 래퍼 유지 + 내부를 Card로 교체**

`mobile/src/features/blog/blog-card.tsx`의 `BlogCard` 함수 본문과 styles를 아래로 교체(상단 import와 `stripHtml`/`fmtDate`는 유지하되, import에 Card 추가):
```tsx
import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card } from '@/ui';
import type { BlogPost } from './types';

// stripHtml, fmtDate 는 기존 그대로 유지 (이 블록 위에 존재)

export function BlogCard({ post }: { post: BlogPost }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/blog/${post.id}`)}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <Card>
        <Text style={styles.title} numberOfLines={1}>
          {post.title}
        </Text>
        <Text style={styles.snippet} numberOfLines={2}>
          {stripHtml(post.content)}
        </Text>
        <Text style={styles.meta}>
          조회 {post.viewCount} · {fmtDate(post.createdAt)}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  title: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  snippet: { fontSize: 13, lineHeight: 18, color: theme.colors.textSecondary },
  meta: { marginTop: theme.gap(0.5), fontSize: 12, color: theme.colors.textSecondary },
}));
```
> 주의: 파일 상단의 기존 `import` 2줄(`Pressable, Text, View` → `View` 제거)과 중복 `useRouter`/`StyleSheet` import가 한 번만 있도록 정리. `stripHtml`/`fmtDate` export는 그대로 둔다(상세 화면에서 사용 가능).

- [ ] **Step 2: 타입체크 + lint**

Run: `cd mobile && npx tsc --noEmit && npx expo lint`
Expected: 통과. 미사용 `View` import 경고 없어야 함.

- [ ] **Step 3: 실기기 확인**

홈/블로그 카드가 테두리 없는 토스 surface 카드(radius 20)로 보이는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add mobile/src/features/blog/blog-card.tsx
git commit -m "refactor(mobile): BlogCard를 공통 Card 컴포넌트로 이행

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 12: 내정보(profile) 마이페이지 이행

**Files:**
- Modify: `mobile/src/app/(tabs)/profile.tsx`

> 범위: 토스 스타일 + 마이페이지 골격(게임 '나' 기능 행은 **"준비 중" 비활성**으로 자리만). 로그인은 **기존 닉네임 로그인 유지하되 Button/입력 스타일만 토스로**(간편로그인 교체는 백엔드 선행 후속 계획). 로그인 시: 상단 프로필 + 비활성 게임 행들 + 로그아웃. 비로그인 시: 닉네임 로그인 폼(토스 스타일).

- [ ] **Step 1: 화면 교체**

Replace entire `mobile/src/app/(tabs)/profile.tsx` with:
```tsx
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { AmountText, Button, Card, ListRow } from '@/ui';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);

  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError('닉네임을 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(trimmed);
      setNickname('');
    } catch {
      setError('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  if (user) {
    return (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.screenTitle}>내정보</Text>
        <Card>
          <Text style={styles.nickname}>{user.nickname}</Text>
          <Text style={styles.role}>FREE 등급</Text>
        </Card>

        <Card style={styles.rankCard}>
          <Text style={styles.rankLabel}>🏆 이번 시즌 내 순위</Text>
          <Text style={styles.rankHint}>시즌이 시작되면 순위가 표시돼요</Text>
          <AmountText value={0} kind="pct" size={22} />
        </Card>

        <View style={styles.group}>
          <ListRow title="Streak 출석" subtitle="준비 중" left={<Text style={styles.emoji}>🔥</Text>} disabled />
          <ListRow title="Trading MBTI" subtitle="준비 중" left={<Text style={styles.emoji}>🧬</Text>} disabled />
          <ListRow title="아카데미 (5x 해금)" subtitle="준비 중" left={<Text style={styles.emoji}>🎓</Text>} disabled />
          <ListRow title="지난 시즌 기록" subtitle="준비 중" left={<Text style={styles.emoji}>📜</Text>} disabled />
        </View>

        <Button label="로그아웃" variant="secondary" onPress={logout} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.screenTitle}>내정보</Text>
      <Text style={styles.subtitle}>닉네임만으로 시작할 수 있어요.</Text>
      <TextInput
        style={styles.input}
        placeholder="닉네임"
        placeholderTextColor="#8b95a1"
        value={nickname}
        onChangeText={setNickname}
        editable={!submitting}
        maxLength={20}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={handleLogin}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="시작하기" loading={submitting} onPress={handleLogin} />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2.5), gap: theme.gap(1.5) },
  screenTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textSecondary },
  nickname: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  role: { fontSize: 13, color: theme.colors.textSecondary },
  rankCard: { backgroundColor: theme.colors.primarySoft },
  rankLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  rankHint: { fontSize: 13, color: theme.colors.textSecondary },
  group: { gap: 0 },
  emoji: { fontSize: 18 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingVertical: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  error: { fontSize: 13, color: theme.colors.up },
}));
```

- [ ] **Step 2: 타입체크 + lint**

Run: `cd mobile && npx tsc --noEmit && npx expo lint`
Expected: 통과.

- [ ] **Step 3: 실기기 확인**

- 비로그인: "내정보 / 닉네임만으로 시작할 수 있어요" + 입력 + "시작하기" 풀폭 버튼(토스 블루).
- 로그인 후: 프로필 카드 + 연한 블루 순위 카드 + 준비중 게임 행 4개(흐림) + 로그아웃. (로그인은 로컬 auth:8001 게스트 로그인으로 동작)

- [ ] **Step 4: 커밋**

```bash
git add "mobile/src/app/(tabs)/profile.tsx"
git commit -m "feat(mobile): 내정보 마이페이지 이행(토스 스타일 + 게임 '나' 기능 자리)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## Task 13: README 갱신 + 전체 검증

**Files:**
- Modify: `README.md` (모바일 화면 구조 섹션)

- [ ] **Step 1: README 모바일 섹션 갱신**

`README.md`의 모바일 설명에 아래 취지를 반영(기존 문장에 맞춰 편집):
- 하단 탭이 **홈 · 블로그 · 게임 · 내정보** 4개로 재편되었고 스크리너·관심종목 탭은 제거됨.
- 공통 UI 컴포넌트는 `mobile/src/ui/`에 있으며 토스 디자인 언어(`docs/mobile_design_language.md`)를 따름.
- 단위 테스트: `cd mobile && npm test`(순수 로직). 화면 검증: `npx tsc --noEmit` + `npx expo lint` + 실기기.

- [ ] **Step 2: 전체 검증**

Run:
```bash
cd mobile && npm test && npx tsc --noEmit && npx expo lint
```
Expected: 테스트 PASS, 타입/lint 통과.

- [ ] **Step 3: 실기기 종합 확인**

4개 탭 전환 → 홈(추천글)·블로그(게시판+상세)·게임(준비중)·내정보(로그인/마이페이지) 모두 토스 톤으로 정상 동작.

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: 모바일 탭 재편·토스 디자인·테스트 실행법 README 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## 범위 밖(후속 계획 — 백엔드 선행)

이번 계획이 끝나면 아래는 **각각 별도 스펙/계획**으로 진행한다(트레이딩 게임 백엔드 Phase 1~5, auth `/social` 선행 필요):
1. **간편로그인 바텀시트 + 게이팅**: `BottomSheet` 컴포넌트 신설(@gorhom/bottom-sheet 또는 reanimated 직접), 소셜 로그인 흐름, 게임 BUY/SELL·댓글·마이페이지 게이팅 통일.
2. **게임 플레이 실시간 화면**: WS(`/ws/game/stream`) 훅, `react-native-echarts` 실시간 캔들 + 지지/저항/진입가 오버레이, 원클릭 주문·포지션 카드.
3. **게임 바텀시트**: 랭킹/지인리그/퀘스트/야간 차트퀴즈/MBTI.
4. **내정보 게임 데이터 연동**: Streak/MBTI/아카데미/시즌기록 실제 API.
5. **홈 내 순위 배너(O1)** 실데이터 연결.

---

## Self-Review (작성자 체크 결과)

- **스펙 커버리지**: D3(탭 재편)=Task10, D8/디자인=Task2·4~8·11·12, D7(마이페이지 골격)=Task12, 게임 탭 자리(D4)=Task9. D5/D6(간편로그인·게이팅)·게임 플레이 실시간은 **의도적으로 범위 밖**(백엔드 의존)으로 명시 → 후속 계획 섹션에 매핑. O1(홈 배너)도 후속.
- **플레이스홀더 스캔**: "준비 중" 표기는 의도된 비활성 UI(코드 완비)이며 계획상의 TODO 아님. 모든 코드 스텝에 실제 코드 포함.
- **타입 일관성**: `formatWon/formatSignedWon/formatPct`(Task3) ↔ AmountText(Task4) ↔ 배럴(Task8) 시그니처 일치. `theme.radius.{chip,button,input,card}`(Task2) ↔ 사용처(Task5·6·7·12) 일치. `@/ui` 배럴 export 이름 ↔ import 일치.
