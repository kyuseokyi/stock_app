// 펀드 리포트 WebView 페이지 — B안(정렬 그리드 카드). docs/superpowers/specs/fund-report-design/
// RN 이 window.__report({type:'render', view, colors}) 로 화면 모델(core/view.ts toReportView 결과)을 넣고,
// 페이지는 준비되면 {type:'ready'}, 링크를 누르면 {type:'open', href} 를 보낸다(외부 브라우저로 여는 건 RN).
// 포맷은 core 에서 끝났다 — 여기선 그리기만. 값은 textContent 로만 넣는다.
import type { ReportView } from '../core';

export type ReportColors = Record<
  | 'bg'
  | 'surface'
  | 'surface-2'
  | 'line'
  | 'text'
  | 'text-2'
  | 'text-3'
  | 'accent'
  | 'accent-soft'
  | 'up'
  | 'down'
  | 'warn'
  | 'warn-soft',
  string
>;
export type ReportMessage = { type: 'render'; view: ReportView; colors: ReportColors };
export type PageMessage = { type: 'ready' } | { type: 'open'; href: string };

export const toReportScript = (msg: ReportMessage): string =>
  `window.__report&&window.__report(${JSON.stringify(msg)});true;`;

const CSS = `
:root { --bg:#f7f5ff; --surface:#fff; --surface-2:#efebfb; --line:#ebe7f7; --text:#25223a; --text-2:#8e8aa6; --text-3:#8e8aa6;
  --accent:#6f8ef0; --accent-soft:#e2ecff; --up:#c93a6c; --down:#4f73d9; --warn:#c93a6c; --warn-soft:#fbd6e4; }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--text);
  font-family:-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", Roboto, sans-serif;
  font-size:15px; line-height:1.5; letter-spacing:-0.01em; word-break:keep-all; overflow-wrap:anywhere; }
.wrap { max-width:680px; margin:0 auto; padding:4px 16px 48px; }
.num { font-variant-numeric:tabular-nums; font-feature-settings:"tnum"; }
h2 { font-size:14px; font-weight:700; margin:26px 4px 8px; color:var(--text-2); }
h2 .date { font-weight:500; }
.card { background:var(--surface); border-radius:18px; padding:18px; margin-top:10px; }
.notice { background:var(--warn-soft); border-radius:14px; padding:10px 14px; margin-top:12px; font-size:14px; }
.notice b { color:var(--warn); margin-right:6px; }
.notice .sig { display:block; margin-top:2px; font-size:12px; color:var(--text-2); }
.unit { color:var(--text-2); font-weight:500; font-size:.85em; margin-left:1px; }
.up { color:var(--up); } .down { color:var(--down); } .zero { color:var(--text-2); }
.muted { color:var(--text-2); }
.hl { color:var(--up); }
details > summary { cursor:pointer; list-style:none; }
details > summary::-webkit-details-marker { display:none; }
.more { color:var(--text-2); font-size:13px; margin-top:8px; }
.more > summary::before { content:"▸ "; } .more[open] > summary::before { content:"▾ "; }
.more p { margin:8px 0 0; }
.card.more { margin-top:10px; }
.memo ol { margin:6px 0 0; padding-left:18px; }
a.link { color:var(--accent); font-weight:600; font-size:14px; text-decoration:none; display:inline-block; margin:10px 12px 0 0; }
.kv { display:grid; grid-template-columns:1fr auto; align-items:baseline; }
.kv > * { padding:9px 0; border-top:1px solid var(--line); }
.kv > :first-child, .kv > .k:first-child + .v { border-top:0; padding-top:0; } /* 첫 줄은 위 선 없음 */
.kv > .k { color:var(--text-2); font-size:14px; }
.kv > .v { text-align:right; font-weight:600; white-space:pre; padding-left:16px; }
.kv > .k.hero-k { color:var(--text); font-weight:700; font-size:15px; }
.kv > .v.hero-v { font-size:24px; font-weight:800; letter-spacing:-0.02em; }
.kv > .sub { border-top:0; padding-top:0; font-size:13px; }
.more .kv { margin-top:8px; }
.b-name { display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:10px; }
.b-name b { font-size:16px; }
.b-name span { color:var(--text-2); font-size:12px; white-space:nowrap; }
.step-title { grid-column:1 / -1; font-weight:700; font-size:14px; padding-top:14px !important; color:var(--accent); }
.kv > .step-title:first-child { padding-top:0 !important; border-top:0; }
`;

