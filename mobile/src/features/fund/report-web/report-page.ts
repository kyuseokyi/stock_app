// 펀드 리포트 WebView 페이지 — fund_report/template.html 의 화면을 DOM 생성 방식으로 옮긴 것.
// RN 이 window.__report({type:'render', report, colors}) 로 데이터를 넣고, 페이지는 준비되면 {type:'ready'},
// 링크를 누르면 {type:'open', href} 를 보낸다(외부 브라우저로 여는 건 RN). 값은 textContent 로만 넣는다.
import type { FundReport } from '../core';

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
export type ReportMessage = { type: 'render'; report: FundReport; colors: ReportColors };
export type PageMessage = { type: 'ready' } | { type: 'open'; href: string };

export const toReportScript = (msg: ReportMessage): string =>
  `window.__report&&window.__report(${JSON.stringify(msg)});true;`;

const CSS = `
:root { --bg:#f7f5ff; --surface:#fff; --surface-2:#efebfb; --line:#ebe7f7; --text:#25223a; --text-2:#8e8aa6; --text-3:#8e8aa6;
  --accent:#6f8ef0; --accent-soft:#e2ecff; --up:#c93a6c; --down:#4f73d9; --warn:#c93a6c; --warn-soft:#fbd6e4; --radius:18px; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin:0; background:var(--bg); color:var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", Roboto, sans-serif;
  font-size:15px; line-height:1.55; letter-spacing:-0.01em; word-break:keep-all; overflow-wrap:anywhere; }
a { color:var(--accent); text-decoration:none; }
.num { font-variant-numeric: tabular-nums; }
.wrap { padding: 4px 16px 40px; }
.card { background:var(--surface); border-radius:var(--radius); padding:20px; }
section { margin-top:28px; }
.sec-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:0 4px 12px; }
.sec-head h2 { margin:0; font-size:18px; font-weight:700; display:flex; align-items:center; gap:8px; }
.sec-head h2::before { content:""; flex:none; width:4px; height:18px; border-radius:2px; background:var(--tone, var(--accent)); }
.sec-head .date { color:var(--text-3); font-size:13px; }
.notice { border:1px solid var(--warn-soft); }
.notice-label { display:inline-block; font-size:12px; font-weight:700; color:var(--warn); background:var(--warn-soft); padding:3px 10px; border-radius:999px; }
.signals { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 10px; }
.signal { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:10px; background:var(--surface-2); font-size:13px; color:var(--text-2); }
.signal b { color:var(--warn); }
.notice-msg { margin:0; font-size:16px; font-weight:600; }
.services { display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--line); font-size:13px; color:var(--text-2); }
.services .k { font-weight:700; color:var(--text); margin-right:4px; }
.tag { padding:4px 10px; border-radius:999px; background:var(--surface-2); }
.links { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.link-btn { display:inline-flex; align-items:center; gap:4px; padding:8px 14px; border-radius:10px; background:var(--accent-soft); color:var(--accent); font-size:14px; font-weight:600; }
.link-btn::after { content:"→"; }
.grid-2 { display:grid; gap:16px; }
@media (min-width:900px) { .grid-2.multi { grid-template-columns:1fr 1fr; } }
.acct-head { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
.acct-name { font-weight:700; font-size:16px; }
.pills { display:flex; flex-wrap:wrap; gap:6px; }
.pill { white-space:nowrap; font-size:12px; padding:3px 10px; border-radius:999px; background:var(--surface-2); color:var(--text-2); }
.pill b { color:var(--text); }
.hero { margin:14px 0 18px; }
.hero .label { color:var(--text-3); font-size:13px; }
.hero .value { font-size:clamp(26px, 8vw, 34px); font-weight:800; letter-spacing:-0.03em; line-height:1.2; }
.hero .value small { font-size:.5em; font-weight:600; color:var(--text-2); margin-left:2px; }
.hero .delta { margin-top:4px; font-size:14px; font-weight:600; }
.metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); background:var(--surface-2); border-radius:14px; overflow:hidden; }
.metric { padding:12px 14px; min-width:0; box-shadow:0 0 0 .5px var(--line); }
.metric .k { font-size:12px; color:var(--text-3); }
.metric .v { font-size:15px; font-weight:700; text-align:right; margin-top:2px; }
.up { color:var(--up); } .down { color:var(--down); }
.memo { margin-top:14px; padding:14px 16px; border-radius:14px; background:var(--surface-2); font-size:13px; color:var(--text-2); }
.memo strong { display:block; color:var(--text); margin-bottom:6px; }
.memo ol { margin:0; padding-left:18px; }
.notes { margin-top:16px; }
.notes h3 { margin:0 0 10px 4px; font-size:14px; color:var(--text-2); }
.notes ul { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.notes li { padding:12px 14px; background:var(--surface); border-radius:12px; font-size:14px; color:var(--text-2); }
.notes b { color:var(--text); }
.progress { margin:4px 0 18px; }
.progress .bar { height:10px; border-radius:999px; background:var(--surface-2); overflow:hidden; }
.progress .fill { height:100%; border-radius:inherit; background:var(--tone, var(--accent)); }
.progress .cap { display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px 8px; margin-top:6px; font-size:12px; color:var(--text-3); }
.steps { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); }
.step { background:var(--surface-2); border-radius:14px; padding:16px; }
.step .no { display:inline-block; font-size:12px; font-weight:700; color:var(--tone); background:var(--surface); padding:2px 10px; border-radius:999px; }
.step h4 { margin:8px 0 12px; font-size:15px; }
.step dl { margin:0; display:grid; gap:8px; }
.step dl div { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
.step dt { font-size:13px; color:var(--text-3); }
.step dd { margin:0; font-weight:700; text-align:right; }
.step dd.hl { color:var(--warn); font-size:18px; }
.cert { display:grid; gap:16px; }
.cert .company p { margin:6px 0 0; color:var(--text-2); font-size:14px; }
.cert .company p:first-of-type { color:var(--text); font-weight:700; font-size:16px; }
.cert dl { margin:0; display:grid; gap:10px; }
.cert dl div { display:flex; justify-content:space-between; gap:12px; padding-bottom:10px; border-bottom:1px dashed var(--line); }
.cert dl div:last-child { border-bottom:0; padding-bottom:0; }
.cert dt { color:var(--text-3); font-size:13px; }
.cert dd { margin:0; font-weight:700; text-align:right; white-space:pre-line; }
.cert dd.big { font-size:20px; color:var(--accent); }
`;

