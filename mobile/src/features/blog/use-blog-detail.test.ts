import { ApiError } from '@/lib/api';

import { blogDetailFailure } from './use-blog-detail';

describe('blogDetailFailure', () => {
  it('404 는 오류가 아니라 없는 글', () => {
    expect(blogDetailFailure(new ApiError(404, 'not found'))).toEqual({ error: null, notFound: true });
  });

  it('그 밖의 HTTP 오류는 상태 코드를 붙인 다시 시도 문구', () => {
    expect(blogDetailFailure(new ApiError(500, 'boom'))).toEqual({
      error: '잠시 후 다시 시도해 주세요 (오류 500)',
      notFound: false,
    });
  });

  it('네트워크 오류는 연결 문구', () => {
    expect(blogDetailFailure(new TypeError('Network request failed'))).toEqual({
      error: '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
      notFound: false,
    });
  });
});
