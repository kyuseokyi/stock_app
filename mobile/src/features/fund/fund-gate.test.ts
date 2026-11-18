import {
  closeFundLoginSheet,
  FUND_LOGIN_DESCRIPTION,
  FUND_LOGIN_TITLE,
  fundNavAction,
  fundTabPressAction,
  fundScreenGate,
  openFundLoginSheet,
  useFundLoginSheet,
} from './fund-gate';

describe('fundNavAction', () => {
  it('로그인했으면 이동, 아니면 로그인 안내', () => {
    expect(fundNavAction(true)).toBe('navigate');
    expect(fundNavAction(false)).toBe('login');
  });
});

describe('fundScreenGate', () => {
  it('로그인 상태면 복원 여부와 상관없이 목록', () => {
    expect(fundScreenGate(true, true)).toBe('list');
    expect(fundScreenGate(false, true)).toBe('list');
  });

  it('복원 전 비로그인은 로딩 — 안내 카드가 깜박이지 않게', () => {
    expect(fundScreenGate(false, false)).toBe('loading');
  });

  it('복원 뒤 비로그인은 로그인 안내 카드', () => {
    expect(fundScreenGate(true, false)).toBe('login');
  });
});

describe('로그인 안내 시트 상태', () => {
  afterEach(() => closeFundLoginSheet());

  it('열고 닫는다', () => {
    expect(useFundLoginSheet.getState().open).toBe(false);
    openFundLoginSheet();
    expect(useFundLoginSheet.getState().open).toBe(true);
    closeFundLoginSheet();
    expect(useFundLoginSheet.getState().open).toBe(false);
  });
});

describe('문구', () => {
  it('스펙 문구 그대로', () => {
    expect(FUND_LOGIN_TITLE).toBe('로그인이 필요해요');
    expect(FUND_LOGIN_DESCRIPTION).toBe('내 펀드 수익률을 확인하고 기기에 안전하게 보관하려면 먼저 로그인해 주세요.');
  });
});

describe('fundTabPressAction — 하단 내 펀드 탭 터치', () => {
  it('로그인했으면 어느 화면이든 그대로 이동', () => {
    expect(fundTabPressAction('/', true)).toBe('go');
    expect(fundTabPressAction('/profile', true)).toBe('go');
  });

  it('비로그인으로 내정보(로그인 화면)에 있으면 시트 없이 복귀만 기억', () => {
    expect(fundTabPressAction('/profile', false)).toBe('remember');
    expect(fundTabPressAction('/profile/', false)).toBe('remember');
  });

  it('비로그인으로 다른 화면이면 로그인 안내 시트', () => {
    expect(fundTabPressAction('/', false)).toBe('sheet');
    expect(fundTabPressAction('/market', false)).toBe('sheet');
    expect(fundTabPressAction('/profiles', false)).toBe('sheet');
    expect(fundTabPressAction('', false)).toBe('sheet');
    expect(fundTabPressAction(null, false)).toBe('sheet');
  });
});
