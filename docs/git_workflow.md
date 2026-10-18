# Git 작업 흐름 — dev → main 머지 (일직선 이력)

작업은 `dev`에서, 배포는 `main` push로. 머지는 **fast-forward만** 써서 머지 커밋 없이 이력을 일직선으로 유지한다.

| 브랜치 | 역할 |
|---|---|
| `dev` | 일상 작업·커밋 |
| `main` | 배포 기준. **push 하면 자동 배포**(경로별 Deploy Server / Deploy Web — [`run_and_deploy.md`](./run_and_deploy.md) B-2) |

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
git config merge.ff only             # git merge 가 fast-forward 만 허용(안 되면 실패)
```
