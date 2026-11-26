# 개발 서버가 상용 ClickHouse 를 읽기 전용으로 쓰기 — 서버 작업 절차(runbook)

- 설계·결정: [`docs/superpowers/specs/2026-11-18-dev-reads-prod-clickhouse-design.md`](../superpowers/specs/2026-11-18-dev-reads-prod-clickhouse-design.md) (5·6·8·9절)
- 코드 스위치: env `MARKET_DATA_SOURCE=prod_readonly` 는 **개발 서버에만** 넣는다. 상용에는 넣지 않으므로 상용 동작은 바뀌지 않는다.
- 이 문서에는 비밀값·IP 를 적지 않는다. 키 이름과 명령만 적는다. 명령 속 `<...>` 는 직접 채운다.
- 순서: **A. 상용 서버(1~4장)** → **B. 개발 서버(5~9장)** → C. 확인·되돌리기(10~12장)

---

## 0. 시작 전에

- [ ] 이 브랜치(`feature/dev-reads-prod-ch`)의 코드가 **먼저** 개발 서버에 배포되어 있어야 한다.
  - 개발 서버 반영은 사용자가 머지한 뒤다. `main` push 로 자동 배포되거나, `Deploy Server (Backend & Workers)` 워크플로를 수동 실행한다.
  - env 를 하나도 바꾸지 않은 상태라면 새 코드는 지금과 똑같이 동작한다.
  - 코드보다 env(`CLICKHOUSE_*` → 상용)를 먼저 바꾸면, 옛 코드가 상용 읽기 전용 계정에 쓰려다 실패하면서 KIS 쿼터만 쓴다.
- [ ] 상용 Cloudflare 쪽 준비는 이미 끝났다(설계 0절). 터널 `ch-ro.funnotedaily.com` → `tcp://localhost:8123`, Access 앱 `ch-ro`, 서비스 토큰 `dev-server-ch-readonly`. 토큰 없이 접근하면 403 이 나는 것도 확인했다.
- [ ] 서비스 토큰의 ID·비밀값을 손에 들고 있다. Cloudflare 대시보드에서 비밀값은 만들 때 한 번만 보인다. 잃어버렸으면 토큰을 다시 만든다.

---

## A. 상용 서버

### 1. 사전 확인 (읽기만, 값은 출력하지 않음)

```bash
# 1-1. 관리자 계정이 SQL 로 사용자를 만들 수 있는지 (0 이면 2장 필요, 1 이면 3장으로)
docker exec stock_clickhouse_prod grep -o '<access_management>[0-9]</access_management>' \
  /etc/clickhouse-server/users.d/default-user.xml

# 1-2. 앱이 CH 에 docker 망 안의 이름으로 붙는지 (1 이어야 4장의 포트 바인딩을 검토할 수 있다)
grep -c '^CLICKHOUSE_HOST=clickhouse$' /opt/stock_app/env/.env.production

# 1-3. 호스트 공개 포트로 우회하는 설정이 없는지 (출력이 없어야 한다)
grep -rn 'host-gateway\|extra_hosts' docker-compose.prod.yml deploy/swarm/ 2>/dev/null

# 1-4. 상용 cloudflared 가 어떻게 도는지 (호스트 systemd 인지, 컨테이너인지)
systemctl status cloudflared --no-pager 2>/dev/null | head -3
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i cloudflared
```

- 1-4 에서 **systemd(호스트)** 라면, 터널의 `tcp://localhost:8123` 은 호스트 포트를 뜻한다. 그래서 4장의 `127.0.0.1` 바인딩과 함께 쓸 수 있다.
- **컨테이너**라면 그 컨테이너의 localhost 는 호스트가 아니다. 지금 터널이 실제로 어떤 경로로 CH 에 붙는지부터 확인한다. 4장은 보류한다.

### 2. (1-1 이 0 일 때만) 사용자 관리 권한을 잠시 켜기

