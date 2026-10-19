import type { ReportColors } from '../report-web/report-page';
import { HISTORY_HTML, toHistoryScript } from './history-page';

describe('history-page', () => {
  it('렌더 진입점·준비 신호가 있고 템플릿 치환 흔적·innerHTML 이 없다', () => {
    expect(HISTORY_HTML).toContain('window.__history = function');
    expect(HISTORY_HTML).toContain('id="app"');
    expect(HISTORY_HTML).toContain("post({ type: 'ready' })");
    expect(HISTORY_HTML).not.toContain('${');
    expect(HISTORY_HTML).not.toContain('`');
    expect(HISTORY_HTML).not.toContain('innerHTML');
  });

  it('화면 모델만 그린다 — 포맷 로직 없음', () => {
    expect(HISTORY_HTML).toContain('render(msg.view)');
    expect(HISTORY_HTML).not.toContain('toLocaleString');
    expect(HISTORY_HTML).not.toContain('Intl.');
  });

  it('리포트와 같은 스타일 토큰을 쓴다', () => {
    expect(HISTORY_HTML).toContain('--accent');
    expect(HISTORY_HTML).toContain('.row {');
  });

  it('주입 스크립트는 JSON 그대로 전달하고 true 로 끝난다', () => {
    const s = toHistoryScript({
      type: 'render',
      view: { accounts: [], account: '', range: 'all', chart: null, rows: [], total: 0 },
      colors: {} as ReportColors,
    });
    expect(s.startsWith('window.__history&&window.__history({"type":"render","view":{')).toBe(true);
    expect(s.endsWith(');true;')).toBe(true);
  });
});
