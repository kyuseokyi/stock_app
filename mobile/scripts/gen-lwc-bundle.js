#!/usr/bin/env node
/**
 * lightweight-charts standalone 번들 → TS 문자열 모듈 생성(게임 차트 WebView 에 인라인으로 넣는다).
 * 웹(web_client)과 같은 버전을 쓰도록 web_client/node_modules 에서 읽고 버전을 고정 검사한다.
 * (모바일 package.json 에 의존성을 추가하지 않음 — 생성 파일만 커밋하면 앱 빌드에는 원본이 필요 없다)
 *
 * 실행: node scripts/gen-lwc-bundle.js   (mobile 폴더에서)
 */
const fs = require('fs');
const path = require('path');

const VERSION = '4.2.3'; // web_client 와 동일. v5 는 API(addSeries)가 달라 chart-page 를 고쳐야 한다
const pkgDir = path.join(__dirname, '..', '..', 'web_client', 'node_modules', 'lightweight-charts');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
if (pkg.version !== VERSION) {
  throw new Error(`lightweight-charts ${pkg.version} 발견 — ${VERSION} 이어야 합니다(web_client npm install 확인)`);
}
const src = fs.readFileSync(path.join(pkgDir, 'dist', 'lightweight-charts.standalone.production.js'), 'utf8');
const out = path.join(__dirname, '..', 'src', 'features', 'game', 'chart-web', 'lwc-bundle.generated.ts');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `/* eslint-disable */\n// 자동 생성 파일 — 직접 고치지 말 것. scripts/gen-lwc-bundle.js 로 다시 생성.\n` +
    `// lightweight-charts ${VERSION} standalone (Apache-2.0, © TradingView, Inc.)\n` +
    `export const LWC_VERSION = '${VERSION}';\n` +
    `export const LWC_BUNDLE: string = ${JSON.stringify(src)};\n`,
);
console.log(`생성: ${path.relative(process.cwd(), out)} (${(src.length / 1024).toFixed(0)} KB)`);
