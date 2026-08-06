# ClickHouse 백업 · 복원 (배포용)

로컬에서 수집·백필한 주가 데이터(`stock_data`)를 백업해 **운영 서버로 이전**하는 절차.
서버에서 다시 전종목 백필(~1시간)을 돌리지 않고 데이터를 그대로 옮길 수 있다.

- 스크립트: `backend/scripts/backup_clickhouse.sh`, `backend/scripts/restore_clickhouse.sh`
- 대상: `stock_data` DB의 모든 테이블(`daily_prices` 등). 스키마(DDL)+데이터(Native)를 tar.gz 하나로 묶음.
- `daily_prices`는 `ReplacingMergeTree`라 **FINAL로 중복제거 후 덤프**, 재복원해도 `(ticker,date)` 멱등.

> ℹ️ 이 데이터는 재수집 가능(멱등)하다. **시간 절약이면 백업 이전**, **깔끔함이면 서버에서 `backfill_all_daily` 재수집** — 둘 다 유효. 아래는 백업 이전 방식.

---

## 1. 백업 (로컬)

```bash
cd backend
./scripts/backup_clickhouse.sh
# → ./backups/stock_data_YYYYMMDD_HHMMSS.tar.gz 생성
```

출력 위치·접속정보는 환경변수로 조정:

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `CH_CONTAINER` | 자동탐지(`docker ps`에서 clickhouse) | ClickHouse 도커 컨테이너명 |
| `CH_USER` | `default` | 사용자 |
| `CH_PASSWORD` | `password` | 비밀번호 |
| `CH_DB` | `stock_data` | 대상 DB |
| `OUT_DIR` | `./backups` | 백업 출력 디렉토리 |

```bash
# 예: 다른 위치로, 운영 접속정보로
OUT_DIR=/data/backups CH_PASSWORD='***' ./scripts/backup_clickhouse.sh
```

> ⚠️ **백필/수집이 도는 중에는 백업을 피하세요.** 쓰기 중 스냅샷은 행수가 어긋날 수 있습니다.
> 자동수집(worker/beat)을 잠시 멈췄다가(또는 장중이 아닌 시간에) 백업하세요.

---

## 2. 서버로 전송

```bash
scp backups/stock_data_YYYYMMDD_HHMMSS.tar.gz  user@server:/data/backups/
```

---

## 3. 복원 (서버)

```bash
cd backend
./scripts/restore_clickhouse.sh /data/backups/stock_data_YYYYMMDD_HHMMSS.tar.gz
```

- DB/테이블이 없으면 백업의 DDL로 **자동 생성**(대상 DB명은 `CH_DB`로 치환 가능).
- 데이터 삽입 후 `OPTIMIZE ... FINAL`로 정리. 빈 테이블은 스키마만 복원.
- 접속정보는 백업과 동일하게 환경변수로:

```bash
CH_PASSWORD='***' CH_CONTAINER=stock_clickhouse \
  ./scripts/restore_clickhouse.sh /data/backups/stock_data_20260806_170000.tar.gz
```

**검증:**
```bash
docker exec <ch> clickhouse-client --user default --password '***' --query \
  "SELECT count(DISTINCT ticker), count() FROM stock_data.daily_prices FINAL"
```

---

## 4. 버전 주의 (필수)

서버 ClickHouse 버전을 **로컬과 동일(24.8 LTS)** 로 맞추세요. Native 포맷은 버전 간
호환되지만, 메이저 버전이 크게 다르면 문제가 생길 수 있습니다. (`docker-compose.dev.yml`에 24.8 고정)

---

## 5. 전체 배포 흐름 (요약)

| 대상 | 방식 |
|---|---|
| **ClickHouse**(`stock_data`, 주가) | 위 백업→전송→복원. 또는 서버에서 `collector.backfill_all_daily` 재수집 |
| **PostgreSQL**(auth 유저·블로그) | **로컬 데이터 복사 금지.** 서버에서 새로: `alembic upgrade head` + `python -m apps.auth.seed_admin` |
| **수집 지속** | 서버에서 celery worker+beat 기동 → 매일 20:30 자동수집으로 최신 유지 |

> PostgreSQL은 로컬에 테스트 유저·개발 게시글이 섞여 있어 그대로 올리면 안 됩니다.
> 스키마는 마이그레이션, 관리자만 시드하고 운영 데이터는 서버에서 새로 쌓습니다.

---

## 6. (선택) 정기 백업 cron

```bash
# 매일 21:00 백업(자동수집 20:30 이후), 7일 넘은 백업 삭제
0 21 * * * cd /path/backend && OUT_DIR=/data/backups ./scripts/backup_clickhouse.sh \
  && find /data/backups -name 'stock_data_*.tar.gz' -mtime +7 -delete
```
