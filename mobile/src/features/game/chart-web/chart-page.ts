// 게임 차트 WebView 페이지 — 웹 TradingChart.tsx 의 lightweight-charts 설정을 그대로 옮긴 것.
// RN 이 lib/chart-bridge 의 메시지(init·load·tick·lines·vis)를 window.__chart 로 넣고,
// 페이지는 준비되면 {type:'ready'} 를 보낸다. 차트 엔진을 바꿀 때는 이 파일만 교체하면 된다.
import { LWC_BUNDLE } from './lwc-bundle.generated';

// 페이지 스크립트(ES2017, WebView 에서 그대로 실행) — Hermes 는 함수 소스를 보존하지 않아 문자열로 둔다
const PAGE_SCRIPT = String.raw`
(function () {
  var LW = window.LightweightCharts;
  var box = document.getElementById('c');
  var chart = null, series = null, ind = null, band = null, mode = null;
  var colors = { up: '#c93a6c', down: '#4f73d9', text: '#8e8aa6', grid: '#f7f5ff', border: '#ebe7f7' };
  var vis = { ma: true, bb: true };
  var lineSpecs = [], priceLines = [];
  var MA = { ma5: '#14b8a6', ma20: '#f97316', ma60: '#a16207' };
  var BB = 'rgba(99, 102, 241, 0.7)';
  var BB_FILL = 'rgba(99, 102, 241, 0.07)';

  function post(m) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
  }

  // 분봉 time 은 UTC epoch seconds — KST(+9h) 로 옮겨 라벨을 만든다(웹과 동일)
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function kst(time) {
    var d = new Date(((typeof time === 'number' ? time : 0) + 9 * 3600) * 1000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  function crosshairLabel(time) { var p = kst(time); return p.mo + '/' + p.d + ' ' + pad2(p.h) + ':' + pad2(p.mi); }
  function tickMark(time, type) {
    var p = kst(time);
    if (type === LW.TickMarkType.Year) return String(p.y);
    if (type === LW.TickMarkType.Month) return p.mo + '월';
    if (type === LW.TickMarkType.DayOfMonth) return p.mo + '/' + p.d;
    return pad2(p.h) + ':' + pad2(p.mi);
  }
  function priceFmt(p) { return Math.round(p).toLocaleString('ko-KR'); }

  // 볼린저 상·하단 사이 채우기(v4 에는 두 선 사이 채우기가 없어 시리즈 primitive 로) — 웹 lib/bandFill 과 동일
  function BandFill(color) {
    var self = this;
    this.points = []; this.visible = true; this.param = null;
    var renderer = { draw: function (target) { self.draw(target); } };
    this.view = { zOrder: function () { return 'bottom'; }, renderer: function () { return renderer; } };
    this.color = color;
  }
  BandFill.prototype.attached = function (p) { this.param = p; };
  BandFill.prototype.detached = function () { this.param = null; };
  BandFill.prototype.paneViews = function () { return [this.view]; };
  BandFill.prototype.setPoints = function (pts) { this.points = pts; if (this.param) this.param.requestUpdate(); };
  BandFill.prototype.setVisible = function (v) { this.visible = v; if (this.param) this.param.requestUpdate(); };
  BandFill.prototype.draw = function (target) {
    var p = this.param;
    if (!p || !this.visible || this.points.length < 2) return;
    var ts = p.chart.timeScale(), up = [], lo = [];
    for (var i = 0; i < this.points.length; i++) {
      var pt = this.points[i];
      var x = ts.timeToCoordinate(pt.time), yu = p.series.priceToCoordinate(pt.upper), yl = p.series.priceToCoordinate(pt.lower);
      if (x === null || yu === null || yl === null) continue;
      up.push([x, yu]); lo.push([x, yl]);
    }
    if (up.length < 2) return;
    var color = this.color;
    target.useMediaCoordinateSpace(function (s) {
      var c = s.context;
      c.beginPath(); c.moveTo(up[0][0], up[0][1]);
      for (var j = 1; j < up.length; j++) c.lineTo(up[j][0], up[j][1]);
      for (var k = lo.length - 1; k >= 0; k--) c.lineTo(lo[k][0], lo[k][1]);
      c.closePath(); c.fillStyle = color; c.fill();
    });
  };

  // 볼린저 띠 점 = 상단·하단 선의 같은 time 끼리 묶음
  function bandPoints(upper, lower) {
    var lowBy = {}, out = [];
    for (var i = 0; i < lower.length; i++) lowBy[lower[i].time] = lower[i].value;
    for (var j = 0; j < upper.length; j++) {
      var l = lowBy[upper[j].time];
      if (l !== undefined) out.push({ time: upper[j].time, upper: upper[j].value, lower: l });
    }
    return out;
  }

  // 단위(일봉/분봉) 가 바뀌면 time 형식이 달라 차트를 새로 만든다(웹과 같은 이유)
  function create(newMode) {
    if (chart) chart.remove();
    mode = newMode;
    var day = newMode === 'day';
    chart = LW.createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: { mode: LW.CrosshairMode.Normal },
      // 가로 드래그·핀치는 차트, 세로 스와이프는 앱 화면 스크롤
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      rightPriceScale: { borderColor: colors.border },
      timeScale: day
        ? { borderColor: colors.border }
        : { borderColor: colors.border, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickMark },
      localization: day ? { priceFormatter: priceFmt } : { priceFormatter: priceFmt, timeFormatter: crosshairLabel },
    });
    series = chart.addCandlestickSeries({
      upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down,
      wickUpColor: colors.up, wickDownColor: colors.down,
    });
    var base = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    ind = {
      ma5: chart.addLineSeries(Object.assign({}, base, { color: MA.ma5 })),
      ma20: chart.addLineSeries(Object.assign({}, base, { color: MA.ma20 })),
      ma60: chart.addLineSeries(Object.assign({}, base, { color: MA.ma60 })),
      bbUpper: chart.addLineSeries(Object.assign({}, base, { color: BB })),
      bbMiddle: chart.addLineSeries(Object.assign({}, base, { color: BB, lineStyle: LW.LineStyle.Dashed })),
      bbLower: chart.addLineSeries(Object.assign({}, base, { color: BB })),
    };
    band = new BandFill(BB_FILL);
    ind.bbUpper.attachPrimitive(band);
    priceLines = [];
    applyVis();
    applyLines();
  }

  function applyVis() {
    if (!ind) return;
    ['ma5', 'ma20', 'ma60'].forEach(function (k) { ind[k].applyOptions({ visible: vis.ma }); });
    ['bbUpper', 'bbMiddle', 'bbLower'].forEach(function (k) { ind[k].applyOptions({ visible: vis.bb }); });
    band.setVisible(vis.bb);
  }

  function applyLines() {
    if (!series) return;
    priceLines.forEach(function (l) { series.removePriceLine(l); });
    priceLines = lineSpecs.map(function (s) {
      return series.createPriceLine({
        price: s.price, color: s.color, lineWidth: s.width,
        lineStyle: s.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title: s.title,
      });
    });
  }

  var handlers = {
    // 테마(라이트/다크) 색 — 이미 그린 차트는 데이터를 지우지 않게 옵션만 바꾼다
    init: function (m) {
      colors = m.colors;
      if (!chart) return;
      chart.applyOptions({
        layout: { textColor: colors.text },
        grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
        rightPriceScale: { borderColor: colors.border },
        timeScale: { borderColor: colors.border },
      });
      series.applyOptions({
        upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down,
        wickUpColor: colors.up, wickDownColor: colors.down,
      });
    },
    load: function (m) {
      var fresh = !chart || mode !== m.mode;
      if (fresh) create(m.mode);
      series.setData(m.bars);
      for (var k in ind) ind[k].setData(m.ind[k] || []);
      band.setPoints(bandPoints(m.ind.bbUpper || [], m.ind.bbLower || []));
      // 같은 단위 재조회(keepView)면 사용자가 보던 위치 유지. 새 차트면 첫 화면 구간 지정
      if (fresh || !m.keepView) {
        if (m.range === 'fit') chart.timeScale().fitContent();
        else if (m.range) chart.timeScale().setVisibleLogicalRange(m.range);
      }
    },
    tick: function (m) {
      if (!series) return;
      try {
        series.update(m.bar);
        for (var k in m.ind) if (ind[k]) ind[k].update({ time: m.bar.time, value: m.ind[k] });
        if (m.ind.bbUpper !== undefined && m.ind.bbLower !== undefined) {
          var pts = band.points.filter(function (p) { return p.time !== m.bar.time; });
          pts.push({ time: m.bar.time, upper: m.ind.bbUpper, lower: m.ind.bbLower });
          band.setPoints(pts);
        }
      } catch (e) {
        // "Cannot update oldest data" 등 — 틱 반영 실패는 무시(웹과 동일)
      }
    },
    lines: function (m) { lineSpecs = m.lines; applyLines(); },
    vis: function (m) { vis = { ma: m.ma, bb: m.bb }; applyVis(); },
  };

  window.__chart = function (m) {
    try { handlers[m.type](m); } catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
  };
  post({ type: 'ready' });
})();
`;

// </script 가 번들 안에 있으면 HTML 이 거기서 끊기므로 이스케이프
const inline = (js: string) => js.replace(/<\/script/gi, '<\\/script');

/** WebView source.html — 모듈 상수(렌더마다 새 문자열이면 WebView 가 다시 로드된다) */
export const CHART_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#c{position:absolute;inset:0;touch-action:pan-y}</style></head>
<body><div id="c"></div><script>${inline(LWC_BUNDLE)}</script><script>${inline(PAGE_SCRIPT)}</script></body></html>`;
