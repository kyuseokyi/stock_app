# 시세 데이터 이용 계약(재배포) 조사와 공급원 비교 (2026-11-19)

> 법률 판단이 아니다. 공개 자료 조사 결과이며, 출시 전 각 기관 답변과 전문가 확인으로 확정한다.

## 1. 결론
- FunNote 는 증권사 **개인용 API(KIS·키움)** 로 받은 시세를 **앱·웹의 모든 사용자에게 표시**한다. 확인한 조건들은 수익 여부가 아니라 **"제3자에게 보여 주는가(재배포)"** 를 기준으로 한다 → **광고를 빼도, 하루 1번 종가만 써도 계약이 필요할 가능성이 높다.**
- 이미 개발 서버(haezean)·상용 서버(funnotedaily)에서 공개 표시 중이다. **스토어 출시 전 해결**을 출시 조건으로 둔다.
- 장중 스냅숏·새 증권사 출처 추가는 이 문제가 정리될 때까지 **보류**.

## 2. 지금 쓰는 출처의 조건
| 출처 | 확인한 조건 | 우리 용도 |
|---|---|---|
| **KIS 오픈 API** | 시세는 "한국투자증권 거래고객 대상 오픈API 서비스"에 한해 이용 허용, 그 외 목적 금지·부당 사용 시 과태료 가능(개발자센터 안내, 검색 요약). 제3자 서비스는 KRX·해외거래소 정보이용계약 필요. 다른 오픈소스 프로젝트도 약관 제5조③(개인 업무 한정·제3자 제공 금지)을 근거로 **정식 출시 전 교체**를 출시 조건으로 둠 | ❌ 범위 밖으로 보임 |
| **키움 REST API** | 약관 본문 미확인("오픈 API 서비스이용약관"). 본인 자동매매용으로 소개 → KIS 와 비슷할 가능성(추정) | ⚠️ 확인 필요 |
| **KRX Open API** | 개인이 단순 참고를 넘어 **재배포 프로그램·수익사업**에 쓰려면 별도 계약(KRX 승인 → 코스콤 계약, 1년 자동 연장) | ❌ 계약 필요 |
| **공공데이터(금융위원회_주식시세정보 등)** | 무료, 다음 영업일 13시 이후 갱신. **공공누리 제4유형**(상업 금지·변경 금지), 상업 여부와 무관하게 **제3자 제공·재배포 금지**. 상업 이용은 KRX Data Marketplace 유료 구매 | ❌ |
| 네이버·야후 스크래핑, pykrx | robots·약관상 수집 금지(네이버는 2026-10-18 보류 결정) | ❌ |

## 3. 정식 공급원 비교
| # | 공급원 | 대상·조건 | 비용(공개 자료) | 우리와의 궁합 | 문의 |
|---|---|---|---|---|---|
| 1 | **KRX Data Marketplace**(원천) | 상품별 상세 페이지에서 사양·가격 확인, 신청→결제→심사. 공공데이터 안내상 구매 데이터는 **가공한 독창적 저작물·간접 수익(방문·가입)** 목적의 상업 활용 가능. "데이터 분배상품·데이터 라이센스" 메뉴 별도 — **매일 갱신 표시는 라이선스 상품일 가능성**(추정) | **비공개**(상품 상세·문의) | ⭐ 일별 시세로 차트·지표·스크리너·CANSLIM·패턴 계산 — 지금 파이프라인과 구조 동일 | krxdata@krx.co.kr |
| 2 | **코스콤 오픈API플랫폼(시세 API)** | **법인만**(개인사업자·개인 불가). 중소기업 중 핀테크 분류업종·전자금융(보조)업자 등. **시세라이센스 계약 선행** → 플랫폼 계약·적격성 검토 → 샌드박스 → 운영 키. 개발용 시세라도 가공·축적에는 라이선스 필요 | 라이선스별 과금(금액 비공개). **업력 7년 미만 중소기업 기본료 36개월 면제** 안내 | ⭐ 실시간·지연·종가 모두. 장중 데이터·게임 실시간까지 정식으로 | 라이선스 fintechdata@koscom.co.kr (02-767-7537) · 플랫폼 open@koscom.co.kr (02-767-7933) |
| 3 | **에프앤가이드 FnSpace API** | 연기금·증권사·운용사 대상 금융데이터 API. KOSPI·KOSDAQ·KONEX 주가·거래량·수익률·배당·수정주가(1980~) | **월·연 구독 + 호출당 코인 차감**(금액은 사이트/문의) | 데이터 품질 좋음. **앱 표시(재배포) 허용 범위는 미확인** — 분석용 라이선스일 가능성 | FnSpace 문의 |
| 4 | **TradingView 위젯 임베드** | TradingView 라이선스로 표시, KRX 는 **15분 지연**이 기본, 위젯 아래 TradingView 표기(제거는 별도 문의) | 무료 위젯 | 보여 주기만 하는 화면(지수·차트·시세판) 대체용. **우리가 계산하는 기능(스크리너·CANSLIM·패턴·게임)에는 못 씀**. 앱은 WebView | TradingView |
| 5 | 해외 API(Twelve Data·marketstack·EODHD 등) | 업체도 거래소 표시 라이선스 필요, 한국 종목 범위·품질 제각각 | 참고: Twelve Data Pro 월 $99, marketstack Basic 월 $9.99(15분 지연·상업 가능 — 2차 자료, 국내 범위 미확인) | 지름길 아님 | — |
| 6 | 다른 증권사 API(DB·LS·토스 등) | 개인 고객용 — KIS 와 같은 제한일 가능성 | — | ❌ 해결책 아님 | — |
| 참고 | **주달(judal.co.kr)** | 출처 미표기, 면책에 "콘텐츠 제공업체로부터 받는 투자 참고사항" → 데이터 업체 계약 구조로 추정 | — | 같은 업종 사례 | — |

