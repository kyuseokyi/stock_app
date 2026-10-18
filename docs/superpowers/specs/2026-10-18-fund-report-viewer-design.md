# 펀드 수익보기(Fund Report Viewer) 설계

- 작성일: 2026-10-18
- 상태: 승인(추후 보완 예정)
- 관련 선행 작업: 로컬 변환기 `fund_report/convert.py` + `template.html` (repo 밖, 개인 폴더)

## 1. 목적

fund.ivyro.net 이 투자자별로 제공하는 펀드 현황 페이지(FlexCel 5.6.5 로 만든 고정 폭 표 HTML)를
웹(`web_client`)과 앱(`mobile`)에서 **반응형 리포트 화면**으로 보여준다.

- 원본 URL 은 투자자마다 고정이고, 영업일마다 하루 한 번 내용이 갱신된다.
- 원본 서버 응답: `Access-Control-Allow-Origin: *`, `Content-Type: text/html`(문서 내 UTF-8), `ETag`/`Last-Modified` 없음.

## 2. 결정 사항

| 항목 | 결정 |
|---|---|
| 사용자 | 이 앱의 모든 회원(로그인 필요 — `/me`, profile 탭 하위) |
| URL 저장 위치 | **기기에만** 저장. 우리 서버에는 URL·리포트 데이터가 남지 않음 |
| URL 개수 | 기기당 **여러 개** 등록 가능(이름 붙이기) |
| 진입 위치 | 웹 `/me` → `/me/funds`, 앱 profile 탭 → `fund` 스택 화면 |
| 구현 방식 | **A안**: 공용 TS 파서 + 웹 React 화면 + 앱 WebView(template 렌더러) |
| 데이터 가져오기 | 클라이언트가 원본 URL 을 직접 `fetch` (백엔드/프록시 없음) |

검토 후 제외한 안:
- B안(파서+렌더러를 WebView 안 단일 HTML 번들로): 로직이 WebView 에 갇혀 테스트·오류 처리가 어려움.
- C안(양쪽 네이티브 UI): 작업량 최대. 추후 앱 화면만 Unistyles 로 교체할 때 파서·저장소는 그대로 재사용.

## 3. 구조와 파일 위치

repo 관례(웹·앱이 공용 로직을 복사본으로 보유, 주석에 "… 와 동일" 표기, jest 는 mobile 에만 존재)를 따른다.
루트 `shared/` 폴더는 `web_client` Docker 빌드 컨텍스트를 깨뜨릴 수 있어 쓰지 않는다.

```
mobile/src/features/fund/
  core/                      ← 플랫폼 무관 공용 코드(기준). 상대 import 만 사용 → 웹에 파일 그대로 복사
    types.ts                 FundReport 타입 + 오류(fundError/isFundError, code: format|fetch|input)
    grid.ts                  FlexCel HTML 토큰화(htmlparser2) + 병합 셀 격자
    parse.ts                 섹션 추출 + 누락 검증 → parseFundReport
    url.ts                   URL 허용 규칙
    funds.ts                 목록 조작(추가·삭제·이름) 순수 함수, 상한(10개·이름 20자)
    hash.ts                  djb2
    refresh.ts               fetchReportHtml(10초 타임아웃) + refreshReport(캐시 포트 주입)
    display.ts               기준일·마지막 확인 시각 표시
    use-fund-report.ts       React 훅(캐시 먼저 → 항상 다시 가져오기)
    index.ts
    *.test.ts                jest(복사 대상 아님)
  __fixtures__/              가린 원본 HTML 2종 + convert.py 기대 JSON
  fund-store.ts              목록(SecureStore) + 캐시(expo-file-system) 포트
  report-colors.ts           Unistyles 테마 → WebView CSS 변수
  report-web/report-page.ts  template.html 렌더러를 DOM 생성 방식 문자열로(CHART_HTML 방식)
  components/report-view.tsx WebView + JSON 주입(toInjectScript 패턴)
mobile/src/app/fund/index.tsx   펀드 목록·추가·삭제
mobile/src/app/fund/[id].tsx    리포트 보기(헤더 새로고침 버튼)
mobile/src/app/_layout.tsx      스택 화면 2개 등록
mobile/src/app/(tabs)/profile.tsx  '내 펀드 수익' 메뉴 1줄 추가

web_client/src/
  lib/fundCore/              mobile core 복사본(테스트 제외, 내용 동일)
  lib/fundStore.ts           localStorage 버전
  components/fund/FundReportView.tsx  template 화면을 React+Tailwind 로 이식
  pages/FundListPage.tsx     /me/funds
  pages/FundReportPage.tsx   /me/funds/:id
  pages/MyPage.tsx           메뉴 1줄 추가
  App.tsx                    라우트 2개 추가(lazy)

scripts/fund/mask_fixture.py       실제 원본 → 가린 픽스처
scripts/check-fund-core-sync.sh    core 복사본 동일 여부 검사(--write 로 복사)
```

기존 코드 변경은 메뉴 1줄·라우트·스택 등록으로 한정한다(회귀 방지).
이름 변경 UI 는 두지 않는다(삭제 후 다시 추가). 이름을 비우면 첫 조회 때 기본 이름이 저장된다.

### 파서 인터페이스

```ts
type ParseResult = {
  report: FundReport;   // convert.py 의 JSON 과 같은 구조(title, investorNo, sections[])
  missing: string[];    // 원본 셀에 있으나 결과에 없는 숫자·단어(누락 검증)
};
function parseFundReport(html: string): ParseResult;  // 섹션 0개면 fundError('format') throw
```

