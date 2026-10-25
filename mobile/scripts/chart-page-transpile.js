/* global __dirname */
/**
 * WebView 페이지 스크립트 TS 원본 → WebView 에서 그대로 실행할 ES2017 문자열.
 * gen-chart-page.js(생성)와 page-script.test.ts(생성 파일이 원본과 같은지)가 같이 쓴다.
 * - 타입만 지우는 변환(transpileModule) — 타입 검사는 gen-chart-page.js 가 page/tsconfig.json 으로 먼저 한다
 * - import type·declare global 이 남기는 `export {};` 를 지우고, 모듈 구문이 남으면 실패(WebView <script> 는 모듈이 아님)
 * - 전역을 더럽히지 않게 즉시 실행 함수로 감싼다
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SOURCE = path.join(__dirname, '..', 'src', 'features', 'game', 'chart-web', 'page', 'chart-page-script.ts');

function transpilePageScript(source = fs.readFileSync(SOURCE, 'utf8')) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.ESNext, removeComments: true },
    fileName: 'chart-page-script.ts',
  });
  const body = outputText.replace(/^export \{\};?\s*$/gm, '').trim();
  if (/^\s*(import|export)\b/m.test(body) || /\brequire\(/.test(body)) {
    throw new Error('페이지 스크립트 변환 결과에 모듈 구문(import/export/require)이 남았습니다 — WebView 에서 실행되지 않습니다');
  }
  return `(function () {\n${body}\n})();\n`;
}

module.exports = { SOURCE, transpilePageScript };