## 4. 권장 순서
1. **사업자 형태 확인** — 코스콤 오픈API 는 **법인만** 가능. 개인이면 1(KRX)·3(FnGuide) 쪽부터.
2. **KRX Data Marketplace 문의**(가장 먼저, 아래 문구) — 일별 시세 표시 라이선스 상품·비용.
3. **코스콤 문의**(법인이거나 법인 전환 계획이 있으면) — 일별 + 장중, 기본료 면제 적용 여부.
4. **FnGuide 문의** — 앱 표시(재배포) 가능한 상품이 있는지.
5. 견적 비교 → 결정 → 수집 파이프라인 출처 교체 설계(지금 KIS 일봉 단계를 새 공급원으로, MTS 일치 규칙·UN 통합 여부 재검증).
6. 결정 전까지: 장중 스냅숏·새 출처 보류, 광고 연동(AdSense·AdMob) 보류 권장.

## 5. 문의 문구
**KRX(krxdata@krx.co.kr)**
> 국내 상장 주식(코스피·코스닥 약 2,600종목)의 일별 시세(시가·고가·저가·종가·거래량)를 매일 갱신 받아, 모바일 앱·웹에서 차트·지표·투자 교육 콘텐츠로 가공해 일반 사용자에게 보여 주려 합니다(실시간 아님). ① 필요한 상품·라이선스 종류 ② 연간 비용(광고가 있는 경우 / 없는 경우) ③ 매일 받는 방법(API·파일) ④ 과거 3년치 포함 여부 ⑤ 증권사 API(한국투자증권·키움)로 받은 시세를 표시해도 되는지 알려 주세요.

**코스콤(fintechdata@koscom.co.kr)**
> 투자 교육·펀드 수익률 앱에서 국내 주식 일별 시세와 장중(지연 가능) 시세를 가공 표시하려 합니다. 시세라이센스 종류별 비용, 일별만 쓸 때와 장중까지 쓸 때의 차이, 업력 7년 미만 기본료 면제 조건, 법인 요건을 알려 주세요.

## 출처
- [KRX Open API 서비스 소개](https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO001.jsp) · [데이터 수신방법](https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA003.jsp) · [데이터 구입안내](https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA001.jsp)
- [KRX Data Marketplace 상품 소개](https://data.krx.co.kr/contents/MDC/INFO/informationController/MDCINFO008.cmd) · [이용안내](https://data.krx.co.kr/contents/MDC/INFO/informationController/MDCINFO002.cmd)
- [공공데이터포털 금융위원회_주식시세정보](https://www.data.go.kr/data/15094808/openapi.do) · [증권상품시세정보](https://www.data.go.kr/data/15094806/openapi.do)
- [코스콤 오픈API 이용 대상 및 수수료](https://koscom.gitbook.io/open-api/how-to-use/procedure/charge) · [이용절차](https://koscom.gitbook.io/open-api/how-to-use/procedure) · [시세 서비스 v3](https://koscom.gitbook.io/open-api/api/marketv3)
- [에프앤가이드 금융정보 서비스](https://corp.fnguide.com/Service/FinancialService) · [FnSpace 서비스 소개](https://fnspace2.fnguide.com/Customer/Info)
- [KIS Developers 제휴 안내](https://apiportal.koreainvestment.com/provider-doc1) · [vm-stock-kis 이슈 #96](https://github.com/visualmoney/vm-stock-kis/issues/96) · [oat 이슈 #528(공급원 선택 사례)](https://github.com/Gn0lee/oat/issues/528)
- [키움증권 약관 목록](https://www.kiwoom.com/m/customer/financeguide/VClauseListView)
- [TradingView 위젯 데이터 FAQ](https://pl.tradingview.com/widget-docs/faq/data/) · [TradingView KRX 데이터](https://www.tradingview.com/blog/en/krx-korea-stock-exchange-data-already-available-9006)
- [주달](https://www.judal.co.kr/)