// 페이지 스크립트(ES2017, WebView 에서 그대로 실행) — Hermes 는 함수 소스를 보존하지 않아 문자열로 둔다.
// 백틱 금지(바깥 String.raw 가 끝난다).
const PAGE_SCRIPT = String.raw`
(function () {
  var TONES = ['#7c5cff', '#ff7a45', '#00a5a5', '#4e5968', '#e0a800'];
  var HERO_KEYS = ['현재평가금', '수익측정가치'];
  var DELTA_KEYS = ['총 손익금', '누적수익율', '연환산수익율'];
  var PILL_KEYS = ['초기화/시작일'];
  var PROGRESS = ['누적송금액', '남은목표금액'];
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
  function isMoney(v) { return /^-?[\d,]+$/.test(v); }
  function toNum(v) { return Number(String(v).replace(/[^\d.-]/g, '')); }
  function won(v) { return isMoney(v) ? v + '원' : v; }
  function toneOf(k, v) { return toNum(v) < 0 ? 'down' : k.indexOf('손익금') >= 0 ? 'up' : ''; }
  function linkBtn(l) {
    var href = l[1];
    if (!/^https?:\/\//i.test(href)) return null;
    var a = h('a', 'link-btn', [l[0]]);
    a.href = '#';
    a.addEventListener('click', function (e) { e.preventDefault(); post({ type: 'open', href: href }); });
    return a;
  }
  function links(ls) {
    var btns = (ls || []).map(linkBtn).filter(Boolean);
    return btns.length ? h('div', 'links', btns) : null;
  }
  function rich(segs) { return segs.map(function (s) { return s[1] ? h('b', '', [s[0]]) : s[0]; }); }
  function metric(k, v) { return h('div', 'metric', [h('div', 'k', [k]), h('div', 'v num ' + toneOf(k, v), [v])]); }

  function renderNotice(n) {
    if (!n) return null;
    return h('div', 'card notice', [
      h('span', 'notice-label', [n.label]),
      n.signals.length ? h('div', 'signals', [h('span', 'signal', [n.signalsLabel])].concat(n.signals.map(function (s) {
        return h('span', 'signal', [s[0] + ' ', h('b', '', [s[1]])]);
      }))) : null,
      n.message ? h('p', 'notice-msg', [n.message]) : null,
      n.services.length ? h('div', 'services', [h('span', 'k', [n.servicesLabel])].concat(n.services.map(function (t) {
        return h('span', 'tag', [t]);
      }))) : null,
      links(n.links)
    ]);
  }

  function accountCard(a) {
    var map = new Map(a.values);
    var heroKey = HERO_KEYS.filter(function (k) { return map.has(k); })[0];
    var delta = DELTA_KEYS.filter(function (k) { return map.has(k); }).slice(0, 2)
      .map(function (k) { return k + ' ' + won(map.get(k)); }).join(' · ');
    var pills = PILL_KEYS.filter(function (k) { return map.has(k); })
      .map(function (k) { return [k, map.get(k)]; }).concat(a.remarks);
    var metrics = a.values.filter(function (p) { return p[0] !== heroKey && PILL_KEYS.indexOf(p[0]) < 0; });

    var progress = null;
    if (PROGRESS.every(function (k) { return map.has(k); })) {
      var done = toNum(map.get(PROGRESS[0])), left = toNum(map.get(PROGRESS[1]));
      if (done + left > 0) {
        var pct = (done / (done + left)) * 100;
        var fill = h('div', 'fill');
        fill.style.width = pct.toFixed(1) + '%';
        progress = h('div', 'progress', [
          h('div', 'bar', [fill]),
          h('div', 'cap', [h('span', '', [PROGRESS[0] + ' ' + won(map.get(PROGRESS[0]))]), h('span', '', [PROGRESS[1] + ' ' + won(map.get(PROGRESS[1]))])]),
          h('div', 'cap', [h('span', '', ['※ 진행률 ' + pct.toFixed(1) + '%는 ' + PROGRESS[0] + ' ÷ (' + PROGRESS[0] + ' + ' + PROGRESS[1] + ')으로 화면에서 계산한 값입니다.'])])
        ]);
      }
    }

    var hero = null;
    if (heroKey) {
      var hv = map.get(heroKey);
      hero = h('div', 'hero', [
        h('div', 'label', [heroKey]),
        h('div', 'value num', [hv, isMoney(hv) ? h('small', '', ['원']) : null]),
        delta ? h('div', 'delta num up', [delta]) : null
      ]);
    }
    var memo = a.remarkText ? h('div', 'memo', [
      a.remarkText.title ? h('strong', '', [a.remarkText.title]) : null,
      h('ol', '', a.remarkText.lines.map(function (l) { return h('li', '', [l]); }))
    ]) : null;

    return h('article', 'card', [
      h('div', 'acct-head', [
        h('span', 'acct-name', [a.name]),
        h('span', 'pills', pills.map(function (p) { return h('span', 'pill', [p[0] + ' ', h('b', 'num', [p[1]])]); }))
      ]),
      hero, progress,
      h('div', 'metrics', metrics.map(function (p) { return metric(p[0], p[1]); })),
      memo
    ]);
  }

  function renderAccounts(s) {
    var out = [h('div', 'grid-2' + (s.accounts.length > 1 ? ' multi' : ''), s.accounts.map(accountCard))];
    s.notes.forEach(function (n) {
      out.push(h('div', 'notes', [
        h('h3', '', [n.title]),
        h('ul', '', n.items.map(function (it) { return h('li', '', rich(it)); })),
        links(n.links)
      ]));
    });
    return out;
  }

  function renderSteps(s) {
    return [h('div', 'card', [
      h('div', 'steps', s.steps.map(function (st) {
        return h('div', 'step', [
          h('span', 'no', [st.no]),
          h('h4', '', [st.name]),
          h('dl', '', st.items.map(function (it) {
            return h('div', '', [h('dt', '', [it[0]]), h('dd', 'num' + (it[2] ? ' hl' : ''), [it[1]])]);
          }))
        ]);
      })),
      links(s.links)
    ])];
  }

  function renderCert(s) {
    return [h('div', 'card cert', [
      h('div', 'company', [h('span', 'pill', [s.companyLabel])].concat(s.company.map(function (l) { return h('p', '', [l]); }))),
      h('dl', '', s.fields.map(function (f) {
        return h('div', '', [h('dt', '', [f[0]]), h('dd', 'num' + (/^₩/.test(f[1]) ? ' big' : ''), [f[1]])]);
      }))
    ])];
  }

  var RENDERERS = { accounts: renderAccounts, steps: renderSteps, cert: renderCert };

  function render(d) {
    app.textContent = '';
    var notice = renderNotice(d.notice);
    if (notice) app.appendChild(notice);
    d.sections.forEach(function (s, i) {
      var sec = h('section', '', []);
      sec.style.setProperty('--tone', TONES[i % TONES.length]);
      sec.appendChild(h('div', 'sec-head', [
        h('h2', '', [s.title, s.group ? h('span', 'pill', [s.group]) : null]),
        s.evalDate ? h('span', 'date', ['최종평가일 ' + s.evalDate]) : null
      ]));
      (RENDERERS[s.kind] ? RENDERERS[s.kind](s) : []).forEach(function (el) { if (el) sec.appendChild(el); });
      app.appendChild(sec);
    });
  }

  function applyColors(c) {
    var st = document.documentElement.style;
    Object.keys(c || {}).forEach(function (k) { st.setProperty('--' + k, c[k]); });
  }

  window.__report = function (msg) {
    if (msg && msg.type === 'render') { applyColors(msg.colors); render(msg.report); }
  };
  post({ type: 'ready' });
})();
`;

export const REPORT_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${CSS}</style></head><body><main class="wrap" id="app"></main>
<script>${PAGE_SCRIPT}</script></body></html>`;
