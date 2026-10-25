// 게임·종목 차트 WebView 페이지 스크립트(TypeScript 원본) — 웹 TradingChart.tsx 의 lightweight-charts 설정을 옮긴 것.
// 이 파일은 앱(Hermes)이 아니라 WebView 안에서 실행된다. Hermes 는 함수 소스를 보존하지 않아 문자열로 넣어야 하므로
// scripts/gen-chart-page.js 가 타입 검사(page/tsconfig.json) 후 ES2017 로 변환해 page-script.generated.ts 를 만든다(직접 실행 금지).
// lightweight-charts 는 import 하지 않고 standalone 번들의 전역 window.LightweightCharts 로 쓴다(타입만 가져옴).
// RN → 페이지: lib/chart-bridge 의 ChartMessage 를 window.__chart 로. 페이지 → RN: PageEvent(ready·needOlder·error).
import type * as LWC from 'lightweight-charts';
import type {
  Bar,
  ChartColors,
  ChartLine,
  ChartMessage,
  ChartMode,
  IndicatorKey,
  LinePoint,
  PageEvent,
} from '../../lib/chart-bridge';

declare global {
  interface Window {
    LightweightCharts: typeof LWC;
    ReactNativeWebView?: { postMessage(data: string): void };
    __chart?: (m: ChartMessage) => void;
  }
}

type Time = LWC.Time;
type DrawTarget = Parameters<LWC.ISeriesPrimitivePaneRenderer['draw']>[0];
type Range = LWC.LogicalRange;
type BandPoint = { time: Time; upper: number; lower: number };
type IndSeries = Record<IndicatorKey, LWC.ISeriesApi<'Line'>>;
type MessageOf<K extends ChartMessage['type']> = Extract<ChartMessage, { type: K }>;

const LW = window.LightweightCharts;
const box = document.getElementById('c') as HTMLElement;
let chart: LWC.IChartApi | null = null;
let series: LWC.ISeriesApi<'Candlestick'> | null = null;
let ind: IndSeries | null = null;
let band: BandFill | null = null;
let vpPrim: VolumeProfile | null = null;
let mode: ChartMode | null = null;
let colors: ChartColors = { up: '#c93a6c', down: '#4f73d9', text: '#8e8aa6', grid: '#f7f5ff', border: '#ebe7f7' };
let vis = { ma: true, bb: true, vp: false };
let lineSpecs: ChartLine[] = [];
let priceLines: LWC.IPriceLine[] = [];
const MA: Record<'ma5' | 'ma20' | 'ma60', string> = { ma5: '#14b8a6', ma20: '#f97316', ma60: '#a16207' };
// 일봉 과거 이어 받기 — on: RN 이 켬(load.history), armed: 사용자가 차트를 만진 뒤, busy: 요청 중, done: 더 없음
const hist = { on: false, armed: false, busy: false, done: false };
const EDGE_BARS = 10; // 첫 캔들까지 이만큼 남으면 미리 요청(웹 lib/historyScroll 과 같은 값)
function arm() {
  hist.armed = true;
}
box.addEventListener('pointerdown', arm);
box.addEventListener('wheel', arm, { passive: true });
function onRange(r: Range | null) {
  if (!r || !hist.on || !hist.armed || hist.busy || hist.done || r.from > EDGE_BARS) return;
  hist.busy = true;
  post({ type: 'needOlder' });
}
const BB = 'rgba(99, 102, 241, 0.7)';
const BB_FILL = 'rgba(99, 102, 241, 0.07)';

function post(m: PageEvent) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
}

