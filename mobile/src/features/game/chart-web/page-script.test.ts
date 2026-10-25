// 페이지 스크립트 생성 파일이 TS 원본(page/chart-page-script.ts)과 같은지 — 원본만 고치고 재생성을 잊으면 실패한다.
// 실패하면 mobile 폴더에서 npm run gen:chart-page
import { PAGE_SCRIPT } from './page-script.generated';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- 생성 스크립트와 같은 CommonJS 변환 함수를 그대로 쓴다
const { transpilePageScript } = require('../../../../scripts/chart-page-transpile') as {
  transpilePageScript: () => string;
};

describe('WebView 페이지 스크립트', () => {
  test('생성 파일 = 원본 변환 결과', () => {
    expect(PAGE_SCRIPT).toBe(transpilePageScript());
  });

  test('모듈 구문 없이 즉시 실행 함수 하나', () => {
    expect(PAGE_SCRIPT.startsWith('(function () {')).toBe(true);
    expect(PAGE_SCRIPT).not.toMatch(/^\s*(import|export)\b/m);
    expect(PAGE_SCRIPT).toContain("post({ type: 'ready' })");
  });
});
