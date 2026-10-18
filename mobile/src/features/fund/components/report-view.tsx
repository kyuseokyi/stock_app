import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { toReportView, type FundReport } from '../core';
import { REPORT_HTML, toReportScript, type PageMessage, type ReportColors } from '../report-web/report-page';

const SOURCE = { html: REPORT_HTML }; // 모듈 상수 — 렌더마다 새 객체면 WebView 가 다시 로드된다

type Props = { report: FundReport; colors: ReportColors };

/** 리포트 페이지(WebView). 준비 신호를 받으면 화면 모델(toReportView)을 넣고, 이후 데이터·색이 바뀔 때마다 다시 넣는다. */
export function ReportView({ report, colors }: Props) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const view = useMemo(() => toReportView(report), [report]); // 표시 포맷은 core 에서 한 번만
  const latest = useRef({ view, colors });
  latest.current = { view, colors };

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(toReportScript({ type: 'render', view, colors }));
  }, [ready, view, colors]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: PageMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as PageMessage;
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      setReady(true);
      // 페이지가 다시 로드된 경우(프로세스 재시작 등) ready 가 이미 true 라 effect 가 안 돈다 → 직접 넣는다
      ref.current?.injectJavaScript(toReportScript({ type: 'render', ...latest.current }));
    } else if (msg.type === 'open' && /^https?:\/\//i.test(msg.href)) {
      void Linking.openURL(msg.href);
    }
  };

  return (
    <WebView
      ref={ref}
      source={SOURCE}
      originWhitelist={['*']}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')} // 페이지 밖 이동 차단
      onContentProcessDidTerminate={() => ref.current?.reload()}
      onRenderProcessGone={() => ref.current?.reload()}
      javaScriptEnabled
      setBuiltInZoomControls={false}
      webviewDebuggingEnabled={__DEV__}
      style={{ flex: 1, backgroundColor: colors.bg }}
    />
  );
}
