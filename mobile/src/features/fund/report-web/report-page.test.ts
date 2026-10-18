import { REPORT_HTML, toReportScript, type ReportColors } from './report-page';

describe('report-page', () => {
  it('페이지에 렌더 진입점이 있고 템플릿 치환 흔적이 없다', () => {
    expect(REPORT_HTML).toContain('window.__report = function');
    expect(REPORT_HTML).toContain('id="app"');
    expect(REPORT_HTML).toContain("post({ type: 'ready' })");
    expect(REPORT_HTML).not.toContain('${');
    expect(REPORT_HTML).not.toContain('`'); // 페이지 스크립트는 String.raw 안 — 백틱이 있으면 잘린다
    expect(REPORT_HTML).not.toContain('innerHTML'); // 원본 값은 textContent 로만 넣는다
  });

  it('화면 모델(view)만 그린다 — 원본 report 나 포맷 로직을 다루지 않는다', () => {
    expect(REPORT_HTML).toContain('render(msg.view)');
    expect(REPORT_HTML).not.toContain('msg.report');
    expect(REPORT_HTML).not.toContain('toFixed');
  });

  it('주입 스크립트는 JSON 그대로 전달하고 true 로 끝난다', () => {
    const s = toReportScript({
      type: 'render',
      view: { title: '</script>', evalDate: '', notice: null, sections: [] },
      colors: {} as ReportColors,
    });
    expect(s.startsWith('window.__report&&window.__report({"type":"render","view":{')).toBe(true);
    expect(s.endsWith(');true;')).toBe(true);
  });
});
