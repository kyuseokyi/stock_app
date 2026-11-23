// Stop: Claude 가 "끝났다"고 하기 전에, 이번 세션에 고친 프로젝트의 테스트·타입검사를 돌린다.
// 실패하면 종료를 막고(exit 2) 실패 내용을 Claude 에게 돌려준다. 같은 턴에 두 번은 막지 않는다(stop_hook_active).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
if (input.stop_hook_active) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const listFile = path.join(tmpdir(), 'claude-stock-app', `${input.session_id}.txt`);
if (!existsSync(listFile)) process.exit(0);

const edited = [...new Set(readFileSync(listFile, 'utf8').split('\n').filter(Boolean))]
  .filter((f) => existsSync(path.join(root, f)));
if (!edited.length) process.exit(0);

const code = /\.(py|ts|tsx|js|jsx)$/;
const inProject = (p) => edited.filter((f) => f.startsWith(p + '/') && code.test(f)).map((f) => f.slice(p.length + 1));

const run = (cmd, args, cwd) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, shell: process.platform === 'win32' });
const tail = (s, n = 40) => s.trim().split('\n').slice(-n).join('\n');
const failures = [];

function check(label, cmd, args, cwd, onlyLinesWith) {
  const r = run(cmd, args, cwd);
  if (r.error) return; // 도구가 없으면 건너뜀
  if (r.status === 0) return;
  let text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (onlyLinesWith) {
    // 타입검사는 이번에 고친 파일의 오류만 본다(원래 있던 다른 파일 오류로 막지 않기 위해)
    const lines = text.split('\n').filter((l) => onlyLinesWith.some((f) => l.includes(f)));
    if (!lines.length) return;
    text = lines.join('\n');
  }
  failures.push(`■ ${label} 실패 — ${cmd} ${args.join(' ')}\n${tail(text)}`);
}

const backend = inProject('backend');
if (backend.length) check('backend 테스트', 'uv', ['run', 'pytest', '-q', '-x'], path.join(root, 'backend'));

const mobile = inProject('mobile');
if (mobile.length) {
  const cwd = path.join(root, 'mobile');
  check('mobile 타입검사', 'npx', ['--no-install', 'tsc', '--noEmit'], cwd, mobile);
  check('mobile 테스트', 'npx', ['--no-install', 'jest', '--findRelatedTests', ...mobile, '--passWithNoTests'], cwd);
}

const web = inProject('web_client');
if (web.length) {
  const cwd = path.join(root, 'web_client');
  check('web_client 타입검사', 'npx', ['--no-install', 'tsc', '--noEmit'], cwd, web);
  check('web_client 테스트', 'npx', ['--no-install', 'vitest', 'related', ...web, '--run', '--passWithNoTests'], cwd);
}

const admin = inProject('admin_web');
if (admin.length) check('admin_web 타입검사', 'npx', ['--no-install', 'tsc', '--noEmit'], path.join(root, 'admin_web'), admin);

if (failures.length) {
  process.stderr.write(
    '끝내기 전 검증이 실패했습니다. 고친 뒤 다시 끝내세요.\n' +
    '이번 작업과 무관한 기존 실패라면 고치지 말고 사용자에게 그 사실을 알리세요.\n\n' +
    failures.join('\n\n') + '\n'
  );
  process.exit(2);
}
writeFileSync(listFile, ''); // 통과하면 목록 초기화 → 다음 작업분만 다시 검사
process.exit(0);
