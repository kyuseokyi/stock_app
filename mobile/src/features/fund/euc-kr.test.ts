import { readFileSync } from 'fs';
import { join } from 'path';
import { TextDecoder as NodeTextDecoder } from 'util'; // Expo 가 전역 TextDecoder 를 utf-8 전용으로 덮어쓴다

import { decodeEucKr } from './euc-kr';

const bytes = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('decodeEucKr', () => {
  // Node(ICU)의 euc-kr 은 CP949 확장 한글을 못 풀어 정답으로 못 쓴다 — 확장 글자는 Python cp949·WHATWG 표 기준으로 따로 본다
  const raw = readFileSync(join(__dirname, '__fixtures__/disclosure.euckr.htm'));
  const EXT = Buffer.from([0x8c, 0x62]); // '똟' — 원본에 하나 있는 KS X 1001 밖 글자

  it('펀드공시 원본이 Node euc-kr 해독과 똑같다(확장 글자 자리만 빼고)', () => {
    const plain = Buffer.from(raw.toString('latin1').split(EXT.toString('latin1')).join('??'), 'latin1');
    expect(decodeEucKr(bytes(plain))).toBe(new NodeTextDecoder('euc-kr').decode(plain));
  });

  it('KS X 1001 밖 확장 한글(CP949)도 푼다', () => {
    expect(decodeEucKr(bytes(EXT))).toBe('똟');
    const text = decodeEucKr(bytes(raw));
    expect(text).toContain('개미군단 관뚜껑을 똟고');
    expect(text).not.toContain('\ufffd');
  });

  it('잘린 마지막 바이트는 U+FFFD', () => {
    expect(decodeEucKr(bytes(Buffer.from([0x41, 0xb0])))).toBe('A�');
  });
});
