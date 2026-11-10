// 펀드 히스토리 WebView 페이지 — 당일 손익 막대 차트(inline SVG) + 날짜별 목록. 리포트 페이지와 같은 방식:
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
.chart rect.up { fill:var(--up); } .chart rect.down { fill:var(--down); }
.chart line { stroke:var(--line); stroke-width:1; vector-effect:non-scaling-stroke; }
.ctitle { font-size:13px; font-weight:600; color:var(--text-2); margin-bottom:4px; }
.edge { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; color:var(--text-2); }
.edge .num { font-weight:600; color:var(--text); }
.axis { display:flex; justify-content:space-between; font-size:12px; color:var(--text-2); }
.hrow { padding:9px 0; border-top:1px solid var(--line); }
.hrow .line { display:flex; justify-content:space-between; align-items:baseline; gap:16px; }
.hrow .k { color:var(--text-2); font-size:14px; }
.hrow .gap { margin-left:6px; font-size:11px; color:var(--text-2); }
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

  // 당일 손익 막대 — 0원 기준선(zero) 위는 수익(up), 아래는 손실(down). 좌표 0..1(1=위) → viewBox 세로 2..38
  function y(v) { return (1 - v) * 36 + 2; }
  function chart(c) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('viewBox', '0 0 100 40');
    svg.setAttribute('preserveAspectRatio', 'none');
    var w = (c.width / c.bars.length) * 100;
    c.bars.forEach(function (b) {
      if (b.tone === 'zero') return; // 0원은 기준선만
      var top = Math.min(y(b.from), y(b.to));
      var rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('class', b.tone);
      rect.setAttribute('x', String(b.x * 100 - w / 2));
      rect.setAttribute('y', String(top));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(Math.max(Math.abs(y(b.from) - y(b.to)), 0.4))); // 아주 작은 손익도 보이게
      svg.appendChild(rect);
    });
    var base = document.createElementNS(NS, 'line');
    base.setAttribute('x1', '0'); base.setAttribute('x2', '100');
    base.setAttribute('y1', String(y(c.zero))); base.setAttribute('y2', String(y(c.zero)));
    svg.appendChild(base);
    return h('div', 'card', [
      h('div', 'ctitle', ['당일 손익']),
      h('div', 'edge', [h('span', '', ['최고']), val(c.max)]),
      svg,
      h('div', 'edge', [h('span', '', ['최저']), val(c.min)]),
      h('div', 'axis', [h('span', 'num', [c.start]), h('span', 'num', [c.end])])
    ]);
  }

  function noChart(v) {
    return h('div', 'card muted', [v.chartNeed > 0
      ? '기록이 ' + v.chartNeed + '일 더 쌓이면 당일 손익 그래프를 보여드려요'
      : '이 기간은 기록이 적어 그래프를 그리지 않았어요. 기간을 넓혀 보세요']);
  }

  function row(r) {
    var date = [h('span', 'num', [r.date])];
    if (r.gapFrom) date.push(h('span', 'gap', [r.gapFrom + ' 이후 기록 없음']));
    return h('div', 'hrow', [
      h('div', 'line', [h('div', 'k', date), val(r.value, 'v', 'div')]),
      h('div', 'sub', [h('span', 'muted', ['당일 ']), val(r.day), h('span', 'muted', [' · 월 ']), val(r.month)])
    ]);
  }

  function render(v) {
    app.textContent = '';
    if (!v.total) {
      app.appendChild(h('p', 'empty', ['리포트를 열 때마다 하루 한 건씩 기록돼요']));
      return;
    }
    app.appendChild(v.chart ? chart(v.chart) : noChart(v));
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
