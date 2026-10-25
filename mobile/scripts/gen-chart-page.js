#!/usr/bin/env node
/* global __dirname */
/**
 * WebView 페이지 스크립트 생성 — 원본 src/features/game/chart-web/page/chart-page-script.ts 를
 * 1) page/tsconfig.json 으로 타입 검사(DOM + lightweight-charts 4.2.3 타입, web_client 설치본) 2) ES2017 로 변환해
 * page-script.generated.ts(문자열 상수)로 쓴다. 생성 파일을 커밋한다(앱 빌드에는 원본·typescript 실행이 필요 없다).
 *
 * 실행: npm run gen:chart-page   (mobile 폴더에서, web_client npm install 필요)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { transpilePageScript } = require('./chart-page-transpile');

const root = path.join(__dirname, '..');
const tsconfig = path.join(root, 'src', 'features', 'game', 'chart-web', 'page', 'tsconfig.json');
try {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', tsconfig], { stdio: 'inherit' });
} catch {
  console.error('페이지 스크립트 타입 검사 실패 — 생성하지 않았습니다');
  process.exit(1);
}
const js = transpilePageScript();
const out = path.join(root, 'src', 'features', 'game', 'chart-web', 'page-script.generated.ts');
fs.writeFileSync(
  out,
  `/* eslint-disable */\n// 자동 생성 파일 — 직접 고치지 말 것. 원본 page/chart-page-script.ts, 생성: npm run gen:chart-page\n` +
    `export const PAGE_SCRIPT: string = ${JSON.stringify(js)};\n`,
);
console.log(`생성: ${path.relative(process.cwd(), out)} (${(js.length / 1024).toFixed(1)} KB)`);
