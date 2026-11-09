import { houseAdFor, infeedInterval, isInfeedAfter } from './ad-config';
import type { AdConfig, AdSlot } from './api';

const slot = (over: Partial<AdSlot> = {}, house: Partial<AdSlot['house']> = {}): AdSlot => ({
  enabled: true,
  provider: 'HOUSE',
  infeed_interval: 7,
  house: { title: '실시간 차트 트레이딩 게임', description: '가상 자금으로', target_path: '/game', ...house },
  ...over,
});
const config = (s: AdSlot, over: Partial<AdConfig> = {}): AdConfig => ({
  web_enabled: false,
  mobile_enabled: true,
  slots: { MOB_HOME_FEED_NATIVE: s },
  ...over,
});

describe('하우스 배너 판정', () => {
  it('앱 전체·슬롯이 켜지고 제목·링크가 있으면 그린다', () => {
    expect(houseAdFor(config(slot()), 'MOB_HOME_FEED_NATIVE')).toEqual({
      title: '실시간 차트 트레이딩 게임',
      description: '가상 자금으로',
      targetPath: '/game',
    });
  });

  it('설정 없음·앱 스위치 꺼짐·슬롯 꺼짐·응답에 없는 슬롯은 숨김', () => {
    expect(houseAdFor(null, 'MOB_HOME_FEED_NATIVE')).toBeNull();
    expect(houseAdFor(config(slot(), { mobile_enabled: false, web_enabled: true }), 'MOB_HOME_FEED_NATIVE')).toBeNull();
    expect(houseAdFor(config(slot({ enabled: false })), 'MOB_HOME_FEED_NATIVE')).toBeNull();
    expect(houseAdFor(config(slot()), 'MOB_POST_DETAIL_BOTTOM')).toBeNull();
  });

  it('GOOGLE 은 하우스 배너로 대신하고 문구·경로가 비거나 외부 주소면 숨김', () => {
    expect(houseAdFor(config(slot({ provider: 'GOOGLE' })), 'MOB_HOME_FEED_NATIVE')?.targetPath).toBe('/game');
    expect(houseAdFor(config(slot({ provider: 'GOOGLE' }, { title: null })), 'MOB_HOME_FEED_NATIVE')).toBeNull();
    expect(houseAdFor(config(slot({}, { target_path: ' ' })), 'MOB_HOME_FEED_NATIVE')).toBeNull();
    expect(houseAdFor(config(slot({}, { target_path: 'https://example.com' })), 'MOB_HOME_FEED_NATIVE')).toBeNull();
    expect(houseAdFor(config(slot({}, { description: '' })), 'MOB_HOME_FEED_NATIVE')?.description).toBeNull();
  });
});

describe('커뮤니티 인피드 위치', () => {
  it('간격은 서버 값, 이상하면 7', () => {
    const c: AdConfig = { web_enabled: false, mobile_enabled: true, slots: { MOB_COMMUNITY_INFEED: slot({ infeed_interval: 5 }) } };
    expect(infeedInterval(c, 'MOB_COMMUNITY_INFEED')).toBe(5);
    expect(infeedInterval(null, 'MOB_COMMUNITY_INFEED')).toBe(7);
  });

  it('interval 개마다 그 글 아래', () => {
    const at = Array.from({ length: 20 }, (_, i) => i).filter((i) => isInfeedAfter(i, 7));
    expect(at).toEqual([6, 13]);
  });
});
