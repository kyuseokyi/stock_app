import { base64Url, challengeFor, sha256, utf8Bytes } from './pkce';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('sha256 (FIPS 180-4 테스트 벡터)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', // 448비트 — 패딩이 다음 블록으로 넘어감
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['a'.repeat(1000), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'], // 다중 블록
    ['가나다 PKCE ✓', '67f7def7504fac5bd72092adae37ac1038cdfe5b4929ca6a610a65d052d01f64'], // UTF-8
  ])('sha256(%j)', (input, expected) => {
    expect(hex(sha256(utf8Bytes(input)))).toBe(expected);
  });
});

describe('base64Url', () => {
  it('패딩 없이 -/_ 로 인코딩', () => {
    expect(base64Url(new Uint8Array([]))).toBe('');
    expect(base64Url(new Uint8Array([0xfb]))).toBe('-w');
    expect(base64Url(new Uint8Array([0xff, 0xff]))).toBe('__8');
    expect(base64Url(new Uint8Array([1, 2, 3]))).toBe('AQID');
  });

  it('32바이트 → 43자', () => {
    expect(base64Url(new Uint8Array(32).fill(7))).toHaveLength(43);
  });
});

describe('challengeFor (서버 backend/apps/auth/social/pkce.py 와 같은 값)', () => {
  it('verifier → base64url(sha256(verifier))', () => {
    // python: base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=")
    expect(challengeFor('dBjftJeZ4CVP-mJ0z9-iFGc8Ld2ZRY0kbtiYn3sV1mA')).toBe(
      'RpV7k_Xo-g58xYMROqMQxiLVZJ_Qsja-mv-hZ9MkGxA',
    );
  });

  it('43자 base64url', () => {
    expect(challengeFor('anything')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
