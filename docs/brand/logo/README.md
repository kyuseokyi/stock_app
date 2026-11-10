# FunNote 로고 — 사용 안내

> 앱 이름 **FunNote**(펀노트), 상용 주소 `funnotedaily.com`(개발은 `haezean.com` — [`../../deploy/environments.md`](../../deploy/environments.md)).
> 2026-11-10 **확정: 웃는 수익률(시안 D)**. 앱 아이콘·스플래시(`mobile/assets/images/`)와 웹·관리자 파비콘(`*/public/favicon.*`)에 적용했다.
> 비교했던 다른 시안(F 노트, 웃는 노트, 섞은 안 등)은 [`concepts/`](concepts/README.md)에 남겨 두었다.

## 아이디어

바닥(U) 위로 오늘의 점 하나가 올라온 **웃는 얼굴 — 오늘 내 수익률의 표정**.
매일 보는 시황과 펀드 수익률이 중심인 앱이라, "오늘"을 점 하나로 담았다.
기호의 U 가 글자 **Fun** 의 u 와 같은 모양이라 이름과 기호가 하나로 읽힌다.
(처음엔 "베이스 돌파"로 만들었다가 앱 성격에 맞춰 해석만 바꿨다 — 도형은 같다.)

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
  한 색·흰색·블루 단색 PNG, 앱 아이콘 2종 — `funnote-app-icon-color.*`(라벤더 타일 + 색 기호, **권장**), `funnote-symbol-app-icon.*`(블루 타일 + 흰 기호).
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

## 적용 위치

| 무엇 | 파일 |
|---|---|
| 앱 아이콘(iOS·기본) | `mobile/assets/images/icon.png` — 꽉 찬 정사각(모서리는 OS 가 깎음) |
| Android 적응형 아이콘 | `android-icon-foreground/background/monochrome.png` — 기호는 지름 66/108 안전 영역 안 |
| 스플래시 | `splash-icon.png`(라벤더 바탕) · `splash-icon-dark.png`(다크 바탕) |
| Android 푸시 알림 아이콘 | `notification-icon.png` — 96px, **흰색+투명만**(OS 가 색을 버리고 모양만 씀), 강조색 `#5B7BE9` |
| 웹·관리자 파비콘 | `web_client/public`, `admin_web/public` 의 `favicon.ico`·`favicon.svg`·`apple-touch-icon.png` |

앱 쪽은 모두 네이티브 설정이라 **새 빌드(APK/스토어)부터** 보인다. OTA 로는 바뀌지 않는다.

## 이름과 식별자 — 결정(2026-11-10)

사용자에게 보이는 이름만 **FunNote**(개발 앱 **FunNote Dev**)로 바꾸고, 내부 식별자는 **바꾸지 않기로 했다**.

| 식별자 | 값 | 그대로 두는 이유 |
|---|---|---|
| 패키지 ID / 번들 ID | `com.stockapp` · `com.stockapp.dev` | 사용자에게 안 보인다. 바꾸면 다른 앱이 되어 네이버·카카오 콘솔, Firebase(google-services.json), 스토어 등록을 다 새로 해야 한다 |
| Expo slug · EAS 프로젝트 | `stockapp` · `@kyuseokyi/stockapp` | OTA 업데이트 주소가 프로젝트에 묶여 있다 |
| 딥링크 스킴 | `stockapp://` · `stockapp-dev://` | 간편 로그인 복귀 주소. 바꾸면 소셜 로그인 설정도 함께 바꿔야 한다 |
| APK 파일 이름 | `stockapp-<dev\|prod>-…apk` | 빌드 산출물 이름일 뿐 |

- 스토어 화면·홈 화면·알림에는 FunNote 만 보이므로 문제없다(패키지 ID 는 Play 스토어 주소 `?id=com.stockapp` 에만 보인다).
- **바꾸고 싶어지면 첫 스토어 출시 전에만 가능**하다. 출시 후에는 패키지 ID 를 바꿀 수 없다(바꾸면 새 앱으로 다시 출시).
- 블로그 개발 샘플 글 제목 "해전(StockApp) 둘러보기"도 그대로 — 시드가 제목으로 중복을 판단해 바꾸면 글이 하나 더 생긴다.

## 남은 일

- 상표 검색은 하지 않았다. 출시 전 KIPRIS(특허청 무료 검색)에서 "펀노트"·"FunNote" 를 9류(앱)·36류(금융 정보) 로 검색 권장
