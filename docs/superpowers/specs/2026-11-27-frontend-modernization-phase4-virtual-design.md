# 프론트엔드 현대화 Phase 4 — TanStack Virtual 설계

원 명세 `docs/frontend_modernization_tailwind4_shadcn_tanstack_spec.md` 의 Phase 4 를 이 프로젝트 규칙에 맞게 좁힌 설계다.

## 사용자 결정 (2026-11-27)

> "1번으로 진행해 줘. 페이징 목록은 그대로 두고, 공용 가상 스크롤 부품을 만들어서 테마 목록이나 랭킹처럼 페이징 없는 긴 목록에만 적용해 줘."

- 페이징 목록(스크리너·급등락·게시판 등)은 건드리지 않는다. "목록은 항상 페이징" 규칙 유지.
- 가상 스크롤은 **페이징 없이 한 번에 다 그리는 긴 목록**에만 쓴다.

## 적용 대상

| 앱 | 화면 | 파일 | 최대 줄 수 | 스크롤 주체 |
|---|---|---|---|---|
| admin_web | 시장 데이터 › 테마 목록 | `components/market/ThemeList.tsx` | 전체 테마(제한 없음) | 페이지(window) |
| web_client | 게임 랭킹 창 › 시즌 랭킹 | `components/game/LeaderboardModal.tsx` | 100 | 모달 본문 상자 |
| web_client | 게임 랭킹 창 › 주간·월간 | `components/game/WeeklyRankingTab.tsx` | 100 | 모달 본문 상자 |

제외: 교육 게임 랭킹(최대 50), 명예의 전당(시즌별로 짧게 나뉨), 시황 그룹 목록(30개씩 더 보기), 모바일(Phase 5).

## 공용 부품 `VirtualList`

각 앱에 같은 부품을 하나씩 둔다(앱끼리 코드 공유 구조가 없음 — Phase 3 `queryClient.ts` 와 같은 방식).

- admin_web: `src/components/ui/virtual-list.tsx`
- web_client: `src/components/ui/VirtualList.tsx`

```ts
interface VirtualListProps<T> {
  items: T[]
  getKey: (item: T) => React.Key
  renderItem: (item: T, index: number) => React.ReactNode   // <li> 안쪽 내용
  itemClassName?: (item: T, index: number) => string | undefined
  estimateSize: number      // 한 줄 예상 높이(px)
  gap?: number              // 가상 모드 줄 간격(px)
  as?: 'ul' | 'ol'
  className?: string        // 일반 모드 ul/ol 클래스
  virtualClassName?: string // 가상 모드 ul/ol 클래스 — className 을 대신 쓰지 않는다(space-y margin 이 섞이면 높이 계산이 어긋남)
  threshold?: number        // 이 개수 미만이면 가상 스크롤 없이 전부 그림(기본 60)
}
```

동작:
1. `items.length < threshold` → 지금과 **똑같은 마크업**(ul/ol + li 전부)을 그린다. 짧은 목록은 화면·Ctrl+F·테스트가 그대로다.
2. 그 이상 → `useVirtualizer` 로 보이는 줄 + 앞뒤 여유(overscan 8)만 그린다.
   - **스크롤 상자 자동 찾기**: 목록에서 위로 올라가며 `overflow-y` 가 `auto|scroll` 인 첫 조상을 쓴다. 없으면 window(`useWindowVirtualizer`). 부모가 다시 그릴 때마다 다시 찾는다(React 가 DOM 을 재사용해 조상 overflow 가 바뀌면 옛 상자를 쓰는 문제 — 브라우저 확인에서 발견).
   - **scrollMargin**: 목록 윗변이 스크롤 내용 맨 위에서 떨어진 거리. 부모 재렌더·창 크기 변경 때 다시 잰다(위쪽 '내 순위' 등 높이는 줄 수와 무관하게 바뀜). 둘 다 같은 값이면 상태를 안 바꿔 무한 갱신 없음.
   - 바깥 `div` 높이 = 전체 높이, 안쪽 ul/ol 을 `translateY(첫 줄 시작 − scrollMargin)` 로 내린다. ul/ol 이 li 의 직계 부모라서 `divide-y` 가 그대로 먹는다.
   - `space-y-*` 는 margin 이라 실측 높이에 안 잡힌다. `gap` 을 주면 부품이 ul/ol 에 `display:flex; flex-direction:column; row-gap` 을 직접 걸어 계산 간격과 화면 간격을 항상 맞춘다(클래스로 맡기면 빠뜨렸을 때 목록 끝에 빈 공간).
   - 줄 높이는 `measureElement` 로 실측(테두리·줄바꿈 차이 흡수).
   - `initialRect` 를 주어 jsdom(레이아웃 없음)에서도 앞쪽 줄이 그려지게 한다.

## 화면별 바꾸는 것

- ThemeList: `<ul>…rows.map…</ul>` → `<VirtualList as="ul" className=기존 클래스 …/>`. 버튼 내용은 그대로.
- LeaderboardModal 시즌 탭·WeeklyRankingTab 본 목록: `className="space-y-1"`, `gap={4}`. 일반 모드 모양 그대로.
- ThemeList 는 그리드 자식이라 `wrapperClassName="min-w-0 self-start"`, 테두리·구분선은 `virtualClassName`. 관리자 Layout 조상에 overflow 가 없어 창 스크롤로 잡힌다(`Layout.tsx:42·81` 확인).

## 오류·한계

- 가상 모드에서는 화면 밖 줄을 브라우저 찾기(Ctrl+F)가 못 찾는다 — 테마 목록은 위쪽 검색창이 있고, 랭킹은 100줄 이하라 감수.
- "내 순위로 이동" 같은 기능은 이번에 추가하지 않는다(YAGNI).

## 테스트

- `VirtualList` 단위 테스트(두 앱): 기준 미만이면 전부, 이상이면 일부만 그려짐; 줄마다 className; ol/ul 선택.
- 기존 ThemeList·랭킹 테스트가 그대로 통과(작은 데이터라 일반 모드).
- 두 앱 `tsc`·`vitest`·`build`, web lint.
- 브라우저: 관리자 테마 목록 스크롤, 랭킹 창(가짜 100명 데이터) 모달 안 스크롤을 눈으로 확인.

## 구현 순서

1. 두 앱에 `@tanstack/react-virtual@3.14.26` 고정 설치.
2. web_client `VirtualList` + 테스트 → 커밋.
3. admin_web `virtual-list` + 테스트 → 커밋.
4. admin ThemeList 적용 → 커밋.
5. web LeaderboardModal·WeeklyRankingTab 적용 → 커밋.
6. 전체 검증 → dev `--no-ff` 머지.
