# Git 작업 흐름 — feature → dev → main

작업은 기능 브랜치(`feature/…`)에서, dev 에는 기능마다 머지 커밋 하나로 합치고, 배포는 dev 를 `main` 으로 **fast-forward** 해 push.

| 브랜치 | 역할 |
|---|---|
| `dev` | 일상 작업·커밋 |
| `main` | 배포 기준. **push 하면 자동 배포**(경로별 Deploy Server / Deploy Web — [`run_and_deploy.md`](./run_and_deploy.md) B-2) |
| `feature/<기능>`·`fix/<내용>` | 기능 하나씩 작업(2026-10-25부터). dev 에서 갈라져 dev 로 합쳐진다 |

---

## 0. 기능 브랜치 — 기능 하나 = 브랜치 하나 = dev 의 머지 커밋 하나

기능별로 이력을 묶어 "이 기능이 언제 들어갔는지·통째로 되돌리기"가 되게 한다.

```bash
# 1) dev 최신에서 갈라지기
git switch dev
git switch -c feature/us-stocks          # 이름: feature/<기능>, 버그는 fix/<내용>, 문서만은 docs/<내용>

# 2) 작업·커밋(작은 단위로 여러 번)
git commit -m "feat: ..."

# 3) 끝나면(테스트 통과) dev 로 합치기 — 머지 커밋을 꼭 만든다
git switch dev
git merge --no-ff feature/us-stocks -m "Merge feature/us-stocks: 미국 개별 주식"
git branch -d feature/us-stocks          # 합쳐진 브랜치만 지워진다(-d)

# 4) 배포는 기존과 같다 — dev 를 main 으로 fast-forward(1번)
git fetch . dev:main
```

- dev 이력: `git log --oneline --first-parent dev` 로 보면 **기능 단위 머지 커밋만** 한 줄씩 보인다.
- 기능 통째로 되돌리기(push 후): `git revert -m 1 <머지 커밋>`.
- 여러 기능을 동시에 벌리지 않는다(한 작업 폴더). 다른 기능으로 넘어갈 땐 지금 브랜치를 커밋하고 dev 에서 새로 갈라진다.
- 기능 브랜치가 오래되어 dev 가 앞서 있으면, push 전이면 `git rebase dev`, push 했으면 `git merge dev`.
- main 은 여전히 dev 의 fast-forward 만 받는다(main 에 직접 커밋 금지).

---

## 1. 기본 — dev 를 main 으로 머지 (브랜치 전환 없이)

```bash
# 1) 지금 dev 에 있는지 확인
git branch --show-current            # → dev

# 2) 일직선 머지가 가능한지 확인 (main 이 dev 의 조상이어야 함)
git merge-base --is-ancestor main dev && echo FF_OK

# 3) main 을 dev 위치로 이동 (fast-forward 만 허용 — 안 되면 거부됨)
git fetch . dev:main

# 4) 결과 확인
git log --oneline -3 main

# 5) 배포
git push origin main
git push origin dev                  # dev 도 원격에 맞춰 두려면(최초 1회는 -u)
```

- `.` = 지금 저장소를 원격처럼, `dev:main` = dev 커밋으로 main 을 옮겨라.
- 작업 폴더 파일이 바뀌지 않고 **브랜치는 그대로 dev** — "main 으로 바꿔 둔 채 다음 작업을 커밋"하는 실수가 원천적으로 없다.
- ⚠️ **main 에 체크아웃된 상태에서는 거부된다**(`refusing to fetch into branch ... checked out`). 반드시 dev 에서 실행.

### 같은 결과, 브랜치를 바꾸는 방식

```bash
git switch main
git merge --ff-only dev              # 일직선이 안 되면 머지하지 않고 멈춤
git push origin main
git switch dev                       # ← 잊지 말 것
```

---

## 2. 머지가 거부될 때 — main 에 dev 에 없는 커밋이 있음

`FF_OK` 가 안 나오거나 `fetch . dev:main` 이 `(non-fast-forward)` 로 거부되면, main 에만 있는 커밋이 있다는 뜻
(GitHub 에서 머지했거나, main 에서 직접 커밋한 경우).

```bash
git log --oneline dev..main          # main 에만 있는 커밋 확인
```

| 상황 | 해결 (dev 에서) |
|---|---|
| dev 에 새 커밋 없음(main 이 앞섬) | `git merge --ff-only main` → dev 가 main 을 따라감 |
| 둘 다 새 커밋, dev 커밋은 **아직 push 안 함** | `git rebase main` → dev 커밋을 main 위로 다시 쌓음 → 1번 다시 |
| 둘 다 새 커밋, dev 를 **이미 push 함** | `git merge main` (dev 에 머지 커밋 1개 허용) → 1번 다시 |

> main 에 체크아웃된 상태라면 `git fetch . main:dev && git switch dev` 로 dev 를 main 위치로 맞추고 돌아올 수 있다(dev 에 새 커밋이 없을 때).

---

## 3. 되돌리기

**push 전** — main 을 머지 전 위치로(dev 에 있는 상태에서):

```bash
git reflog show main -3              # 머지 전 커밋 해시 확인
git branch -f main <머지전_해시>
```

**push 후** — main 을 force push 하지 않는다(이미 배포됨). dev 에서 `git revert <커밋>` 으로 되돌리는 커밋을 만들고 1번으로 다시 머지·push.

---

## 4. 확인

```bash
git log --oneline --graph -10        # 일직선인지(가지 없음)
gh run list --limit 4                # 배포 워크플로 결과
```

---

## 5. (선택) 일직선을 기본값으로

```bash
git config pull.rebase true          # pull 시 머지 커밋 대신 rebase
# merge.ff only 는 쓰지 않는다 — 기능 브랜치를 dev 에 --no-ff 로 합치기 때문
```
