# 06. 스크리너 — 저장형 조건검색 & 안전한 QueryBuilder

← [인덱스](00-index.md) · 관련: [04-indicators-rs-ta.md](04-indicators-rs-ta.md)

> AMS 스크리너는 **저장형(user-savable) + 카테고리 메타 기반**으로 성숙하다. stock_app이 제품 수준 스크리너를 만들 때의 청사진. 단, **동적 문자열 SQL(주입 취약점)** 은 반드시 개선해서 가져와야 한다.

## 1. 2계층 구조

1. **영속 계층**(Postgres): 저장 가능한 트리형 스크린 라이브러리. **admin이 정의한 카탈로그**(카테고리+항목)가 선택지를 정의, **사용자 저장 스크린**이 카탈로그 항목을 참조 + 항목별 `options` 저장.
2. **실행 계층**: 조회 시 저장된 항목을 SQL WHERE로 컴파일해 분석 스토어(AMS는 DuckDB 최신 / ClickHouse 과거·임의일)에 실행.

## 2. 데이터 모델 (저장형 스크리너)

**카탈로그(admin 정의, 공유)**
- `screen_category` — 카테고리 트리(`parent_id`, `path_sort_key` materialized path, `is_visible`)
- `screen_category_item` — **선택 가능한 조건 정의**. 핵심 컬럼 **`item_key`**(코드 빌더와의 조인 = 화이트리스트 키), `value_type`, `input_type`, `min/max`, `options`(JSON)

**사용자 소유**
- `user_screen` — 저장 스크린 또는 폴더(`is_folder`), 트리(`parent_id`+`path_sort_key`), soft-delete
- `user_screen_item` — **조합 행**. 복합PK `(user_screen_id, screen_category_item_id)`, `options`(JSON 실제 값/연산자), `logical`(**1=AND, 2=OR**)
- `user_favorite_screen` / `user_favorite_item` — 즐겨찾기

**options 형태**(discriminated union):
```jsonc
{"field":"price","op":">=","value":10}          // 단일
[{"field":"change_1m_pct","op":">","value":5}]   // 리스트(logical로 AND/OR)
[[{...},{...}],[{...}]]                            // 중첩(OR-of-AND, exceptional)
```

## 3. 조건 카탈로그 (item_key 발췌)

`QueryBuilder.builders`가 화이트리스트. 주요 항목:

| item_key | 의미 | TA 컬럼/SQL |
|---|---|---|
| `price`, `price_change` | 가격/변동(환율변환) | `price`, `price_change` |
| `change_1w/1m/3m/6m/12m/ytd_pct` | 기간 수익률 | 동명 컬럼 |
| `vs_52w_high`, `vs_index_26w` | 52주고가/지수 대비 | 동명 |
| `cr_daily/cr_weekly` | 일/주 종가 위치 | 동명 |
| `vs_sma10/21/50/150/200` | 이평 대비 | 동명 |
| `sma_positive_align_enable` | SMA 정배열 | `sma50>sma150 AND sma150>sma200` |
| `is_rs_line_within_proximity` | RS라인 근접 | `rs_line_proximity <= N` |
| `is_rs_line_new_high/low` | RS라인 신고/저가 | 동명(0/1) |
| `rs_rating`, `rs_rating_1m/3m/6m/12m` | RS 레이팅 | 동명(가중시 `weighted_*`) |
| `eps_rating` | EPS 레이팅 | `eps_rating` |
| `industry/sector_rs_rating`, `*_percent_rank` | 산업/섹터 RS | 동명 |
| `atr5/10/21/30/50` | ATR% | 동명 |
| `volume`, `vol_sma50` | 거래량(×1000) | 동명 |
| `day_vs_vsma50`, `week_vs_vwsma10` | 거래량 변화율 | 동명 |
| `exchange_id/sector_id/industry_id` | 필터 | `IN (...)` (국가 스코프) |
| `name_of_stocks` | 이름검색 | `name LIKE '%..%'` |
| `vcp_setting` | VCP | 복합 조건 |
| `runup_hp_*`, `off_hp_pct`, `max_drawdown_hp`, `days_since_hp` | HP 계열 | 리졸버로 컬럼 매핑 |

**일관성 가드**(채택 가치): 기동 시 모든 비가상 빌더 키가 실제 결과 컬럼에 존재하는지 assert.

## 4. ⭐ 단계별 통계 (funnel) — `screen_result_stats`

각 조건을 **누적 AND**로 적용하며 생존 종목 수를 세, "어느 필터가 얼마나 걸러냈는지" 제공:
- 단계 predicate = 이전 단계들의 누적 AND
- **한 행에 병렬 조건부 카운트**: DuckDB `COUNT(*) FILTER (WHERE 누적)`, ClickHouse `countIf(누적)`
- 연속 컬럼 간 감소량 = 그 필터가 제거한 수. 전체 = `total_stock_count`

→ **stock_app 채택**: Postgres `FILTER (WHERE ...)` 네이티브 지원. 동일 predicate 객체를 누적 합성해 `count().filter(and_(*prefix))`로 재현.

