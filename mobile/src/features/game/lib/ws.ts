import { toNumOrNull } from './decimal';
import type { GameWsMessage } from '../types';

// WS 원문(JSON 문자열) → 판별 유니온. 형식이 틀리거나 모르는 type 은 null(무시) — (web lib/gameWs.ts 와 동일)
// 백엔드에 새 메시지 type 이 추가돼도 기존 클라이언트가 깨지지 않게 한다.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function parseGameMessage(raw: string): GameWsMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data)) return null;

  switch (data.type) {
    case 'tick': {
      const ticker = str(data.ticker);
      const price = toNumOrNull(data.price);
      return ticker !== null && price !== null ? { type: 'tick', ticker, price } : null;
    }
    case 'position_pnl': {
      const id = str(data.position_id);
      const roi = toNumOrNull(data.roi_pct);
      const pnl = toNumOrNull(data.pnl_amount);
      return id !== null && roi !== null && pnl !== null
        ? { type: 'position_pnl', position_id: id, roi_pct: roi, pnl_amount: pnl }
        : null;
    }
    case 'sentiment': {
      const long = toNumOrNull(data.long_pct);
      const short = toNumOrNull(data.short_pct);
      if (long === null || short === null) return null;
      // total(보유 인원)은 신규 필드 — 없거나 형식이 틀리면 생략(구 서버 호환)
      const total = toNumOrNull(data.total);
      return {
        type: 'sentiment',
        long_pct: long,
        short_pct: short,
        ...(total !== null && total >= 0 ? { total: Math.round(total) } : {}),
      };
    }
    case 'nudge': {
      const id = str(data.position_id);
      const n = data.nudge;
      if (id === null || !isObj(n)) return null;
      const type = str(n.type);
      const code = str(n.code);
      const message = str(n.message);
      return type !== null && code !== null && message !== null
        ? { type: 'nudge', position_id: id, nudge: { type, code, message } }
        : null;
    }
    case 'coach': {
      const seasonId = toNumOrNull(data.season_id);
      const title = str(data.title);
      const summary = str(data.summary_nudge);
      if (seasonId === null || title === null || summary === null) return null;
      return {
        type: 'coach',
        coach: {
          season_id: seasonId,
          coach_type: str(data.coach_type) ?? '',
          title,
          summary_nudge: summary,
          content_md: null, // WS 페이로드에는 본문이 없다
          support_price: toNumOrNull(data.support_price),
          resistance_price: toNumOrNull(data.resistance_price),
        },
      };
    }
    default:
      return null;
  }
}

// ── 연결 URL·종료 코드 판정(use-game-socket 에서 사용, 순수 함수라 테스트 가능) ──

/** 서버 ws_gateway: 토큰 무효/비활성 유저(로그인 연결) */
export const WS_AUTH_FAILED = 4401;
/** 서버 ws_gateway: 공개(비로그인) 연결 상한 초과 — accept 직후 닫힘 */
export const WS_OVER_CAPACITY = 4429;

/** 게임 WS URL. 토큰이 없으면 token 파라미터 자체를 생략(공개 연결) — 빈 `?token=` 은 서버가 4401 로 거부한다. */
export function buildGameWsUrl(baseUrl: string, token: string | null): string {
  const base = `${baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws/game/stream`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/**
 * 종료 코드 → 다음 동작.
 * - auth-failed: 로그인 연결의 4401 — 재연결하지 않고 로그인 만료 처리
 * - capacity: 4429 — 별도(긴) 백오프로 재시도
 * - retry: 그 외(공개 연결의 4401 포함) — 일반 지수 백오프 재연결
 */
export type WsCloseAction = 'auth-failed' | 'capacity' | 'retry';
export function classifyWsClose(code: number, hasToken: boolean): WsCloseAction {
  if (code === WS_AUTH_FAILED && hasToken) return 'auth-failed';
  if (code === WS_OVER_CAPACITY) return 'capacity';
  return 'retry';
}
