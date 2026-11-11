import { connectResultText, errorText, riskBannerText, summaryText } from './backup-text';
import { driveError } from './drive-backup';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 11, 12).getTime();

describe('connectResultText', () => {
  it('결과별 문구', () => {
    expect(connectResultText({ status: 'cancelled' })).toBe('');
    expect(connectResultText({ status: 'fresh' })).toBe('불러올 백업이 없어요. 앞으로의 기록은 자동으로 백업돼요');
    expect(connectResultText({ status: 'invalid' })).toBe('Drive 백업 파일을 읽을 수 없어요');
    expect(connectResultText({ status: 'restored', addedFunds: 3, skippedFunds: 0, mergedPoints: 120 })).toBe(
      '펀드 3개, 기록 120건을 불러왔어요',
    );
    expect(connectResultText({ status: 'restored', addedFunds: 10, skippedFunds: 2, mergedPoints: 5 })).toBe(
      '펀드 10개, 기록 5건을 불러왔어요 · 2개는 한도로 건너뛰었어요',
    );
  });
});

describe('summaryText', () => {
  it('마지막 날짜는 M.D', () => {
    expect(summaryText({ funds: 3, points: 120, lastDate: '2026-11-05' })).toBe(
      'Drive 백업 · 펀드 3개 · 기록 120건 · 11.5 기록까지',
    );
    expect(summaryText({ funds: 1, points: 0, lastDate: null })).toBe('Drive 백업 · 펀드 1개 · 기록 0건');
  });
});

describe('riskBannerText', () => {
  it('위험별 제목·본문', () => {
    expect(riskBannerText('none', null, NOW)).toBeNull();
    expect(riskBannerText('disconnected', null, NOW)).toEqual({
      title: '기록은 이 폰에만 있어요',
      body: '백업하지 않고 앱을 지우거나 폰을 바꾸면 기록이 사라져요',
    });
    expect(riskBannerText('stale', NOW - 9 * DAY, NOW)).toEqual({
      title: '마지막 백업이 9일 전이에요',
      body: '지금 백업해 두세요',
    });
    expect(riskBannerText('stale', null, NOW)?.title).toBe('아직 백업하지 못했어요');
  });
});

describe('errorText', () => {
  it('Drive 오류 분류별 문구', () => {
    expect(errorText(driveError('auth', 'x'))).toBe('Google 연결이 끊겼어요. 다시 연결해 주세요.');
    expect(errorText(new Error('x'))).toBe('처리하지 못했어요. 다시 시도해 주세요.');
  });
});
