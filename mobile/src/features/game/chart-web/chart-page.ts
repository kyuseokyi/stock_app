// 게임 차트 WebView 페이지 — 웹 TradingChart.tsx 의 lightweight-charts 설정을 그대로 옮긴 것.
// RN 이 lib/chart-bridge 의 메시지(init·load·tick·lines·vis·older)를 window.__chart 로 넣고,
// 페이지는 준비되면 {type:'ready'}, 일봉 왼쪽 끝에 닿으면 {type:'needOlder'} 를 보낸다. 차트 엔진을 바꿀 때는 이 파일만 교체하면 된다.
import { LWC_BUNDLE } from './lwc-bundle.generated';

// 페이지 스크립트(ES2017, WebView 에서 그대로 실행) — Hermes 는 함수 소스를 보존하지 않아 문자열로 둔다
const PAGE_SCRIPT = String.raw`
(function () {
  var LW = window.LightweightCharts;
  var box = document.getElementById('c');
  var chart = null, series = null, ind = null, band = null, vpPrim = null, mode = null;
  var colors = { up: '#c93a6c', down: '#4f73d9', text: '#8e8aa6', grid: '#f7f5ff', border: '#ebe7f7' };
  var vis = { ma: true, bb: true, vp: false };
  var lineSpecs = [], priceLines = [];
  var MA = { ma5: '#14b8a6', ma20: '#f97316', ma60: '#a16207' };
  // 일봉 과거 이어 받기 — on: RN 이 켬(load.history), armed: 사용자가 차트를 만진 뒤, busy: 요청 중, done: 더 없음
  var hist = { on: false, armed: false, busy: false, done: false };
  var EDGE_BARS = 10; // 첫 캔들까지 이만큼 남으면 미리 요청(웹 lib/historyScroll 과 같은 값)
  function arm() { hist.armed = true; }
  box.addEventListener('pointerdown', arm);
  box.addEventListener('wheel', arm, { passive: true });
  function onRange(r) {
    if (!r || !hist.on || !hist.armed || hist.busy || hist.done || r.from > EDGE_BARS) return;
    hist.busy = true;
    post({ type: 'needOlder' });
  }
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

  // 매물대 — 보이는 캔들만으로 가격대별 누적 거래량(웹 lib/volumeProfile 과 같은 계산: 저가~고가 20칸, 거래량은 종가 칸에 합산).
  // 그릴 때마다 보이는 구간을 다시 읽으므로 끌기·확대에 따라 바로 바뀐다. 왼쪽 끝에서 오른쪽으로(폭 최대 28%), 캔들 뒤
  function volumeProfile(pts) {
    var use = pts.filter(function (p) { return p.volume > 0; });
    if (use.length === 0) return [];
    var min = Infinity, max = -Infinity, total = 0;
    use.forEach(function (p) { if (p.low < min) min = p.low; if (p.high > max) max = p.high; total += p.volume; });
    if (max <= min) return [{ low: min, high: max, volume: total }];
    var n = 20, w = (max - min) / n, buckets = [];
    for (var i = 0; i < n; i++) buckets.push(0);
    use.forEach(function (p) { buckets[Math.max(0, Math.min(n - 1, Math.floor((p.close - min) / w)))] += p.volume; });
    return buckets.map(function (v, j) { return { low: min + j * w, high: min + (j + 1) * w, volume: v }; });
  }
  function VolumeProfile() {
    var self = this;
    this.points = []; this.visible = false; this.param = null;
    var renderer = { draw: function (target) { self.draw(target); } };
    this.view = { zOrder: function () { return 'bottom'; }, renderer: function () { return renderer; } };
  }
  VolumeProfile.prototype.attached = function (p) { this.param = p; };
  VolumeProfile.prototype.detached = function () { this.param = null; };
  VolumeProfile.prototype.paneViews = function () { return [this.view]; };
  VolumeProfile.prototype.update = function () { if (this.param) this.param.requestUpdate(); };
  VolumeProfile.prototype.draw = function (target) {
    var p = this.param;
    if (!p || !this.visible || this.points.length === 0) return;
    var r = p.chart.timeScale().getVisibleLogicalRange();
    if (!r) return;
    var from = Math.max(0, Math.ceil(r.from)), to = Math.min(this.points.length - 1, Math.floor(r.to));
    if (to < from) return;
    var bins = volumeProfile(this.points.slice(from, to + 1));
    if (bins.length === 0) return;
    var maxVol = Math.max.apply(null, [1].concat(bins.map(function (b) { return b.volume; })));
    target.useMediaCoordinateSpace(function (s) {
      var c = s.context;
      c.fillStyle = 'rgba(100, 116, 139, 0.22)';
      bins.forEach(function (b) {
        var yh = p.series.priceToCoordinate(b.high), yl = p.series.priceToCoordinate(b.low);
        if (yh === null || yl === null || b.volume === 0) return;
        c.fillRect(0, Math.min(yh, yl), (b.volume / maxVol) * s.mediaSize.width * 0.28, Math.max(1, Math.abs(yl - yh) - 1));
      });
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
      autoscaleInfoProvider: widenRange,
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
    vpPrim = new VolumeProfile();
    series.attachPrimitive(vpPrim);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    priceLines = [];
    applyVis();
    applyLines();
  }

  function applyVis() {
    if (!ind) return;
    ['ma5', 'ma20', 'ma60'].forEach(function (k) { ind[k].applyOptions({ visible: vis.ma }); });
    ['bbUpper', 'bbMiddle', 'bbLower'].forEach(function (k) { ind[k].applyOptions({ visible: vis.bb }); });
    band.setVisible(vis.bb);
    vpPrim.visible = vis.vp; vpPrim.update();
  }

  // 가격선은 자동 범위에 들어가지 않아 범위 밖 지지·저항이 사라진다 — fit 규칙(chart-bridge fitPrices 와 동일)으로 넓힘
  function widenRange(original) {
    var r = original();
    if (!r || !r.priceRange) return r;
    var prices = lineSpecs
      .filter(function (s) { return s.fit === 'always' || (s.fit === 'day' && mode === 'day'); })
      .map(function (s) { return s.price; })
      .filter(function (p) { return typeof p === 'number' && isFinite(p); });
    if (prices.length === 0) return r;
    return {
      priceRange: {
        minValue: Math.min.apply(null, [r.priceRange.minValue].concat(prices)),
        maxValue: Math.max.apply(null, [r.priceRange.maxValue].concat(prices)),
      },
      margins: r.margins,
    };
  }

  function applyLines() {
    if (!series) return;
    priceLines.forEach(function (l) { series.removePriceLine(l); });
    priceLines = lineSpecs.map(function (s) {
      return series.createPriceLine({
        price: s.price, color: s.color, lineWidth: s.width,
        lineStyle: s.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title: '', // 이름은 RN 범례에 — 차트 안 이름은 가까운 선끼리 겹친다(축 라벨은 라이브러리가 떼어 놓음)
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
      hist.on = !!m.history;
      if (fresh || !m.keepView) {
        // 새 차트·새 종목 — 과거 이어 받기 상태 초기화(왼쪽 끝 고정도 풀기)
        hist.armed = false; hist.busy = false; hist.done = false;
        chart.applyOptions({ timeScale: { fixLeftEdge: false } });
      }
      var ts = chart.timeScale();
      var before = m.prepended ? ts.getVisibleLogicalRange() : null;
      series.setData(m.bars);
      vpPrim.points = m.bars; vpPrim.update();
      for (var k in ind) ind[k].setData(m.ind[k] || []);
      band.setPoints(bandPoints(m.ind.bbUpper || [], m.ind.bbLower || []));
      if (m.prepended) {
        // 앞에 과거를 붙임 — 보던 캔들이 그대로 보이게(라이브러리가 이미 옮겼으면 그대로, 아니면 붙인 개수만큼)
        var after = ts.getVisibleLogicalRange();
        if (before && after && Math.abs(after.from - before.from - m.prepended) > 0.5) {
          ts.setVisibleLogicalRange({ from: before.from + m.prepended, to: before.to + m.prepended });
        }
        hist.busy = false;
        return;
      }
      // 같은 단위 재조회(keepView)면 사용자가 보던 위치 유지. 새 차트면 첫 화면 구간 지정
      if (fresh || !m.keepView) {
        if (m.range === 'fit') ts.fitContent();
        else if (m.range) ts.setVisibleLogicalRange(m.range);
      }
    },
    older: function (m) {
      hist.busy = false;
      if (!m.more && chart) {
        hist.done = true;
        chart.applyOptions({ timeScale: { fixLeftEdge: true } }); // 더 없음 — 첫 캔들 왼쪽 빈 공간으로 밀리지 않게
      }
    },
    tick: function (m) {
      if (!series) return;
      try {
        series.update(m.bar);
        var last = vpPrim.points[vpPrim.points.length - 1];
        vpPrim.points = last && last.time === m.bar.time ? vpPrim.points.slice(0, -1).concat([m.bar]) : vpPrim.points.concat([m.bar]);
        vpPrim.update();
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
    vis: function (m) { vis = { ma: m.ma, bb: m.bb, vp: !!m.vp }; applyVis(); },
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
