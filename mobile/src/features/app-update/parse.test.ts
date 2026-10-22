import { parseVersionCheck } from './parse';

describe('parseVersionCheck', () => {
  it('명세 3-2 응답을 그대로 읽는다', () => {
    const r = parseVersionCheck({
      maintenance: { is_active: false, message: null },
      store: {
        update_type: 'FORCE',
        latest_version: '1.1.0',
        min_supported_version: '1.0.0',
        title: '업데이트 안내',
        message: '최신 버전이 필요합니다.',
        store_url: 'https://play.google.com/store/apps/details?id=com.stockapp',
      },
      ota: { policy: 'OPTIONAL', title: '새 기능', message: '재시작할까요?' },
    });
    expect(r).toEqual({
      maintenance: { isActive: false, message: null },
      store: {
        updateType: 'FORCE',
        latestVersion: '1.1.0',
        minSupportedVersion: '1.0.0',
        title: '업데이트 안내',
        message: '최신 버전이 필요합니다.',
        storeUrl: 'https://play.google.com/store/apps/details?id=com.stockapp',
      },
      ota: { policy: 'OPTIONAL', title: '새 기능', message: '재시작할까요?' },
    });
  });

  it('객체가 아닌 본문(404 HTML·null·배열·숫자)은 null', () => {
    expect(parseVersionCheck('<html>Not Found</html>')).toBeNull();
    expect(parseVersionCheck(null)).toBeNull();
    expect(parseVersionCheck(undefined)).toBeNull();
    expect(parseVersionCheck([])).toBeNull();
    expect(parseVersionCheck(42)).toBeNull();
  });

  it('필드가 모두 빠진 객체 → 안전한 기본값(점검 아님·NONE·SILENT)', () => {
    expect(parseVersionCheck({})).toEqual({
      maintenance: { isActive: false, message: null },
      store: {
        updateType: 'NONE',
        latestVersion: null,
        minSupportedVersion: null,
        title: null,
        message: null,
        storeUrl: null,
      },
      ota: { policy: 'SILENT', title: null, message: null },
    });
  });

  it('형식 불량 값은 기본값으로', () => {
    const r = parseVersionCheck({
      maintenance: { is_active: 'true', message: 123 },
      store: { update_type: 'SOMETHING', title: '   ', store_url: {} },
      ota: { policy: 7 },
    })!;
    expect(r.maintenance).toEqual({ isActive: false, message: null }); // 문자열 'true' 는 점검으로 보지 않음
    expect(r.store.updateType).toBe('NONE');
    expect(r.store.title).toBeNull();
    expect(r.store.storeUrl).toBeNull();
    expect(r.ota.policy).toBe('SILENT');
  });

  it('하위 객체 자리에 배열·문자열이 와도 안전', () => {
    const r = parseVersionCheck({ maintenance: [], store: 'x', ota: null })!;
    expect(r.maintenance.isActive).toBe(false);
    expect(r.store.updateType).toBe('NONE');
    expect(r.ota.policy).toBe('SILENT');
  });

  it('소문자 열거값도 받아들인다', () => {
    const r = parseVersionCheck({ store: { update_type: 'recommended' }, ota: { policy: 'mandatory' } })!;
    expect(r.store.updateType).toBe('RECOMMENDED');
    expect(r.ota.policy).toBe('MANDATORY');
  });

  it('점검 문구는 앞뒤 공백 제거', () => {
    expect(parseVersionCheck({ maintenance: { is_active: true, message: '  02~04시 점검  ' } })!.maintenance).toEqual({
      isActive: true,
      message: '02~04시 점검',
    });
  });

  it('store_url 은 https 만 — http·javascript·market 은 null(기본 스토어로 대체)', () => {
    const url = (v: unknown) => parseVersionCheck({ store: { store_url: v } })!.store.storeUrl;
    expect(url('HTTPS://play.google.com/store/apps/details?id=com.stockapp')).toBe(
      'HTTPS://play.google.com/store/apps/details?id=com.stockapp',
    );
    expect(url('http://play.google.com/x')).toBeNull();
    expect(url('javascript:alert(1)')).toBeNull();
    expect(url('market://details?id=com.stockapp')).toBeNull();
    expect(url('https://')).toBeNull();
    expect(url('https://a b')).toBeNull();
  });
});
