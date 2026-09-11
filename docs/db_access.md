# DB 접속 가이드 (DataGrip / DBeaver / CLI)

로컬 개발 DB와 **개발서버(미니PC) DB**에 GUI 툴·CLI로 접속하는 방법. 개발서버 DB는 **LAN 전용**(Cloudflare 터널에 노출 금지)이라, 기존 cloudflared SSH 경로 위로 **SSH 터널**로만 붙는다.

> 관련: [`run_and_deploy.md`](./run_and_deploy.md)(로컬 실행·배포) · [`cloudflare_termius_guide.md`](./cloudflare_termius_guide.md)(cloudflared/Termius) · [`server_setup.md`](./server_setup.md)(서버 런북)

## 접속 값 (공통)
| DB | User | Password | Database | 포트 |
|---|---|---|---|---|
| PostgreSQL | `stock_user` | `stock_password` | `stock_db` | 5432 |
| ClickHouse | `default` | `password` | `stock_data` | 8123(HTTP) / 9000(Native) |

> 개발서버 DB 비번을 `compose.env`로 커스텀했다면 그 값. 안 했으면 위 기본값. 앱은 ClickHouse를 **HTTP 8123**(clickhouse_connect)으로 쓴다.

---

## A. 로컬 DB (docker-compose.dev.yml)

`docker compose -f docker-compose.dev.yml up -d` 로 DB가 떠 있으면, DataGrip에서 **직접** 접속:

- `+` → Data Source → **PostgreSQL**: Host `localhost` · Port `5432` · `stock_user`/`stock_password` · DB `stock_db`
- `+` → Data Source → **ClickHouse**(드라이버 0.6.3+ 자동 다운로드): Host `localhost` · Port `8123` · `default`/`password` · DB `stock_data`

---

## B. 개발서버(미니PC) DB — SSH 터널 필수

### 사전 조건
- cloudflared가 `127.0.0.1:2222`를 열고 있어야 함 — 확인: `nc -z 127.0.0.1 2222` (셋업은 `cloudflare_termius_guide.md`).
- SSH 계정 `summersnow` + 서버 비밀번호(또는 등록한 SSH 키).

> **⚠️ Host는 `localhost`(5432/8123), 15432/18123 아님(방법 B-1 기준).**
> DataGrip 내장 SSH 터널에서 General 탭의 Host/Port는 **SSH 서버(미니PC) 입장**에서 해석된다. `localhost:5432` = 미니PC의 도커 PG. 15432/18123은 셸 스크립트(방법 B-2)를 켰을 때만 쓰는 로컬 포트.

### B-1. DataGrip 내장 SSH 터널 (권장 — 스크립트 불필요)

**PostgreSQL**
1. `+` → Data Source → **PostgreSQL**
2. **General 탭**: Host `localhost` · Port `5432` · User `stock_user` · Password `stock_password` · Database `stock_db`
3. **SSH/SSL 탭**: ☑ Use SSH tunnel → SSH configuration `...` 로 새로 추가
   - Host `127.0.0.1` · Port `2222` · User name `summersnow`
   - Authentication type **Password** → 서버 비밀번호(☑ Save password) — *SSH 키 등록 시 Key pair + 개인키 경로*
4. **Test Connection** → 최초 "host key is not known" 팝업은 Accept, 드라이버 없으면 Download → 초록 체크면 OK

**ClickHouse**
1. `+` → Data Source → **ClickHouse** (드라이버 Download)
2. **General 탭**: Host `localhost` · Port `8123` · User `default` · Password `password` · Database `stock_data`
3. **SSH/SSL 탭**: ☑ Use SSH tunnel → **B-1의 SSH 설정 재사용**(127.0.0.1:2222 / summersnow)
4. **Test Connection** → OK

### B-2. 셸 스크립트 터널 (대안)
```bash
./scripts/dev-db-tunnel.sh    # 별도 터미널 유지 (localhost:15432→PG, 18123→CH)
```
DataGrip은 SSH 설정 없이 직접: PostgreSQL Host `localhost` Port **`15432`**, ClickHouse Host `localhost` Port **`18123`** (creds 동일).

### 비번 없이 (선택, 1회 설정)
```bash
ssh-copy-id -p 2222 summersnow@127.0.0.1     # 비번 1회 입력해 키 등록
```
이후 SSH 인증을 **Key pair**로 바꾸면 비번 없이 접속되고, `dev-db-tunnel.sh`도 무인증으로 뜬다.

---

## 접속 후 확인 쿼리
```sql
-- PostgreSQL
SELECT id, name, order_index FROM boards ORDER BY order_index;
SELECT email, role FROM users;

-- ClickHouse (최신 1행은 반드시 FINAL — ReplacingMergeTree)
SELECT count(), uniqExact(ticker) FROM stock_data.daily_prices;
SELECT * FROM stock_data.daily_prices FINAL WHERE ticker='005930' ORDER BY date DESC LIMIT 30;
```

## 트러블슈팅
| 증상 | 원인/조치 |
|---|---|
| SSH `Connection refused` | cloudflared 미실행 → `launchctl load ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist`, `nc -z 127.0.0.1 2222` |
| SSH `Auth fail` | User=`summersnow`, 비번=미니PC 서버 비밀번호(Termius로 되던 자격증명) |
| DB `password authentication failed` | General 탭 DB 비번 문제 — 개발서버 실제 DB 비번과 일치해야(기본 `stock_password`/`password`) |
| ClickHouse 드라이버 오류 | 드라이버 0.6.3+ 로 업데이트(서버 24.8 호환) |
| Host를 15432/18123로 넣어 실패 | 내장 SSH 터널(B-1)에선 **5432/8123**. 15432/18123은 스크립트(B-2) 전용 |

> ⚠️ 개발서버 DB는 **공유 자원**이다 — DROP/DELETE/스키마 변경은 신중히(조회 위주). DB 포트는 절대 Cloudflare 터널에 노출하지 않는다(LAN 전용).
