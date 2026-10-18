import { REPORT_HTML, toReportScript, type ReportColors } from './report-page';

describe('report-page', () => {
  it('페이지에 렌더 진입점이 있고 템플릿 치환 흔적이 없다', () => {
    expect(REPORT_HTML).toContain('window.__report = function');
    expect(REPORT_HTML).toContain('id="app"');
    expect(REPORT_HTML).not.toContain('${');
    expect(REPORT_HTML).not.toContain('innerHTML'); // 원본 값은 textContent 로만 넣는다
  });

  it('주입 스크립트는 JSON 그대로 전달하고 true 로 끝난다', () => {
    const s = toReportScript({
      type: 'render',
      report: { title: '</script>', investorNo: '', investorName: '', notice: null, sections: [] },
      colors: {} as ReportColors,
    });
    expect(s.startsWith('window.__report&&window.__report({')).toBe(true);
    expect(s.endsWith(');true;')).toBe(true);
  });
});
