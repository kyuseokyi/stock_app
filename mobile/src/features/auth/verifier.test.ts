import { challengeFor } from './pkce';
import { createVerifierPair, type RandomGlobals } from './verifier';

const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;

describe('createVerifierPair', () => {
  it('crypto.getRandomValues 가 있으면 32바이트 무작위 사용', () => {
    const source: RandomGlobals = {
      crypto: { getRandomValues: (a: Uint8Array) => a.fill(0xff) },
    };
    const { verifier, cc } = createVerifierPair(source);
    expect(verifier).toBe('_'.repeat(42) + '8');
    expect(cc).toBe(challengeFor(verifier));
  });

  it('없으면 네이티브 expo.uuidv4(CSPRNG) 3개를 SHA-256 으로 압축', () => {
    let n = 0;
    const uuids = [
      '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0',
      '11111111-2222-4333-8444-555555555555',
      'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
    ];
    const source: RandomGlobals = { expo: { uuidv4: () => uuids[n++] } };
    const { verifier, cc } = createVerifierPair(source);
    expect(n).toBe(3);
    expect(verifier).toMatch(B64URL_43);
    expect(verifier).toBe(challengeFor(uuids.join(''))); // sha256(uuid1+uuid2+uuid3)
    expect(cc).toBe(challengeFor(verifier));
  });

  it('uuid 형식이 아니거나 중복이면 거부', () => {
    expect(() => createVerifierPair({ expo: { uuidv4: () => 'not-a-uuid' } })).toThrow();
    const same = '11111111-2222-4333-8444-555555555555';
    expect(() => createVerifierPair({ expo: { uuidv4: () => same } })).toThrow();
  });

  it('보안 난수원이 없으면 예외(Math.random 폴백 금지)', () => {
    const spy = jest.spyOn(Math, 'random');
    expect(() => createVerifierPair({})).toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('매번 다른 verifier(실제 jest 환경 crypto)', () => {
    const a = createVerifierPair();
    const b = createVerifierPair();
    expect(a.verifier).toMatch(B64URL_43);
    expect(a.cc).toMatch(B64URL_43);
    expect(a.verifier).not.toBe(b.verifier);
  });
});
