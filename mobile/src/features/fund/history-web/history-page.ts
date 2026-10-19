// 펀드 히스토리 WebView 페이지 — 차트(inline SVG) + 날짜별 목록. 리포트 페이지와 같은 방식:
// RN 이 window.__history({type:'render', view, colors}) 로 화면 모델(core toHistoryView)을 넣고, 페이지는 {type:'ready'} 만 보낸다.
// 포맷·기간 필터는 core 에서 끝났다 — 여기선 그리기만. 값은 textContent 로만 넣는다.
import type { HistoryView } from '../core';
import { REPORT_CSS, type ReportColors } from '../report-web/report-page';

export type HistoryMessage = { type: 'render'; view: HistoryView; colors: ReportColors };
export type HistoryPageMessage = { type: 'ready' };

export const toHistoryScript = (msg: HistoryMessage): string =>
  `window.__history&&window.__history(${JSON.stringify(msg)});true;`;

const CSS = `
.chart { display:block; width:100%; height:150px; margin:8px 0; }
.chart polyline { fill:none; stroke:var(--accent); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; vector-effect:non-scaling-stroke; }
.edge { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; color:var(--text-2); }
.edge .num { font-weight:600; color:var(--text); }
.axis { display:flex; justify-content:space-between; font-size:12px; color:var(--text-2); }
.hrow { padding:9px 0; border-top:1px solid var(--line); }
.hrow .line { display:flex; justify-content:space-between; align-items:baseline; gap:16px; }
.hrow .k { color:var(--text-2); font-size:14px; }
.hrow .v { font-weight:600; white-space:pre; }
.hrow .sub { margin-top:2px; text-align:right; font-size:13px; white-space:nowrap; }
.empty { text-align:center; color:var(--text-2); padding:48px 0; }
`;

// 페이지 스크립트(ES2017) — 백틱 금지(바깥 String.raw 가 끝난다).
const PAGE_SCRIPT = String.raw`
(function () {
  var app = document.getElementById('app');
  var NS = 'http://www.w3.org/2000/svg';

  function post(m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function h(tag, cls, kids) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    (kids || []).forEach(function (k) {
      if (k === null || k === undefined || k === false || k === '') return;
      el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return el;
  }
  function val(c, cls, tag) {
    return h(tag || 'span', ['num', c.tone, cls].filter(Boolean).join(' '), [c.text, c.unit ? h('span', 'unit', [c.unit]) : null]);
  }

  function chart(c) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('viewBox', '0 0 100 40');
    svg.setAttribute('preserveAspectRatio', 'none');
    var line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', c.points.map(function (p) { return (p[0] * 100) + ',' + ((1 - p[1]) * 36 + 2); }).join(' '));
    svg.appendChild(line);
    return h('div', 'card', [
      h('div', 'edge', [h('span', '', ['최고']), val(c.max)]),
      svg,
      h('div', 'edge', [h('span', '', ['최저']), val(c.min)]),
      h('div', 'axis', [h('span', 'num', [c.start]), h('span', 'num', [c.end])])
    ]);
  }

  function row(r) {
    return h('div', 'hrow', [
      h('div', 'line', [h('div', 'k num', [r.date]), val(r.value, 'v', 'div')]),
      h('div', 'sub', [h('span', 'muted', ['당일 ']), val(r.day), h('span', 'muted', [' · 월 ']), val(r.month)])
    ]);
  }

  function render(v) {
    app.textContent = '';
    if (!v.total) {
      app.appendChild(h('p', 'empty', ['리포트를 열 때마다 하루 한 건씩 기록돼요']));
      return;
    }
    app.appendChild(v.chart ? chart(v.chart) : h('div', 'card muted', ['기록이 쌓이면 그래프가 보여요']));
    app.appendChild(h('div', 'card', [h('div', 'kv', v.rows.map(row))]));
  }

  function applyColors(c) {
    var st = document.documentElement.style;
    Object.keys(c || {}).forEach(function (k) { st.setProperty('--' + k, c[k]); });
  }

  window.__history = function (msg) {
    if (msg && msg.type === 'render') { applyColors(msg.colors); render(msg.view); }
  };
  post({ type: 'ready' });
})();
`;

export const HISTORY_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${REPORT_CSS}${CSS}</style></head><body><main class="wrap" id="app"></main>
<script>${PAGE_SCRIPT}</script></body></html>`;
