// 교육용 합성 종가 게임 REST — 기존 실시간 게임과 같은 게임 서버(ENV.gameApiUrl)·같은 HTTP 클라이언트(createHttpClient).
// 토큰 부착·401 갱신 후 재시도·세션 종료 안내는 createHttpClient 공용 흐름을 그대로 탄다.
// (game/api.ts 의 gameHttp 는 모듈 비공개라 같은 주소로 인스턴스를 하나 더 만든다 — 상태 없는 fetch 래퍼라 동작은 같다)
import { ApiError, createHttpClient, type HttpClient } from '@/lib/api/http';
import { ENV } from '@/lib/env';

import type {
  EduActionRequest,
  EduActionResponse,
  EduFeatures,
  EduHistory,
  EduLeaderboard,
  EduState,
} from './types';

const eduHttp: HttpClient | null = ENV.gameApiUrl ? createHttpClient(ENV.gameApiUrl) : null;

/** 게임 서버 미설정이면 교육 게임도 없음(탭 숨김) */
export const isEduConfigured = (): boolean => eduHttp !== null;

function client(): HttpClient {
  if (!eduHttp) throw new Error('GAME_API_URL 미설정');
  return eduHttp;
}

/** 시즌·최근 120봉·오늘 해설·참여자 비율 + (로그인 시) 내 계좌. 비로그인 가능, 꺼져 있으면 {enabled:false} */
export const getEduState = (): Promise<EduState> => client().get<EduState>('/api/game/edu/state');

/**
 * 하단 게임 탭 노출 판단값 — 전역 플래그 두 개만(가볍고 시즌을 만들지 않는다).
 * features 가 없는 옛 서버(404)면 state 로 한 번 폴백해 같은 두 값을 꺼낸다(배포 순서와 무관하게 동작).
 */
export async function getEduFeatures(): Promise<EduFeatures> {
  try {
    const f = await client().get<EduFeatures>('/api/game/edu/features');
    return { enabled: f?.enabled === true, real_market_switch: f?.real_market_switch === true };
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
    const s = await getEduState();
    return { enabled: s?.enabled === true, real_market_switch: s?.real_market_switch === true };
  }
}

/** 하루 1회 의사결정 제출 — 오류 409 {detail:{code,message}}, 꺼짐 403 {detail:'edu_game_disabled'} */
export const submitEduAction = (body: EduActionRequest): Promise<EduActionResponse> =>
  client().post<EduActionResponse>('/api/game/edu/action', body);

export const getEduLeaderboard = (): Promise<EduLeaderboard> => client().get<EduLeaderboard>('/api/game/edu/leaderboard');

/** 이번 시즌 내 참가 내역(로그인 필요) */
export const getEduHistory = (): Promise<EduHistory> => client().get<EduHistory>('/api/game/edu/history');