// 분봉 time 은 UTC epoch seconds — KST(+9h) 로 옮겨 라벨을 만든다(웹과 동일)
function pad2(n: number) {
  return (n < 10 ? '0' : '') + n;
}
function kst(time: Time) {
  const d = new Date(((typeof time === 'number' ? time : 0) + 9 * 3600) * 1000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
function crosshairLabel(time: Time) {
  const p = kst(time);
  return p.mo + '/' + p.d + ' ' + pad2(p.h) + ':' + pad2(p.mi);
}
function tickMark(time: Time, type: LWC.TickMarkType) {
  const p = kst(time);
  if (type === LW.TickMarkType.Year) return String(p.y);
  if (type === LW.TickMarkType.Month) return p.mo + '월';
  if (type === LW.TickMarkType.DayOfMonth) return p.mo + '/' + p.d;
  return pad2(p.h) + ':' + pad2(p.mi);
}
function priceFmt(p: number) {
  return Math.round(p).toLocaleString('ko-KR');
}

// 볼린저 상·하단 사이 채우기(v4 에는 두 선 사이 채우기가 없어 시리즈 primitive 로) — 웹 lib/bandFill 과 동일
class BandFill implements LWC.ISeriesPrimitive<Time> {
  points: BandPoint[] = [];
  private visible = true;
  private param: LWC.SeriesAttachedParameter<Time> | null = null;
  private readonly view: LWC.ISeriesPrimitivePaneView;

  constructor(private readonly color: string) {
    const renderer: LWC.ISeriesPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.view = { zOrder: () => 'bottom', renderer: () => renderer };
  }
  attached(p: LWC.SeriesAttachedParameter<Time>) {
    this.param = p;
  }
  detached() {
    this.param = null;
  }
  paneViews() {
    return [this.view];
  }
  setPoints(pts: BandPoint[]) {
    this.points = pts;
    this.param?.requestUpdate();
  }
  setVisible(v: boolean) {
    this.visible = v;
    this.param?.requestUpdate();
  }
  private draw(target: DrawTarget) {
    const p = this.param;
    if (!p || !this.visible || this.points.length < 2) return;
    const ts = p.chart.timeScale();
    const up: [number, number][] = [];
    const lo: [number, number][] = [];
    for (const pt of this.points) {
      const x = ts.timeToCoordinate(pt.time);
      const yu = p.series.priceToCoordinate(pt.upper);
      const yl = p.series.priceToCoordinate(pt.lower);
      if (x === null || yu === null || yl === null) continue;
      up.push([x, yu]);
      lo.push([x, yl]);
    }
    if (up.length < 2) return;
    const color = this.color;
    target.useMediaCoordinateSpace(({ context: c }) => {
      c.beginPath();
      c.moveTo(up[0][0], up[0][1]);
      for (let j = 1; j < up.length; j++) c.lineTo(up[j][0], up[j][1]);
      for (let k = lo.length - 1; k >= 0; k--) c.lineTo(lo[k][0], lo[k][1]);
      c.closePath();
      c.fillStyle = color;
      c.fill();
    });
  }
}

// 매물대 — 보이는 캔들만으로 가격대별 누적 거래량(웹 lib/volumeProfile 과 같은 계산: 저가~고가 20칸, 거래량은 종가 칸에 합산).
// 그릴 때마다 보이는 구간을 다시 읽으므로 끌기·확대에 따라 바로 바뀐다. 왼쪽 끝에서 오른쪽으로(폭 최대 28%), 캔들 뒤
type VolumeBin = { low: number; high: number; volume: number };
function volumeProfile(pts: Bar[]): VolumeBin[] {
  const use = pts.filter((p) => p.volume > 0);
  if (use.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  use.forEach((p) => {
    if (p.low < min) min = p.low;
    if (p.high > max) max = p.high;
    total += p.volume;
  });
  if (max <= min) return [{ low: min, high: max, volume: total }];
  const n = 20;
  const w = (max - min) / n;
  const buckets: number[] = [];
  for (let i = 0; i < n; i++) buckets.push(0);
  use.forEach((p) => {
    buckets[Math.max(0, Math.min(n - 1, Math.floor((p.close - min) / w)))] += p.volume;
  });
  return buckets.map((v, j) => ({ low: min + j * w, high: min + (j + 1) * w, volume: v }));
}
class VolumeProfile implements LWC.ISeriesPrimitive<Time> {
  points: Bar[] = [];
  visible = false;
  private param: LWC.SeriesAttachedParameter<Time> | null = null;
  private readonly view: LWC.ISeriesPrimitivePaneView;

  constructor() {
    const renderer: LWC.ISeriesPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.view = { zOrder: () => 'bottom', renderer: () => renderer };
  }
  attached(p: LWC.SeriesAttachedParameter<Time>) {
    this.param = p;
  }
  detached() {
    this.param = null;
  }
  paneViews() {
    return [this.view];
  }
  update() {
    this.param?.requestUpdate();
  }
  private draw(target: DrawTarget) {
    const p = this.param;
    if (!p || !this.visible || this.points.length === 0) return;
    const r = p.chart.timeScale().getVisibleLogicalRange();
    if (!r) return;
    const from = Math.max(0, Math.ceil(r.from));
    const to = Math.min(this.points.length - 1, Math.floor(r.to));
    if (to < from) return;
    const bins = volumeProfile(this.points.slice(from, to + 1));
    if (bins.length === 0) return;
    const maxVol = Math.max(1, ...bins.map((b) => b.volume));
    target.useMediaCoordinateSpace(({ context: c, mediaSize }) => {
      c.fillStyle = 'rgba(100, 116, 139, 0.22)';
      bins.forEach((b) => {
        const yh = p.series.priceToCoordinate(b.high);
        const yl = p.series.priceToCoordinate(b.low);
        if (yh === null || yl === null || b.volume === 0) return;
        c.fillRect(0, Math.min(yh, yl), (b.volume / maxVol) * mediaSize.width * 0.28, Math.max(1, Math.abs(yl - yh) - 1));
      });
    });
  }
}

// 볼린저 띠 점 = 상단·하단 선의 같은 time 끼리 묶음
function bandPoints(upper: LinePoint[], lower: LinePoint[]): BandPoint[] {
  const lowBy = new Map<string | number, number>();
  for (const l of lower) lowBy.set(l.time, l.value);
  const out: BandPoint[] = [];
  for (const u of upper) {
    const l = lowBy.get(u.time);
    if (l !== undefined) out.push({ time: u.time as Time, upper: u.value, lower: l });
  }
  return out;
}

// RN 이 보내는 막대·선(time = 'YYYY-MM-DD' 또는 epoch 초)을 라이브러리 형식으로 — 값은 그대로, 타입만 맞춘다
const asCandles = (bars: Bar[]) => bars as unknown as LWC.CandlestickData<Time>[];
const asLine = (pts: LinePoint[]) => pts as unknown as LWC.LineData<Time>[];

// 단위(일봉/분봉) 가 바뀌면 time 형식이 달라 차트를 새로 만든다(웹과 같은 이유)
function create(newMode: ChartMode) {
  if (chart) chart.remove();
  mode = newMode;
  const day = newMode === 'day';
  const c = LW.createChart(box, {
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
  chart = c;
  const s = c.addCandlestickSeries({
    upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down,
    wickUpColor: colors.up, wickDownColor: colors.down,
    autoscaleInfoProvider: widenRange,
  });
  series = s;
  const base = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  const lines: IndSeries = {
    ma5: c.addLineSeries({ ...base, color: MA.ma5 }),
    ma20: c.addLineSeries({ ...base, color: MA.ma20 }),
    ma60: c.addLineSeries({ ...base, color: MA.ma60 }),
    bbUpper: c.addLineSeries({ ...base, color: BB }),
    bbMiddle: c.addLineSeries({ ...base, color: BB, lineStyle: LW.LineStyle.Dashed }),
    bbLower: c.addLineSeries({ ...base, color: BB }),
  };
  ind = lines;
  band = new BandFill(BB_FILL);
  lines.bbUpper.attachPrimitive(band);
  vpPrim = new VolumeProfile();
  s.attachPrimitive(vpPrim);
  c.timeScale().subscribeVisibleLogicalRangeChange(onRange);
  priceLines = [];
  applyVis();
  applyLines();
}

function applyVis() {
  if (!ind || !band || !vpPrim) return;
  const lines = ind;
  (['ma5', 'ma20', 'ma60'] as const).forEach((k) => lines[k].applyOptions({ visible: vis.ma }));
  (['bbUpper', 'bbMiddle', 'bbLower'] as const).forEach((k) => lines[k].applyOptions({ visible: vis.bb }));
  band.setVisible(vis.bb);
  vpPrim.visible = vis.vp;
  vpPrim.update();
}

// 가격선은 자동 범위에 들어가지 않아 범위 밖 지지·저항이 사라진다 — fit 규칙(chart-bridge fitPrices 와 동일)으로 넓힘
function widenRange(original: () => LWC.AutoscaleInfo | null): LWC.AutoscaleInfo | null {
  const r = original();
  if (!r || !r.priceRange) return r;
  const prices = lineSpecs
    .filter((s) => s.fit === 'always' || (s.fit === 'day' && mode === 'day'))
    .map((s) => s.price)
    .filter((p) => typeof p === 'number' && isFinite(p));
  if (prices.length === 0) return r;
  return {
    priceRange: {
      minValue: Math.min(r.priceRange.minValue, ...prices),
      maxValue: Math.max(r.priceRange.maxValue, ...prices),
    },
    margins: r.margins,
  };
}

function applyLines() {
  const s = series;
  if (!s) return;
  priceLines.forEach((l) => s.removePriceLine(l));
  priceLines = lineSpecs.map((spec) =>
    s.createPriceLine({
      price: spec.price, color: spec.color, lineWidth: spec.width,
      lineStyle: spec.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title: '', // 이름은 RN 범례에 — 차트 안 이름은 가까운 선끼리 겹친다(축 라벨은 라이브러리가 떼어 놓음)
    }),
  );
}

const handlers: { [K in ChartMessage['type']]: (m: MessageOf<K>) => void } = {
  // 테마(라이트/다크) 색 — 이미 그린 차트는 데이터를 지우지 않게 옵션만 바꾼다
  init: (m) => {
    colors = m.colors;
    if (!chart || !series) return;
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
  load: (m) => {
    const fresh = !chart || mode !== m.mode;
    if (fresh) create(m.mode);
    const c = chart, s = series, lines = ind, b = band, vp = vpPrim;
    if (!c || !s || !lines || !b || !vp) return;
    hist.on = !!m.history;
    if (fresh || !m.keepView) {
      // 새 차트·새 종목 — 과거 이어 받기 상태 초기화(왼쪽 끝 고정도 풀기)
      hist.armed = false;
      hist.busy = false;
      hist.done = false;
      c.applyOptions({ timeScale: { fixLeftEdge: false } });
    }
    const ts = c.timeScale();
    const before = m.prepended ? ts.getVisibleLogicalRange() : null;
    s.setData(asCandles(m.bars));
    vp.points = m.bars;
    vp.update();
    for (const k of Object.keys(lines) as IndicatorKey[]) lines[k].setData(asLine(m.ind[k] || []));
    b.setPoints(bandPoints(m.ind.bbUpper || [], m.ind.bbLower || []));
    if (m.prepended) {
      // 앞에 과거를 붙임 — 보던 캔들이 그대로 보이게(라이브러리가 이미 옮겼으면 그대로, 아니면 붙인 개수만큼)
      const after = ts.getVisibleLogicalRange();
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
  older: (m) => {
    hist.busy = false;
    if (!m.more && chart) {
      hist.done = true;
      chart.applyOptions({ timeScale: { fixLeftEdge: true } }); // 더 없음 — 첫 캔들 왼쪽 빈 공간으로 밀리지 않게
    }
  },
  tick: (m) => {
    const s = series, lines = ind, b = band, vp = vpPrim;
    if (!s || !lines || !b || !vp) return;
    try {
      s.update(asCandles([m.bar])[0]);
      const last = vp.points[vp.points.length - 1];
      vp.points = last && last.time === m.bar.time ? vp.points.slice(0, -1).concat([m.bar]) : vp.points.concat([m.bar]);
      vp.update();
      for (const k of Object.keys(m.ind) as IndicatorKey[]) {
        const v = m.ind[k];
        if (v !== undefined && lines[k]) lines[k].update({ time: m.bar.time as Time, value: v });
      }
      const bu = m.ind.bbUpper;
      const bl = m.ind.bbLower;
      if (bu !== undefined && bl !== undefined) {
        const pts = b.points.filter((p) => p.time !== m.bar.time);
        pts.push({ time: m.bar.time as Time, upper: bu, lower: bl });
        b.setPoints(pts);
      }
    } catch {
      // "Cannot update oldest data" 등 — 틱 반영 실패는 무시(웹과 동일)
    }
  },
  lines: (m) => {
    lineSpecs = m.lines;
    applyLines();
  },
  vis: (m) => {
    vis = { ma: m.ma, bb: m.bb, vp: !!m.vp };
    applyVis();
  },
};

window.__chart = (m) => {
  try {
    (handlers[m.type] as (msg: ChartMessage) => void)(m);
  } catch (e) {
    post({ type: 'error', message: String((e instanceof Error && e.message) || e) });
  }
};
post({ type: 'ready' });
