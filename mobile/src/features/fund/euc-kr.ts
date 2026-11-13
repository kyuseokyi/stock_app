// EUC-KR(CP949) 바이트 → 문자열. 앱 전용 — Hermes 의 TextDecoder 는 utf-8 만 안다(웹은 TextDecoder('euc-kr')).
// 펀드공시 시트(core/disclosure.ts) 해독에 쓴다. 표는 scripts/gen-euc-kr-table.py 생성물.
import { CP949_TABLE } from './euc-kr-table';

const TRAIL_SPAN = 0xff - 0x41; // 190

export function decodeEucKr(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  const out: string[] = [];
  let chunk = '';
  for (let i = 0; i < b.length; i++) {
    const lead = b[i];
    if (lead < 0x80) {
      chunk += String.fromCharCode(lead);
    } else if (lead >= 0x81 && lead <= 0xfe && i + 1 < b.length && b[i + 1] >= 0x41 && b[i + 1] <= 0xfe) {
      chunk += CP949_TABLE[(lead - 0x81) * TRAIL_SPAN + (b[i + 1] - 0x41)];
      i++;
    } else {
      chunk += '�';
    }
    if (chunk.length >= 4096) {
      out.push(chunk); // 긴 문자열 이어 붙이기를 조각으로 끊는다
      chunk = '';
    }
  }
  out.push(chunk);
  return out.join('');
}