동작은 `convert.py` 와 동일하다: 병합 셀 격자 복원 → "■" 섹션 분할 → notice / accounts / steps / cert 추출,
값은 원본 문자열 그대로, `display:none` 행 제외, 빨간 글씨는 인라인 style 또는 `.flxN` CSS 색으로 판정.

## 4. 데이터 흐름

### 저장

| 데이터 | 앱 | 웹 |
|---|---|---|
| 목록 `[{id, name, url}]` | `expo-secure-store` 키 1개 | `localStorage` |
| 캐시 `{v, fetchedAt, hash, report}` | `expo-file-system` 앱 문서 폴더, 펀드별 파일 | `localStorage` 펀드별 키 |

- SecureStore 는 iOS 에서 값 1개가 약 2KB 를 넘으면 거부될 수 있어 캐시는 파일에 둔다.
  목록도 같은 이유로 최대 10개·이름 20자로 제한한다.
- 신규 의존성: mobile `htmlparser2@9.1.0`, `expo-file-system` / web `htmlparser2@9.1.0`.
  (12.x 는 ESM 전용이라 jest-expo 가 변환하지 못함 → CJS 를 함께 주는 9.x 고정)
- 펀드 삭제 시 캐시도 삭제한다. `v`(파서 버전)가 다르면 캐시를 버린다.
- 웹 `localStorage` 접근은 try/catch 로 감싼다(사생활 보호 모드 등).

### 갱신

```
리포트 화면 열기
 ├─ 캐시 있음 → 즉시 표시 ("마지막 확인 HH:mm")
 └─ 항상 백그라운드 fetch(url)
       ├─ 성공 → parse → hash(djb2, 원본 HTML) 비교
       │     ├─ 같음 → fetchedAt 만 갱신
       │     └─ 다름 → 화면 교체 + 캐시 저장
       └─ 실패 → 캐시 유지 + "최신 정보를 못 가져왔어요" 배너
```

- 영업일·갱신 시각 계산은 하지 않는다(매번 가져와도 HTML 1장).
- 화면 상단에 원본의 "최종평가일"을 기준일로 크게, 마지막 확인 시각을 작게 표시.
- 수동 새로고침: 앱은 화면 헤더 오른쪽 새로고침 아이콘, 웹은 새로고침 버튼.
  (WebView 의 당겨서 새로고침은 iOS 전용이라 쓰지 않는다)

## 5. 오류 처리

### URL 검증(저장 시)
- 앞뒤 공백 제거 후 검사.
- 정규식 하나로 검사(RN 의 `URL` 구현은 hostname 등이 불완전):
  `^https://fund\.ivyro\.net/dataroom/om_data/[^/?#\s]+\.htm$` — https 만, 호스트 정확히 일치, 쿼리·해시 불가.
- 중복 URL 거부. 실패 시 "fund.ivyro.net 펀드 현황 주소만 등록할 수 있어요".
- 이름은 선택. 비우면 첫 조회 때 원본 제목의 투자자 번호로 기본 이름 생성.

### 가져오기·파싱

| 상황 | 처리 |
|---|---|
| 네트워크 오류 / 10초 타임아웃 / 200 아님 | 캐시 있으면 캐시+배너, 없으면 오류 화면+다시 시도 |
| 섹션 0개(`fundCode: 'format'`) | "원본 형식이 바뀌어 읽을 수 없어요" + 원본 열기 |
| `missing` 비어 있지 않음 | 화면은 표시 + "일부 항목이 빠졌을 수 있어요" 배너 + 원본 열기 |

### 보안
- 원본 값은 텍스트로만 삽입: 웹은 React 기본 이스케이프, WebView 렌더러는 `textContent` 만(`innerHTML` 금지).
- 원본 내 링크는 `http(s)` 만 허용, 외부 브라우저로 연다. WebView 내부 이동은 차단.
- URL·리포트 값은 콘솔/오류 로그에 남기지 않는다.
- 원본 URL 은 무작위 토큰이 아니어서 비밀로 취급할 수 없다. 이는 원본 사이트 측 문제로 앱에서 해결하지 않으며, 운영 측에 개선을 권고한다.

## 6. 테스트

- **mobile jest(기준)**
  - `parse-report`: 가린 픽스처 2종(새/옛 양식) → `missing` 비어 있음. 같은 픽스처를 `convert.py --json` 으로 만든 기대 JSON 과 동일.
  - 픽스처 가리기: 숫자·이름을 가짜 값으로 바꾸되 글자 수와 형식(쉼표, 원, %)은 유지. 실제 원본은 커밋하지 않는다.
  - `validate-url`: http, 유사 호스트, 다른 경로, 공백, 중복.
  - `fetch-report`: fetch·저장소 mock — 캐시 표시, 변경 반영, 실패 시 캐시 유지, 버전 불일치 캐시 폐기.
- **web**: 테스트 러너 없음 → `check-fund-core-sync.sh` + `npm run build`(tsc) + 브라우저 수동 확인.
- **수동**: dev 빌드에서 실제 URL 등록 → 웹·앱, 데스크톱·375px·다크 모드 확인.

## 7. 범위 밖(추후)

- 앱 리포트 화면의 Unistyles 네이티브 전환(C안).
- 웹·앱 간 목록 동기화(서버 저장).
- 갱신 푸시 알림.

## 8. 화면 디자인 (2026-10-18 추가)

- B안(정렬 그리드 카드) 채택. 시안 A·B·C와 표시 포맷 규칙: `fund-report-design/README.md`