`docker-compose.prod.yml` 은 개발과 상용이 함께 쓰는 파일이므로 이번에는 고치지 않는다. 대신 실행 중인 컨테이너에 **설정 파일 하나를 잠깐 넣었다가 뺀다.**
- ClickHouse 는 users 설정 파일이 바뀌면 재시작 없이 다시 읽는다. 그래서 끊김이 없다.
- 컨테이너를 다시 만들면 이 파일은 사라진다. SQL 로 만든 사용자는 데이터 볼륨(`/var/lib/clickhouse/access`)에 남는다.

관리자 계정 이름은 문서에 고정하지 않는다. 컨테이너 자신의 `CLICKHOUSE_USER`(없으면 `default`)를 쓴다.
- 이미지 entrypoint 는 `CLICKHOUSE_USER` 가 `default` 가 아니거나 비밀번호가 있으면 `default` 대신 그 사용자를 만든다.
- 그런데 이름을 `default` 로 고정한 덮어쓰기 파일을 넣으면, **비밀번호 없는 `default` 를 되살릴 위험**이 있다.

```bash
# 2-1. 관리자 계정에 access_management 를 켜는 덮어쓰기 파일(이름이 default-user.xml 보다 뒤에 오게 zz-)
docker exec stock_clickhouse_prod sh -c 'u="${CLICKHOUSE_USER:-default}"; printf "<clickhouse><users><%s><access_management>1</access_management></%s></users></clickhouse>\n" "$u" "$u" > /etc/clickhouse-server/users.d/zz-tmp-access-management.xml'
# 2-2. 몇 초 기다린 뒤 적용됐는지 확인 — 권한 오류 없이 목록이 나오면 켜진 것
docker exec -it stock_clickhouse_prod sh -c 'clickhouse-client --user "${CLICKHOUSE_USER:-default}" --ask-password -q "SHOW USERS"'
```

- 2-2 의 `SHOW USERS` 에 **예상하지 않은 사용자**(예: 관리자 계정이 따로 있는데 `default` 가 보임)가 있으면 멈춘다. 바로 2-3 으로 파일을 지우고, 원인을 확인할 때까지 진행하지 않는다.
- 2-2 에서 `ACCESS_DENIED` 가 계속 나오면 다른 방법을 쓴다. 상용 배포 창에서 compose 에 `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT` 를 추가하는 방법(설계 5-2 의 1)을 **별도 결정**으로 진행한다.
- 3장을 마치면 **반드시** 2-3 으로 파일을 지운다.

```bash
# 2-3. (3장 뒤) 임시 파일 제거 — SQL 로 만든 dev_ro 는 그대로 남는다
docker exec stock_clickhouse_prod rm /etc/clickhouse-server/users.d/zz-tmp-access-management.xml
```

### 3. 읽기 전용 계정 `dev_ro` 만들기

비밀번호 원문이 셸 기록이나 clickhouse-client 기록에 남지 않도록 **해시만** 넘긴다.

```bash
# 3-1. 비밀번호를 화면에 보이지 않게 입력하고 sha256 해시만 만든다(값은 비밀번호 관리자에 따로 보관)
read -rs DEV_RO_PW; echo
DEV_RO_HASH=$(printf %s "$DEV_RO_PW" | sha256sum | cut -d' ' -f1); unset DEV_RO_PW
# 3-2. 관리자 계정으로 접속(컨테이너의 CLICKHOUSE_USER, 비밀번호는 프롬프트로)
docker exec -it stock_clickhouse_prod sh -c 'clickhouse-client --user "${CLICKHOUSE_USER:-default}" --ask-password --multiquery'
```

접속한 뒤 아래를 실행한다. `<해시>` 자리에는 `echo $DEV_RO_HASH` 의 값을 붙여 넣는다.

