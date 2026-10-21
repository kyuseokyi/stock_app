// 지금 백그라운드 태스크 안에서 자동 갱신 중인지 — 그동안 생긴 새 기록의 Drive 백업은 다음 앱 복귀로 미룬다.
// push·정기 작업이 겹칠 수 있어 카운트로 센다. 각 태스크는 enter() 가 준 leave 를 한 번만 부른다.
let depth = 0;

export const isBackgroundRun = (): boolean => depth > 0;

export function enterBackgroundRun(): () => void {
  depth += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    depth = Math.max(0, depth - 1);
  };
}

export const resetBackgroundRunForTest = (): void => {
  depth = 0;
};
