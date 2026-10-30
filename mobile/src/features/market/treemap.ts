// 트리맵 배치(squarified) — 순수 함수. web_client/src/lib/treemap.ts 의 squarify 를 이식(색은 dashboard.heatLevel + 테마 토큰).
// 큰 것부터 짧은 변을 따라 한 줄씩 채우고, 하나 더 넣었을 때 가장 길쭉한 칸이 더 나빠지면 줄을 바꾼다.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed extends Rect {
  id: string;
}

interface Item {
  id: string;
  size: number;
}

/** 한 줄의 가장 나쁜 가로세로 비율 — 짧은 변 길이 side */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/** 줄 하나를 rect 의 짧은 변을 따라 배치하고 남은 사각형을 돌려준다 */
function layoutRow(row: { id: string; area: number }[], rect: Rect, out: Placed[]): Rect {
  const sum = row.reduce((a, r) => a + r.area, 0);
  if (rect.w >= rect.h) {
    // 세로 줄(왼쪽에 쌓기)
    const colW = rect.h > 0 ? sum / rect.h : 0;
    let y = rect.y;
    for (const r of row) {
      const h = colW > 0 ? r.area / colW : 0;
      out.push({ id: r.id, x: rect.x, y, w: colW, h });
      y += h;
    }
    return { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h };
  }
  // 가로 줄(위에 쌓기)
  const rowH = rect.w > 0 ? sum / rect.w : 0;
  let x = rect.x;
  for (const r of row) {
    const w = rowH > 0 ? r.area / rowH : 0;
    out.push({ id: r.id, x, y: rect.y, w, h: rowH });
    x += w;
  }
  return { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
}

/** 크기 비례 칸 좌표. size ≤ 0(·숫자 아님)은 빠진다. 결과는 큰 순서. */
export function squarify(items: Item[], rect: Rect): Placed[] {
  const valid = items.filter((i) => Number.isFinite(i.size) && i.size > 0).sort((a, b) => b.size - a.size);
  const total = valid.reduce((a, i) => a + i.size, 0);
  const area = rect.w * rect.h;
  if (!valid.length || total <= 0 || area <= 0) return [];
  const scaled = valid.map((i) => ({ id: i.id, area: (i.size / total) * area }));
  const out: Placed[] = [];
  let remaining = rect;
  let row: { id: string; area: number }[] = [];
  for (const item of scaled) {
    const side = Math.min(remaining.w, remaining.h);
    const next = [...row, item];
    if (row.length === 0 || worst(next.map((r) => r.area), side) <= worst(row.map((r) => r.area), side)) {
      row = next;
    } else {
      remaining = layoutRow(row, remaining, out);
      row = [item];
    }
  }
  if (row.length) layoutRow(row, remaining, out);
  return out;
}

/** 칸 글자 표시 단계 — 너무 작으면 글자 생략(0), 이름만(1), 이름+등락률(2) */
export function tileLabelLevel(w: number, h: number): 0 | 1 | 2 {
  if (w < 44 || h < 22) return 0;
  return h >= 38 && w >= 52 ? 2 : 1;
}

/**
 * SVG 글자는 자동 말줄임이 없어 폭에 맞게 자른다 — 한글 한 자 ≈ fontSize, 영문·숫자 ≈ 0.6×fontSize 로 어림.
 * 안 들어가면 뒤를 자르고 '…'. 한 자도 안 들어가면 ''.
 */
export function fitLabel(text: string, width: number, fontSize = 12): string {
  const charW = (ch: string) => (/[\u0000-ÿ]/.test(ch) ? 0.6 : 1) * fontSize;
  const chars = Array.from(text);
  const total = chars.reduce((a, c) => a + charW(c), 0);
  if (total <= width) return text;
  const room = width - charW('…');
  let used = 0;
  let out = '';
  for (const c of chars) {
    if (used + charW(c) > room) break;
    used += charW(c);
    out += c;
  }
  return out ? `${out}…` : '';
}
