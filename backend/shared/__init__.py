"""shared 패키지 — import 시 .env 를 최초 1회 로드한다.

모든 서비스(auth/blog/stock_api/collector)와 alembic 이 `shared.*` 를 import 하므로
여기서 env 를 로드하면 os.getenv 기반 설정들이 .env 값을 일관되게 읽는다.
"""

from .env import load_env

load_env()