```sql
CREATE SETTINGS PROFILE IF NOT EXISTS dev_ro_profile SETTINGS
    readonly = 2,                                  -- 쓰기·DDL 금지, 세션 설정 변경은 허용(clickhouse-connect 호환)
    max_execution_time = 60 CONST,                 -- 쿼리당 60초(9장 측정 후 조정)
    max_memory_usage = 4000000000 CONST,           -- 4GB(상용 서버 메모리에 맞춰 조정)
    max_result_rows = 5000000 CONST, result_overflow_mode = 'throw' CONST,
    max_concurrent_queries_for_user = 8 CONST;
CREATE USER IF NOT EXISTS dev_ro IDENTIFIED WITH sha256_hash BY '<해시>'
    DEFAULT DATABASE stock_data SETTINGS PROFILE 'dev_ro_profile';
GRANT SELECT ON stock_data.* TO dev_ro;
-- (선택) 시간당 상한
CREATE QUOTA IF NOT EXISTS dev_ro_quota FOR INTERVAL 1 hour MAX queries = 20000, read_rows = 5000000000 TO dev_ro;
```

- `CONST` 나 `max_concurrent_queries_for_user` 줄이 24.8 에서 거부되면 그 줄만 빼고 다시 실행한다(설계 5-2).
- 끝나면 `unset DEV_RO_HASH` 를 실행하고 2-3 으로 임시 파일을 지운다.

### 4. 상용에서 직접 시험

```bash
# 4-1. 읽기 성공 — 숫자가 나와야 한다
docker exec -it stock_clickhouse_prod clickhouse-client --user dev_ro --ask-password \
  -q "SELECT count() FROM stock_data.daily_prices FINAL WHERE date = (SELECT max(date) FROM stock_data.daily_prices)"
# 4-2. 쓰기·DDL 거부 — 각각 권한 오류(ACCESS_DENIED / READONLY)가 나야 한다
docker exec -it stock_clickhouse_prod clickhouse-client --user dev_ro --ask-password \
  -q "CREATE TABLE IF NOT EXISTS stock_data.daily_prices (x UInt8) ENGINE = Memory"
docker exec -it stock_clickhouse_prod clickhouse-client --user dev_ro --ask-password \
  -q "ALTER TABLE stock_data.daily_prices ADD COLUMN IF NOT EXISTS source LowCardinality(String) DEFAULT 'kis'"
docker exec -it stock_clickhouse_prod clickhouse-client --user dev_ro --ask-password \
  -q "INSERT INTO stock_data.macro_series (series_id, date, value) VALUES ('__test__', today(), 0)"
```

- 4-1 에서 나온 숫자를 적어 둔다. 7장에서 개발 쪽 결과와 비교한다.
- 4-2 가운데 하나라도 **성공하면 멈춘다.** 권한부터 다시 본다.

### 4-3. (Q5) CH 포트를 `127.0.0.1` 로만 열기 — 이번에는 하지 않음, 다음 상용 배포 때 별도 결정

- 결정 사항(Q5)은 **CH 만** 바꾸는 것이다. 바꿀 내용은 `docker-compose.prod.yml` clickhouse `ports` 의 두 줄이다: `"8123:8123"` → `"127.0.0.1:8123:8123"`, `"9000:9000"` → `"127.0.0.1:9000:9000"`.
- 이 파일은 개발 서버와 함께 쓰므로 이번 브랜치에서는 바꾸지 않는다. 다음 상용 배포 창에서 따로 결정한다.
- 바꿔도 되는 조건은 셋이다. 하나라도 어긋나면 보류한다.
  1. 1-2 결과가 `1` 이다.
  2. 1-3 출력이 없다.
  3. 1-4 에서 cloudflared 가 호스트(systemd)에서 돈다.
- 바꾸면 `docs/deploy/single-node-swarm.md` 의 `extra_hosts: host-gateway` 대안은 쓸 수 없게 된다.
- PG(5432)·Redis(6379)·앱 포트는 이번 범위가 아니다. 별도로 점검한다.

