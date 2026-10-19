import { useEffect, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { HistoryView as HistoryViewModel } from '../core';
import { HISTORY_HTML, toHistoryScript, type HistoryPageMessage } from '../history-web/history-page';
import type { ReportColors } from '../report-web/report-page';

const SOURCE = { html: HISTORY_HTML }; // 모듈 상수 — 렌더마다 새 객체면 다시 로드된다

/** 히스토리 페이지(WebView). 준비 신호 뒤 화면 모델을 넣고, 바뀔 때마다 다시 넣는다. */
export function HistoryView({ view, colors }: { view: HistoryViewModel; colors: ReportColors }) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ view, colors });
  useEffect(() => {
    latest.current = { view, colors };
  });

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(toHistoryScript({ type: 'render', view, colors }));
  }, [ready, view, colors]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: HistoryPageMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as HistoryPageMessage;
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      setReady(true);
      ref.current?.injectJavaScript(toHistoryScript({ type: 'render', ...latest.current })); // 페이지 재로드 대비
    }
  };

  return (
    <WebView
      ref={ref}
      source={SOURCE}
      originWhitelist={['*']}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')}
      onContentProcessDidTerminate={() => ref.current?.reload()}
      onRenderProcessGone={() => ref.current?.reload()}
      javaScriptEnabled
      setBuiltInZoomControls={false}
      webviewDebuggingEnabled={__DEV__}
      style={{ flex: 1, backgroundColor: colors.bg }}
    />
  );
}
