/**
 * 간편 로그인 verifier 생성 — 보안 난수원만 사용(Math.random 폴백 금지).
 *
 * 1) globalThis.crypto.getRandomValues 가 있으면(웹 타깃·향후 Hermes) 32바이트를 그대로 쓴다.
 * 2) 없으면(현재 Hermes/RN 0.86) expo-modules-core 가 네이티브로 설치하는 globalThis.expo.uuidv4 를 쓴다.
 *    Android 는 java.util.UUID.randomUUID()(SecureRandom), iOS 는 Foundation UUID()(시스템 CSPRNG).
 *    UUIDv4 3개(122비트 × 3 = 366비트)를 SHA-256 으로 압축해 32바이트 verifier 를 만든다.
 * 3) 둘 다 없으면 예외 — 호출 측이 로그인 실패로 처리한다.
 * 새 네이티브 의존성(expo-crypto 등)을 추가하지 않기 위한 선택이다.
 */
import { base64Url, challengeFor, sha256, utf8Bytes } from './pkce';

export type RandomGlobals = {
  crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  expo?: { uuidv4?: () => string };
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomVerifier(source: RandomGlobals): string {
  const getRandomValues = source.crypto?.getRandomValues;
  if (typeof getRandomValues === 'function') {
    return base64Url(getRandomValues.call(source.crypto, new Uint8Array(32)));
  }

  const uuidv4 = source.expo?.uuidv4;
  if (typeof uuidv4 === 'function') {
    const parts = [uuidv4(), uuidv4(), uuidv4()];
    if (!parts.every((u) => UUID_V4.test(u)) || new Set(parts).size !== parts.length) {
      throw new Error('native uuidv4 returned unexpected values');
    }
    return base64Url(sha256(utf8Bytes(parts.join(''))));
  }

  throw new Error('secure random source unavailable');
}

/** verifier(앱 메모리에만 보관) + cc(start URL 로 전송) */
export function createVerifierPair(
  source: RandomGlobals = globalThis as unknown as RandomGlobals,
): { verifier: string; cc: string } {
  const verifier = randomVerifier(source);
  return { verifier, cc: challengeFor(verifier) };
}