---

## B. 개발 서버

### 5. 배포 방식과 망 이름 확인

```bash
docker info --format '{{.Swarm.LocalNodeState}}'; docker stack ls --format '{{.Name}}'
docker network ls --format '{{.Name}}' | grep -E 'stock_net|_default$'
# 앱 컨테이너가 실제로 붙어 있는 망(compose 모드에서 확인)
docker inspect stock_stock_api --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null
```

- **Swarm**(`active` 이고 스택 `stock` 이 있음): 망 이름은 `stock_net` 이다.
- **compose**: 위 `docker inspect` 가 보여 주는 망을 쓴다. 보통 `<프로젝트>_default` 다.
- 정한 이름을 6장의 `CH_RO_NETWORK` 에 넣는다.

### 6. 사이드카 env 파일 만들기 (저장소 밖, 권한 600)

파일 `/opt/stock_app/env/ch-ro-tunnel.env` 를 만들고 아래 **키 4개**를 넣는다. 값은 이 문서에 적지 않는다.

| 키 | 넣을 값 |
|---|---|
| `CH_RO_CLOUDFLARED_IMAGE` | `cloudflare/cloudflared:<고정 태그>`. `latest` 는 쓰지 않는다. Docker Hub 나 GitHub 릴리스에서 **나온 지 2주 이상 된** 태그를 골라 적는다 |
| `CH_RO_NETWORK` | 5장에서 정한 망 이름 |
| `TUNNEL_SERVICE_TOKEN_ID` | 서비스 토큰 `dev-server-ch-readonly` 의 ID |
| `TUNNEL_SERVICE_TOKEN_SECRET` | 같은 토큰의 비밀값 |

```bash
sudo install -m 600 -o "$(id -u)" /dev/null /opt/stock_app/env/ch-ro-tunnel.env
${EDITOR:-vi} /opt/stock_app/env/ch-ro-tunnel.env      # 위 4개 키 입력
grep -c '=' /opt/stock_app/env/ch-ro-tunnel.env          # 4 (값은 출력하지 않는다)
```

- 상용 Access 정책에서 서비스 토큰에 만료일이 있으면, 그 날짜를 운영 일정에 적어 둔다.

### 7. 사이드카 띄우기와 연결 시험

```bash
cd <개발 서버의 stock_app 체크아웃>
docker compose --env-file /opt/stock_app/env/ch-ro-tunnel.env -f deploy/dev/ch-ro-tunnel.yml up -d
docker logs --tail 20 stock_ch_ro_tunnel          # 오류 없이 대기 중이면 정상
```

연결 시험은 앱 컨테이너 안에서 한다. 사이드카와 같은 망에 있고 파이썬이 있기 때문이다. 비밀번호는 프롬프트로 받는다.

```bash
API=$(docker ps --format '{{.Names}}' | grep -E 'stock_api' | head -1)
docker exec -it "$API" python - <<'PY'
import getpass, clickhouse_connect
c = clickhouse_connect.get_client(host="stock_ch_ro_tunnel", port=18123, username="dev_ro",
                                  password=getpass.getpass("dev_ro 비밀번호: "), autogenerate_session_id=False)
print("SELECT 1 →", c.command("SELECT 1"))
print("최근 거래일 일봉 행 수 →", c.command(
    "SELECT count() FROM stock_data.daily_prices FINAL WHERE date = (SELECT max(date) FROM stock_data.daily_prices)"))
try:
    c.command("CREATE TABLE IF NOT EXISTS stock_data.daily_prices (x UInt8) ENGINE = Memory")
    print("⚠ CREATE 가 통과함 — 멈추고 3장 권한 확인")
except Exception as e:
    print("CREATE 거부(정상):", str(e)[:120])
PY
```

