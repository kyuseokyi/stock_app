# StockApp 로고 — 사용 안내

> 2026-11-09 확정 방향: **B · 베이스 돌파**. 아직 앱·웹 아이콘에는 적용하지 않았다(적용 여부는 따로 결정).

## 아이디어

컵 모양으로 바닥(베이스)을 다진 뒤, 점 하나가 위로 튀어 오르는 **돌파의 순간**.
앱이 계산하는 오닐식 베이스 단계·피벗 돌파(`backend/apps/collector/patterns/base_count.py`)를 그대로 그렸다.
웃는 얼굴로도 읽혀 토스식 친근한 앱 분위기와 맞는다.

## 색

| 이름 | HEX | RGB | 쓰임 |
|---|---|---|---|
| 브랜드 블루 | `#5B7BE9` | 91 123 233 | 기호의 바닥(U) |
| 돌파 핑크 | `#E0588E` | 224 88 142 | 기호의 점 |
| 잉크 | `#25223A` | 37 34 58 | 글자 로고 |
| 라벤더 | `#F7F5FF` | 247 245 255 | 앱 아이콘 타일·밝은 바탕(앱 `background` 토큰) |
| 다크 바탕 | `#1A1826` | 26 24 38 | 반전 버전 바탕(앱 다크 `background`) |
| 다크 블루 / 다크 핑크 | `#9FB4F7` / `#F0A0C0` | 159 180 247 / 240 160 192 | 반전 버전 기호(앱 다크 `primary`·`accent`) |

대비(그래픽 기준 3:1 이상): 블루 3.85 · 핑크 3.53(흰 바탕), 3.57 · 3.27(라벤더), 다크 버전 8.6 이상.
앱 토큰(`primary #6f8ef0`, `accent #e88ab0`)보다 한 단계 진하게 잡았다. 토큰 색 그대로면 흰 바탕에서 로고가 흐려진다.

## 파일 (`svg/`)

| 파일 | 언제 |
|---|---|
| `symbol-color.svg` | 기본 기호 |
| `symbol-small-color.svg`, `symbol-small-black.svg` | **32px 이하**(파비콘·알림 아이콘). 선이 굵고 점과의 간격이 넓은 작은 크기 전용판 |
| `symbol-black.svg` | 한 색(인쇄·도장·Android 단색 아이콘 원본) |
| `symbol-reversed.svg` | 어두운 바탕 |
| `lockup-horizontal-*.svg` | 헤더·문서 머리말 등 가로 공간 |
| `lockup-stacked-*.svg` | 스플래시·정사각 공간 |
| `wordmark-*.svg` | 기호 없이 글자만 필요할 때 |

- `icons/`: `favicon.ico`·`favicon.svg`·`apple-touch-icon.png`·`icon-192/512.png`·`maskable-512.png`·`site.webmanifest`·`head-snippet.html`,
  한 색·흰색·블루 단색 PNG, 앱 아이콘 2종 — `stockapp-app-icon-color.*`(라벤더 타일 + 색 기호, **권장**), `stockapp-symbol-app-icon.*`(블루 타일 + 흰 기호).
- `board/`: 발표 슬라이드(앱 아이콘·웹·탭·카드 목업)와 크기·배경 테스트 시트.

## 여백과 최소 크기

- **여백**: 로고 둘레에 **점 지름 하나** 이상 비운다. 다른 글자·그림이 이 안에 들어오지 않게.
- **최소 크기**: 기호 16px(32px 이하에서는 small 판), 가로형 로고 가로 96px, 세로형 로고 가로 64px.
- 가로형·세로형은 기호와 글자의 비율·간격이 고정이다. 따로 떼어 다시 배치하지 않는다.

## 이렇게 쓰지 않는다

- 점을 옮기거나 지우기(아이디어가 사라진다)
- 색 바꾸기, 파랑과 핑크 서로 바꾸기
- 그라데이션·그림자·외곽선 추가
- 늘이기·눕히기·회전
- 복잡한 사진 바탕 위에 색 버전 올리기(→ 흰색 또는 한 색 버전)

## 글꼴

글자 로고는 **Manrope ExtraBold(800)** 를 외곽선으로 바꾼 것이다. SIL Open Font License 1.1(`source/Manrope-OFL.txt`) — 로고 사용 가능.
SVG 에는 글꼴이 아니라 도형만 들어 있다. 다시 만들 때: `python -I source/make_kit.py <Manrope 가변 폰트 경로> <출력 폴더>`
(폰트: google/fonts 저장소 `ofl/manrope/Manrope[wght].ttf`).

## 남은 일

- 앱 아이콘(`mobile/assets/images/*`)·웹 파비콘 교체 여부 결정
- 상표 검색은 하지 않았다. 출시 전 KIPRIS 검색·역이미지 검색 권장
- 스플래시·푸시 알림 아이콘(Android 단색) 적용
