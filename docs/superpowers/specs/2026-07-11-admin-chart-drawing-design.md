# 어드민 차트 드로잉 도구 설계 (v1: 수평선·사각형·텍스트)

- 작성일: 2026-07-11
- 관련 문서: `docs/prompts/04_admin_web.md`(5단계 드로잉), `05_user_web.md`, `03_mobile_app.md`

## 배경 / 목표
어드민 '차트 삽입' 모달에서 캡처 전, 사용자가 차트 위에 분석을 직접 그릴 수 있게 한다.
v1은 **수평선 · 사각형 · 텍스트** 3종을 구현하고, 이중 추세선(3클릭 채널)은 다음 단계로 미룬다.

## 핵심 제약
캡처는 `getEchartsInstance().getDataURL()` → **ECharts 캔버스만** 이미지화된다.
따라서 드로잉은 반드시 **ECharts `graphic` 요소**로 그려야 캡처 이미지에 포함된다.
(별도 HTML/div 오버레이는 캡처되지 않음)

## 핵심 결정
- **그리기 방식**: 클릭해서 직접 그리기 (원샷 — 삽입 시 이미지로 구워져 재편집 불필요)
- **좌표 저장**: 픽셀이 아닌 **데이터 좌표**(x=카테고리 인덱스, y=가격)로 저장 → 리렌더/캡처 정합성 유지
- **로직 분리**: `useChartDrawings` 훅으로 분리 → 향후 web_client/mobile 재사용

## 구성 요소
### 1. 드로잉 상태 훅 `useChartDrawings.js`
- 도형 배열: `{ id, type: 'hline'|'rect'|'text', ... }`
  - hline: `{ price }`
  - rect: `{ x1, y1, x2, y2 }` (데이터 좌표)
  - text: `{ x, y, text }`
- API: `shapes, addShape, removeSelected, clearAll, selectedId, setSelectedId, tool, setTool`

### 2. 툴바 (모달 상단)
- 버튼: 수평선 / 사각형 / 텍스트 / 선택 / 선택삭제 / 전체지우기
- 활성 도구 하이라이트

### 3. 차트 인터랙션 (ECharts `zr` 이벤트 + `convertFromPixel`)
- **수평선**: 클릭 1회 → 해당 가격에 수평선 + 우측 가격 라벨
- **사각형**: mousedown→drag→up 대각 영역 → 반투명 사각형
- **텍스트**: 클릭 → HTML 입력창 → 확정 시 `graphic` text 배치
- 생성된 도형은 `draggable`로 미세조정 가능

### 4. 렌더링
- `shapes` → `graphic` 배열로 변환, `convertToPixel('grid', [xIndex, price])`로 데이터→픽셀 변환
- ECharts `graphic` 옵션에 반영 (선/사각형/텍스트 + 가격 라벨)

### 5. 캡처
- 기존 `getDataURL` 그대로 → `graphic`이 캔버스에 있으므로 자동 포함
- 삽입 후 도형 상태 초기화(`clearAll`)

## 데이터 흐름
```
툴바 도구 선택 → 차트 클릭/드래그 → useChartDrawings에 도형 추가(데이터좌표)
  → graphic 렌더 → 본문 삽입 시 getDataURL 캡처(도형 포함) → clearAll
```

## 비범위 (이후 단계)
- 이중 추세선(3클릭 평행 채널 + 중심선)
- web_client / mobile 차트 드로잉 재사용
- 도형 스타일 커스터마이즈(색상/두께 선택)