- 행 수가 4-1 에서 적어 둔 값과 같아야 한다.
- `SELECT 1` 이 시간 초과로 실패하면 다음 순서로 확인한다.
  1. 사이드카 로그
  2. 5장의 망 이름
  3. 토큰 키 이름(`TUNNEL_SERVICE_TOKEN_ID/SECRET`)

### 8. 개발 백엔드 env 바꾸기 (`/opt/stock_app/env/.env.production`)

**순서가 중요하다.** 먼저 지금의 CH 접속값을 `CLICKHOUSE_LOCAL_*` 로 복사해 둔다. 그다음 `CLICKHOUSE_*` 를 상용으로 바꾼다.

```bash
cp /opt/stock_app/env/.env.production /opt/stock_app/env/.env.production.bak-$(date +%Y%m%d)   # 되돌리기용(권한 그대로 600)
${EDITOR:-vi} /opt/stock_app/env/.env.production
```

| 키 | 바꾼 뒤 값의 의미 |
|---|---|
| `CLICKHOUSE_LOCAL_HOST` / `CLICKHOUSE_LOCAL_PORT` / `CLICKHOUSE_LOCAL_USER` / `CLICKHOUSE_LOCAL_PASSWORD` | **지금의** `CLICKHOUSE_HOST/PORT/USER/PASSWORD` 값을 그대로 옮긴다(개발 자체 CH). 4개 모두 넣는다. 코드는 USER/PASSWORD 를 다른 키로 대신 채우지 않는다 |
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` | `stock_ch_ro_tunnel` / `18123` |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | `dev_ro` / 3장에서 정한 비밀번호 |
| `CLICKHOUSE_DB` | `stock_data`(그대로) |
| `CLICKHOUSE_CONNECT_TIMEOUT` / `CLICKHOUSE_SEND_RECEIVE_TIMEOUT` | 예: `5` / `60`. 9장에서 측정한 뒤 조정한다 |
| `MARKET_DATA_SOURCE` | `prod_readonly` |
| `DEV_PIPELINE_HOUR` / `DEV_PIPELINE_MINUTE` | 생략하면 23:30. 상용 파이프라인 종료 시각(관리자 > 데이터 현황 `finished_at`)보다 늦게 잡는다 |

```bash
grep -cE '^(MARKET_DATA_SOURCE|CLICKHOUSE_LOCAL_(HOST|PORT|USER|PASSWORD))=' /opt/stock_app/env/.env.production   # 5
```

그다음 백엔드를 다시 배포한다. GitHub Actions 의 `Deploy Server (Backend & Workers)` 를 수동 실행하면 env 파일을 다시 복사하고, celery beat 도 다시 띄운다. beat 목록은 기동할 때 정해지므로 beat 까지 재기동해야 반영된다.

### 9. 읽기 시간 측정 (임시 한도 확정)

```bash
WORKER=$(docker ps --format '{{.Names}}' | grep -E 'celery_worker' | head -1)
docker exec -it "$WORKER" sh -c 'time python -c "from apps.collector.tasks.featured import compute_featured_highs as f; print(f())"'
```

- 걸린 시간에 여유를 더해 두 값을 정한다. 하나는 상용 프로필의 `max_execution_time`(3장)이고, 다른 하나는 개발 env 의 `CLICKHOUSE_SEND_RECEIVE_TIMEOUT` 이다. 문서의 60초는 임시값이다.

---

## C. 확인 · 되돌리기

### 10. 전환 직후와 다음 날 확인

- [ ] 시장 탭이 열리고, 종목 차트가 상용 값과 같은지 본다. 기준은 005930 2026-08-05 종가 242,000, 거래량 43,358,171 이다.
- [ ] 스크리너·CANSLIM·패턴의 기준일이 상용과 같은지 본다.
- [ ] 관리자 > 계산 수동 실행에서 CANSLIM·조건검색·패턴·초기 데이터 준비를 눌러 본다. "개발 서버는 상용 데이터를 읽기만 해요" 가 떠야 한다. 시장 그룹 두 작업은 실행돼야 한다.
- [ ] 게임 분봉 차트가 개발 시즌 종목으로 쌓이는지 본다. 쌓이는 곳은 개발 자체 CH 다.
- [ ] 다음 날 확인할 것:
  - 20:30 에 개발 워커 로그에 KIS 일봉 호출이 없다.
  - 23:30(설정한 시각)에 관리자 데이터 현황에 경량 파이프라인 기록이 남는다. 단계는 `종목 마스터 동기화`·`시장 그룹`·`신고저가` 다.
  - 신고저가 특징주가 당일 기준이다.
  - 테마 상세의 설명과 구성 종목이 맞다.
- [ ] FRED(08:00): `FRED_API_KEY` 가 있으면 발표 일정(PG)이 계속 갱신되는지 본다. `macro_series` 는 개발 자체 CH 에 쌓이고, 화면은 상용 값을 본다.

### 11. 장애 시험 (한 번)

```bash
docker stop stock_ch_ro_tunnel
# → 시장 탭: 오류 또는 '준비 중', /ready: 200 유지, 종목 차트: 가짜 캔들 대신 빈 차트
docker start stock_ch_ro_tunnel     # → 1분 안에 정상으로 돌아오는지 확인
```

- 서버를 재부팅하면, 이 사이드카(compose 컨테이너)가 overlay 망 `stock_net` 에 다시 붙는지 확인한다. DB 컨테이너와 같은 위험이 있다(`docs/deploy/single-node-swarm.md`). 재부팅 점검 목록에 `stock_ch_ro_tunnel` 을 추가한다. → 반영됨(2026-11-26): `single-node-swarm.md` 9절 3번, 배포 사전 점검(`deploy/swarm/preflight.sh`)이 이 컨테이너가 있으면 실행·이름 해석까지 확인한다.

### 12. 되돌리기 (env 한 묶음)

1. 8장에서 만든 백업으로 되돌린다. 또는 `MARKET_DATA_SOURCE` 를 지우고 `CLICKHOUSE_*` 를 `CLICKHOUSE_LOCAL_*` 값으로 되돌린다. 그다음 백엔드를 다시 배포한다. 그러면 20:30 자체 수집과 beat 가 원래대로 돌아온다.
2. **공백 메우기**: 겹침 창은 일봉 30일, 세부 수급·대차 5거래일이다. 꺼 둔 기간이 이보다 길면 관리자 "초기 데이터 준비" 또는 해당 백필을 한 번 돌린다. 지수·CANSLIM·스크리너·패턴도 백필로 메운다.
3. 사이드카를 내린다: `docker compose --env-file /opt/stock_app/env/ch-ro-tunnel.env -f deploy/dev/ch-ro-tunnel.yml down`
4. 상용 `dev_ro` 계정은 남겨 둬도 무해하다. 지우려면 상용에서 `DROP USER dev_ro` 를 실행한다. 이때 2장 권한이 필요하고, 접속은 3-2 와 같이 컨테이너의 `CLICKHOUSE_USER` 로 한다. Access 서비스 토큰은 폐기하거나 회전한다.

### 운영 규칙 (전환 뒤 계속)

- **CH 스키마 변경은 상용에 먼저 반영한다.** 개발 코드가 새 컬럼이나 테이블(`ensure_*` 의 `ALTER ADD COLUMN` 등)을 읽어도, 개발에는 DDL 권한이 없어 만들 수 없다. 상용 배포가 먼저 나가거나, 상용에서 해당 `ensure_*` 를 수동으로 실행한 뒤에 개발에서 검증한다.
- 로컬 맥(`scripts/dev-db-tunnel.sh`)은 계속 개발 자체 CH 를 본다(Q4, 이번 범위 밖). 그 CH 에서 일봉 등은 전환 시점에 멈추고, 게임 분봉·시장 그룹·FRED 만 계속 쌓인다.