// 페이지 스크립트(ES2017, WebView 에서 그대로 실행) — Hermes 는 함수 소스를 보존하지 않아 문자열로 둔다.
// 백틱 금지(바깥 String.raw 가 끝난다). 화면 모델만 그린다(포맷 로직 없음).
const PAGE_SCRIPT = String.raw`
(function () {
  var app = document.getElementById('app');

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
  // 포맷된 값 칸: 본문 + 작은 단위, 원본은 title
  function val(c, cls, tag) {
    var el = h(tag || 'span', ['num', c.tone, cls].filter(Boolean).join(' '), [c.text, c.unit ? h('span', 'unit', [c.unit]) : null]);
    el.title = '원본: ' + c.raw;
    return el;
  }
  function kvRow(r, kCls, vCls) {
    return [h('div', 'k' + (kCls ? ' ' + kCls : ''), [r.label]), val(r.value, 'v' + (r.highlight ? ' hl' : '') + (vCls ? ' ' + vCls : ''), 'div')];
  }
  function kv(rows) {
    var g = h('div', 'kv', []);
    rows.forEach(function (r) { kvRow(r).forEach(function (el) { g.appendChild(el); }); });
    return g;
  }
  function link(l) {
    var href = l[1];
    if (!/^https?:\/\//i.test(href)) return null;
    var a = h('a', 'link', [l[0] + ' →']);
    a.href = '#';
    a.addEventListener('click', function (e) { e.preventDefault(); post({ type: 'open', href: href }); });
    return a;
  }
  function links(ls) { return (ls || []).map(link).filter(Boolean); }
  function fold(cls, summary, kids) { return h('details', cls, [h('summary', '', [summary])].concat(kids)); }

  function notice(n) {
    if (!n) return null;
    return h('div', 'notice', [h('b', '', [n.label]), n.message, n.signals ? h('span', 'sig', [n.signals]) : null].concat(links(n.links)));
  }

  function accountCard(a) {
    var g = h('div', 'kv', []);
    if (a.hero) {
      kvRow(a.hero, 'hero-k', 'hero-v').forEach(function (el) { g.appendChild(el); });
      if (a.summary.length) {
        var sub = h('div', 'v sub num', []);
        a.summary.forEach(function (r, i) {
          if (i) sub.appendChild(document.createTextNode(' · '));
          var el = val(r.value, '', 'span');
          el.title = r.label + ' · 원본: ' + r.value.raw;
          sub.appendChild(el);
        });
        g.appendChild(h('div', 'k sub', []));
        g.appendChild(sub);
      }
    }
    a.rows.forEach(function (r) { kvRow(r).forEach(function (el) { g.appendChild(el); }); });
    return h('div', 'card', [
      h('div', 'b-name', [h('b', '', [a.name]), a.since ? h('span', 'num', [a.since + ' 시작']) : null]),
      g,
      a.memo ? fold('more memo', a.memo.title || '메모', [h('ol', '', a.memo.lines.map(function (l) { return h('li', '', [l]); }))]) : null,
      a.details.length ? fold('more', '상세', [kv(a.details)]) : null
    ]);
  }

  function renderAccounts(s, out) {
    out.push(h('h2', '', [s.title, s.group ? ' · ' + s.group : '', s.evalDate ? h('span', 'date', [' · ' + s.evalDate]) : null]));
    s.accounts.forEach(function (a) { out.push(accountCard(a)); });
    s.notes.forEach(function (n) {
      out.push(fold('card more', n.title + ' (' + n.items.length + ')', n.items.map(function (t) { return h('p', 'muted', [t]); }).concat(links(n.links))));
    });
  }

  function renderSteps(s, out) {
    out.push(h('h2', '', [s.title]));
    var g = h('div', 'kv', []);
    s.steps.forEach(function (st) {
      g.appendChild(h('div', 'step-title', [st.no + ' · ' + st.name]));
      st.rows.forEach(function (r) { kvRow(r).forEach(function (el) { g.appendChild(el); }); });
    });
    out.push(h('div', 'card', [g].concat(links(s.links))));
  }

  function renderCert(s, out) {
    out.push(fold('card more', s.title, [s.company ? h('p', '', [s.company]) : null, kv(s.rows)]));
  }

  var RENDERERS = { accounts: renderAccounts, steps: renderSteps, cert: renderCert };

  function render(v) {
    app.textContent = '';
    var out = [notice(v.notice)];
    v.sections.forEach(function (s) { if (RENDERERS[s.kind]) RENDERERS[s.kind](s, out); });
    out.forEach(function (el) { if (el) app.appendChild(el); });
  }

  function applyColors(c) {
    var st = document.documentElement.style;
    Object.keys(c || {}).forEach(function (k) { st.setProperty('--' + k, c[k]); });
  }

  window.__report = function (msg) {
    if (msg && msg.type === 'render') { applyColors(msg.colors); render(msg.view); }
  };
  post({ type: 'ready' });
})();
`;

export const REPORT_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${CSS}</style></head><body><main class="wrap" id="app"></main>
<script>${PAGE_SCRIPT}</script></body></html>`;
