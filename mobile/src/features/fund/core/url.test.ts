import { isFundError } from './types';
import { normalizeFundUrl } from './url';

const OK = 'https://fund.ivyro.net/dataroom/om_data/om_v3_0000001_TEST.htm';

describe('normalizeFundUrl', () => {
  it('앞뒤 공백을 지우고 통과시킨다', () => {
    expect(normalizeFundUrl(`  ${OK}\n`)).toBe(OK);
  });

  it.each([
    ['http', 'http://fund.ivyro.net/dataroom/om_data/a.htm'],
    ['유사 호스트(접미)', 'https://fund.ivyro.net.evil.com/dataroom/om_data/a.htm'],
    ['다른 호스트', 'https://evil.com/fund.ivyro.net/dataroom/om_data/a.htm'],
    ['사용자 정보', 'https://user@fund.ivyro.net/dataroom/om_data/a.htm'],
    ['다른 경로', 'https://fund.ivyro.net/dataroom/other/a.htm'],
    ['하위 경로', 'https://fund.ivyro.net/dataroom/om_data/x/a.htm'],
    ['쿼리', 'https://fund.ivyro.net/dataroom/om_data/a.htm?x=1'],
    ['확장자', 'https://fund.ivyro.net/dataroom/om_data/a.html'],
    ['스킴 없음', 'fund.ivyro.net/dataroom/om_data/a.htm'],
    ['빈 값', ''],
  ])('%s 는 input 오류', (_label, url) => {
    expect.assertions(1);
    try {
      normalizeFundUrl(url);
    } catch (e) {
      expect(isFundError(e, 'input')).toBe(true);
    }
  });
});
