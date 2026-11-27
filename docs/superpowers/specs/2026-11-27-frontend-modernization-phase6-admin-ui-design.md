# 프론트엔드 현대화 Phase 6 — 관리자 웹 구조 통일 설계

원 명세 `docs/frontend_modernization_tailwind4_shadcn_tanstack_spec.md` 의 Phase 6(모달·드로어·드롭다운 shadcn 통일, tabular-nums,
라이트/다크·차트 색 동기화, 전체 회귀)을 사용자 결정에 맞게 좁힌 설계다.

## 사용자 결정 (2026-11-27)

> "다음진행해줘" → 범위 질문에 **"구조만 통일 (추천)"**

- 모달·확인창을 Radix(shadcn) 부품으로 바꾸고 표 숫자에 tabular-nums. **색·간격은 그대로**(Phase 1 호환 CSS 유지).
- 기본 `<select>` 13곳은 그대로(브라우저 기본이 접근성·모바일에서 더 낫다).
- 다크 모드·파스텔 통일·호환 CSS 제거는 하지 않는다.
- web_client 는 아직 Tailwind v3 — v4 전환은 맨 마지막 별도 작업.

## 1. 확인창 — 브라우저 confirm 22곳 → 공용 확인 대화상자

- `components/ui/confirm-dialog.tsx`: Radix Dialog 를 `role="alertdialog"` 로. 포커스 가두기·Esc·바깥 클릭(=취소)·스크롤 잠금.
  닫기(X) 없음(선택지는 취소·실행 둘). 처음 포커스는 [취소](실수 Enter 방지).
  위험 버튼은 디자인 토큰 `danger`(#a14f09) — 빨강은 이 앱에서 '상승'이라 헷갈리지 않게 따로 둔 색.
- `lib/confirm.tsx`: `await confirmAction(message, { danger?, confirmLabel? })` — 브라우저 `confirm()` 과 같은 쓰임.
  메시지 첫 줄은 제목, 나머지는 설명. 여러 번 부르면 차례대로 하나씩. `<ConfirmHost />` 를 `main.tsx` 에 한 번.
- 15개 파일 22곳 교체. 문구 그대로. 삭제·제외·사용 중지·금지·정산은 `danger` + 그 동사를 버튼 문구로.
- AI Lab 전용 `aiLab/ConfirmDialog` 는 공용 부품을 쓰는 얇은 감싸개(기본 문구 '실행' 유지).

## 2. 직접 만든 모달·오버레이

| 곳 | 처리 |
|---|---|
| 급등락 상세 시트, AI Lab 기록 시트 | 공용 `components/ui/full-screen-sheet.tsx`(Radix)로. 모양 그대로, Esc·포커스 가두기·스크롤 잠금 추가 |
| 모바일 사이드바 드로어 | Radix Dialog 로(모양 그대로, 보이지 않는 제목 "메뉴"). 넓은 화면(lg)이 되면 자동으로 닫음 — 열린 채 남으면 넓은 화면에도 스크롤 잠금이 걸린다 |
| 차트 스냅샷 모달 | 그대로 — 그리는 중 Esc 는 "그리던 것만 취소"인데 Radix 의 Esc 처리가 먼저 돌아 모달이 닫힐 위험. 이미 자체 Esc 처리 있음 |

브라우저 확인에서 찾은 것: Radix 는 스크롤 잠금을 **Overlay** 에 건다. 화면을 다 덮는 시트라도 Overlay 를 빼면 뒤 화면이 스크롤된다 →
시트에 같은 배경색 Overlay 추가, 테스트(`data-scroll-locked`)로 고정(Overlay 없는 옛 코드에서 실패 확인).

## 3. 표 숫자 정렬

`index.css` 에 `table { font-variant-numeric: tabular-nums }` 한 줄(호환 CSS 가 아니라 계속 두는 규칙).
표가 있는 18개 파일 중 15개에 빠져 있던 것을 한 번에 맞춘다. 바뀌는 건 표 안 숫자 폭뿐.

## 검증

- admin_web `tsc`·`vitest`·`build`, 바꾼 파일 eslint 오류 0.
- 새 테스트: `lib/confirm.test.tsx`(4), `components/ui/full-screen-sheet.test.tsx`(1).
- 임시 확인 페이지(커밋 안 함)로 브라우저 확인: 확인창(일반·위험, 데스크톱·390px), 처음 포커스 [취소], Esc=false, 시트 포커스·스크롤 잠금.
- 실제 관리자 화면(로그인 필요)에서의 확인은 dev 배포 후.
