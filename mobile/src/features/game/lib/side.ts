// 방향 표시 용어 — API·DB 값(LONG/SHORT)은 그대로 두고, 화면에는 한국어(상승/하락)로만 보여준다.
import type { Side } from '../types';

/** 'LONG' → '상승', 'SHORT' → '하락' */
export function sideLabel(side: Side): '상승' | '하락' {
  return side === 'LONG' ? '상승' : '하락';
}
