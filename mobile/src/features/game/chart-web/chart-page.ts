// 게임·종목 차트 WebView 페이지 HTML — lightweight-charts 번들 + 페이지 스크립트를 인라인으로 넣는다.
// 페이지 스크립트 원본은 page/chart-page-script.ts(TypeScript, 메시지 = lib/chart-bridge 의 ChartMessage·PageEvent).
// Hermes 는 함수 소스를 보존하지 않아 문자열로 넣는다 — 원본을 고치면 npm run gen:chart-page 로 page-script.generated.ts 재생성.
import { LWC_BUNDLE } from './lwc-bundle.generated';
import { PAGE_SCRIPT } from './page-script.generated';

// </script 가 번들 안에 있으면 HTML 이 거기서 끊기므로 이스케이프
const inline = (js: string) => js.replace(/<\/script/gi, '<\\/script');

/** WebView source.html — 모듈 상수(렌더마다 새 문자열이면 WebView 가 다시 로드된다) */
export const CHART_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#c{position:absolute;inset:0;touch-action:pan-y}</style></head>
<body><div id="c"></div><script>${inline(LWC_BUNDLE)}</script><script>${inline(PAGE_SCRIPT)}</script></body></html>`;
