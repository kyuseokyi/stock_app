import {
  enterBackgroundRun,
  isBackgroundRun,
  resetBackgroundRunForTest,
} from "./background-mode";

beforeEach(resetBackgroundRunForTest);

it("enter 하면 켜지고 leave 하면 꺼진다", () => {
  expect(isBackgroundRun()).toBe(false);
  const leave = enterBackgroundRun();
  expect(isBackgroundRun()).toBe(true);
  leave();
  expect(isBackgroundRun()).toBe(false);
});

it("중첩 enter 는 마지막 leave 에서야 꺼진다", () => {
  const a = enterBackgroundRun();
  const b = enterBackgroundRun();
  a();
  expect(isBackgroundRun()).toBe(true);
  b();
  expect(isBackgroundRun()).toBe(false);
});

it("같은 leave 를 두 번 불러도 한 번만 센다", () => {
  const a = enterBackgroundRun();
  const b = enterBackgroundRun();
  a();
  a();
  expect(isBackgroundRun()).toBe(true); // b 가 아직 남아 있다
  b();
  expect(isBackgroundRun()).toBe(false);
});

it("0 미만으로 내려가지 않는다", () => {
  const a = enterBackgroundRun();
  resetBackgroundRunForTest();
  a(); // 리셋 뒤 늦은 leave
  expect(isBackgroundRun()).toBe(false);
  const b = enterBackgroundRun();
  expect(isBackgroundRun()).toBe(true);
  b();
  expect(isBackgroundRun()).toBe(false);
});
