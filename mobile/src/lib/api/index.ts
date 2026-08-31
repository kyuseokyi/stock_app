/**
 * API 계층 진입점. 화면/서비스 코드는 여기서만 가져다 쓴다.
 *  - blogApi / authApi : REST(fetch) 서비스별 인스턴스
 *  - stockRequest      : stock_api GraphQL 요청
 */
import { ENV } from '@/lib/env';

import { createHttpClient } from './http';

export { ApiError, type HttpClient } from './http';
export { stockGraphqlClient, stockRequest } from './graphql';

/** 블로그(게시판/글/댓글) REST — 포트 8000 */
export const blogApi = createHttpClient(ENV.blogApiUrl);

/** 인증(게스트 로그인 등) REST — 포트 8001 */
export const authApi = createHttpClient(ENV.authApiUrl);
