import { accountIdentityLabel } from './account-identity';

const base = { id: 12, email: null, role: 'FREE' };

describe('accountIdentityLabel', () => {
  it('소셜 로그인 방식별 라벨', () => {
    expect(accountIdentityLabel({ ...base, provider: 'KAKAO' })).toBe('회원 번호 #12 · 카카오 로그인');
    expect(accountIdentityLabel({ ...base, provider: 'NAVER' })).toBe('회원 번호 #12 · 네이버 로그인');
    expect(accountIdentityLabel({ ...base, provider: 'GOOGLE' })).toBe('회원 번호 #12 · 구글 로그인');
    expect(accountIdentityLabel({ ...base, provider: 'APPLE' })).toBe('회원 번호 #12 · 애플 로그인');
  });

  it('모르는 코드는 원문', () => {
    expect(accountIdentityLabel({ ...base, provider: 'LINE' })).toBe('회원 번호 #12 · LINE 로그인');
  });

  it('관리자면 관리자, 공급자 없는 관리자는 이메일 로그인 + 이메일', () => {
    expect(accountIdentityLabel({ id: 1, email: 'admin@stock.app', role: 'ADMIN', provider: null })).toBe(
      '회원 번호 #1 · 이메일 로그인 · 관리자 · admin@stock.app',
    );
    expect(accountIdentityLabel({ ...base, role: 'ADMIN', provider: 'KAKAO' })).toBe(
      '회원 번호 #12 · 카카오 로그인 · 관리자',
    );
  });

  it('공급자 없는 일반 계정(게스트·심사)은 방식 생략, 이메일은 표시', () => {
    expect(accountIdentityLabel({ ...base, email: 'g@guest.local', provider: null })).toBe(
      '회원 번호 #12 · g@guest.local',
    );
  });

  it('옛 저장값·구 서버(provider 없음)는 방식 문구만 생략', () => {
    expect(accountIdentityLabel(base)).toBe('회원 번호 #12');
    expect(accountIdentityLabel({ ...base, role: 'ADMIN' })).toBe('회원 번호 #12 · 관리자');
  });
});

describe('toUserOrNull provider 매핑', () => {
  // api.ts 는 env·클라이언트를 불러오므로 함수만 필요할 때 늦게 불러온다
  const { toUserOrNull } = jest.requireActual('./api') as typeof import('./api');

  it('문자열·null 은 담고, 필드 없음(구 서버)은 생략', () => {
    expect(toUserOrNull({ id: 1, email: null, nickname: 'a', role: 'FREE', provider: 'KAKAO' })?.provider).toBe('KAKAO');
    const nul = toUserOrNull({ id: 1, email: null, nickname: 'a', role: 'ADMIN', provider: null });
    expect(nul && 'provider' in nul && nul.provider === null).toBe(true);
    const old = toUserOrNull({ id: 1, email: null, nickname: 'a', role: 'FREE' });
    expect(old && 'provider' in old).toBe(false);
  });
});
