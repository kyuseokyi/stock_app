# Docker Swarm 배포 설정

전체 설명·명령은 초보자 가이드 **[docs/deploy/README.md](../../docs/deploy/README.md) §B** 를 보세요.

| 파일 | 내용 |
|------|------|
| `stack.yml` | 백엔드 7개 서비스(auth/blog/stock_api/trading_game ×2, celery_worker ×2, celery_beat·game_ws ×1) |
| `stack.env.example` | 비밀 아닌 설정 예시 → `stack.env` 로 복사(커밋 금지) |

```bash
set -a; . deploy/swarm/stack.env; set +a
docker stack deploy -c deploy/swarm/stack.yml stock
```

- 비밀값은 `docker secret create` 로 등록(이 폴더에 파일로 두지 않음).
- 배포 전 마이그레이션 1회: 가이드 §B-5.
- `celery_beat`·`game_ws` 는 **절대 replicas 를 올리지 마세요**(중복 실행).