## 5. 실행 경로 (dual engine)
기본 DuckDB(최신 스냅샷), 과거 `target_date`면 ClickHouse 강제. 국가별 뷰 `v_final_ta_kr/us`(DuckDB) / `stock_ta_daily_dedup` FINAL 필터(ClickHouse). HP/VCP/weighted-RS는 **참조될 때만** LEFT JOIN 서브쿼리 추가(`\bcol\b` 정규식 참조탐지).
→ stock_app은 **ClickHouse 단일 엔진**이라 이 이중 경로 불필요(단순화 이점).

## 6. ⚠️ 보안 — 반드시 개선할 것

**파라미터화(안전)**: 영속 SQL(create/copy/upsert), ClickHouse의 country_code(정규식), date(정규식), limit/offset(`int()`), sort_column(화이트리스트).

**문자열 연결(주입 취약)**: `build_sql_parts`가 `option['field']`를 **그대로** SQL에 삽입하고 문자열 value를 **이스케이프 없이** 따옴표로 감쌈. `field`는 사용자 JSON에서 오며 **화이트리스트 안 됨**(op만 Pydantic Literal 검증). → 저장된 자기 스크린 내에서라도 실제 SQLi 벡터.

## 7. ⭐ stock_app용 안전한 QueryBuilder 설계

**화이트리스트 우선 + 파라미터 바인딩** 컴파일러:
1. **필드 레지스트리**: `FIELD_SPEC: {item_key → {column, type, allowed_ops, transform}}`. 레지스트리에 없는 `field`는 거부. **물리 컬럼명은 레지스트리에서만** 오고 사용자 입력에서 절대 안 옴.
2. **연산자 화이트리스트**: enum → 서버측 SQL 연산자 매핑.
3. **값은 항상 바인드 파라미터**, 절대 인터폴레이션 안 함. `IN`은 `IN (:p0,:p1,...)` 확장, `LIKE`는 `f"%{v}%"`를 파라미터로 바인드.
4. **SQLAlchemy Core**로 파라미터화 SQL 생성 — `Column >= :p`, `.in_()`, `.like()`, `and_()/or_()`. AMS의 표현력 있는 AND/OR 중첩은 유지하되 주입 제거.
5. funnel은 동일 predicate 객체를 누적 합성 → `func.count().filter(and_(*prefix))`.
6. `sort_column`은 레지스트리 검증, `limit/offset`은 `int` 캐스팅 + 상한.

## 8. 최소 저장형 스크리너 스키마 (Postgres)

AMS 대비 안전/견고 개선점: `options`를 **`JSONB`**(TEXT 아님), 실제 FK + `ON DELETE CASCADE`, `item_key`를 코드 레지스트리로 제약, 컴파일러는 화이트리스트+바인드만.

```sql
-- admin 카탈로그
CREATE TABLE screen_category (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL,
  parent_id BIGINT REFERENCES screen_category(id),
  sort_order INT DEFAULT 0, path_sort_key TEXT DEFAULT '',
  is_visible BOOLEAN DEFAULT TRUE, is_deleted BOOLEAN DEFAULT FALSE, meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE screen_category_item (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES screen_category(id),
  parent_item_id BIGINT REFERENCES screen_category_item(id),
  name TEXT NOT NULL,
  item_key TEXT NOT NULL UNIQUE,      -- 코드 FIELD_SPEC과 1:1
  value_type SMALLINT, input_type SMALLINT,
  min NUMERIC(18,4), max NUMERIC(18,4), options JSONB,
  is_visible BOOLEAN DEFAULT TRUE, is_deleted BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0, path_sort_key TEXT DEFAULT '');

-- 사용자 소유
CREATE TABLE user_screen (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, name TEXT NOT NULL,
  is_folder BOOLEAN DEFAULT FALSE,
  parent_id BIGINT REFERENCES user_screen(id),
  sort_order INT DEFAULT 0, path_sort_key TEXT DEFAULT '',
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX ON user_screen (user_id, parent_id);

CREATE TABLE user_screen_item (
  user_screen_id BIGINT NOT NULL REFERENCES user_screen(id) ON DELETE CASCADE,
  screen_category_item_id BIGINT NOT NULL REFERENCES screen_category_item(id),
  user_id BIGINT NOT NULL,
  options JSONB NOT NULL,             -- {field,op,value} | [...] | [[...],...]
  logical SMALLINT NOT NULL DEFAULT 1 CHECK (logical IN (1,2)),  -- 1=AND,2=OR
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_screen_id, screen_category_item_id));

CREATE TABLE user_favorite_screen (
  user_id BIGINT NOT NULL,
  screen_id BIGINT NOT NULL REFERENCES user_screen(id) ON DELETE CASCADE,
  sort_order INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, screen_id));
```

## 9. 채택 요약

**Adopt**: 카탈로그+저장스크린 분리 · `item_key` 화이트리스트 조인 · 기동 일관성 assert · 누적 funnel(`countIf`/`FILTER`) · materialized-path 트리 · `ColumnResolver`(사용자키≠물리컬럼) · 참조탐지 조건부 JOIN.
**Avoid**: `build_sql_parts` 문자열 연결(비화이트리스트 field·미이스케이프 value) · limit/offset raw 인터폴레이션 · AND/OR를 매직 int로만 저장(→ enum/CHECK).
