import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { CHART_HTML } from '../chart-web/chart-page';
import {
  DAILY_VISIBLE_DAYS,
  loadMessage,
  tickMessage,
  toInjectScript,
  type ChartColors,
  type ChartLine,
  type ChartMessage,
  type ChartRows,
  type MaPeriods,
} from '../lib/chart-bridge';
import { MA_PERIODS } from '../lib/indicators';

/** 화면에 그릴 캔들 묶음. seq 가 바뀌면 전체 로드, 같은 seq 에서 data 만 바뀌면 틱(마지막 봉 갱신) */
export type TvChartData = { data: ChartRows; seq: number; keepView: boolean };

type TvChartProps = {
  view: TvChartData | null;
  lines: ChartLine[];
  ma: boolean;
  bb: boolean;
  colors: ChartColors;
  height: number;
  onReady?: () => void;
  /** 이동평균 기간(생략 = 5·20·60, 게임). 렌더마다 새 배열을 넘기지 말 것(모듈 상수로) */
  maPeriods?: MaPeriods;
  /** 일봉 첫 화면 일수(생략 = 180, 게임) */
  visibleDays?: number;
};

const SOURCE = { html: CHART_HTML }; // 모듈 상수 — 렌더마다 새 객체면 WebView 가 다시 로드된다

/**
 * lightweight-charts(웹과 같은 차트 엔진)를 WebView 로 띄운다. 데이터·가격선·지표 표시만 메시지로 넘긴다.
 * 페이지가 준비되기 전 메시지는 버리고, ready 를 받으면 현재 상태 전체를 다시 보낸다(첫 로드·WebView 재시작 공통).
 */
export function TvChart({
  view,
  lines,
  ma,
  bb,
  colors,
  height,
  onReady,
  maPeriods = MA_PERIODS,
  visibleDays = DAILY_VISIBLE_DAYS,
}: TvChartProps) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [instance, setInstance] = useState(0); // 렌더 프로세스가 죽으면 key 를 바꿔 새로 띄운다
  const sentSeq = useRef<number | null>(null);

  const send = (msg: ChartMessage | null) => {
    if (msg) ref.current?.injectJavaScript(toInjectScript(msg));
  };

  // 색(테마) → 데이터 → 가격선·지표 순서. ready 직후엔 모두 다시 보낸다
  useEffect(() => {
    if (ready) send({ type: 'init', colors });
  }, [ready, colors]);
  useEffect(() => {
    if (!ready || view === null) return;
    if (sentSeq.current !== view.seq) {
      // 새 WebView(sentSeq=null)면 보던 위치가 없으니 첫 화면 구간부터
      send(loadMessage(view.data, sentSeq.current !== null && view.keepView, Date.now(), { maPeriods, visibleDays }));
      sentSeq.current = view.seq;
    } else {
      send(tickMessage(view.data, maPeriods));
    }
  }, [ready, view, maPeriods, visibleDays]);
  useEffect(() => {
    if (ready) send({ type: 'lines', lines });
  }, [ready, lines]);
  useEffect(() => {
    if (ready) send({ type: 'vis', ma, bb });
  }, [ready, ma, bb]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; message?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      sentSeq.current = null;
      setReady(true);
      onReady?.();
    } else if (msg.type === 'error' && __DEV__) {
      console.warn('[TvChart]', msg.message);
    }
  };

  const restart = () => {
    setReady(false);
    setInstance((n) => n + 1);
  };

  return (
    <View style={{ height }}>
      <WebView
        key={instance}
        ref={ref}
        source={SOURCE}
        originWhitelist={['*']}
        onMessage={onMessage}
        onRenderProcessGone={restart}
        onContentProcessDidTerminate={restart}
        javaScriptEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        webviewDebuggingEnabled={__DEV__}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
