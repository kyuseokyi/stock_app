// PostToolUse(Edit/Write): 고친 파일 하나만 빠르게 검사하고, 문제가 있으면 Claude 에게 바로 돌려준다.
// - backend/*.py    : ruff 의 '진짜 버그' 규칙만 (문법 오류, 정의 안 된 이름). 스타일 지적은 하지 않는다.
// - mobile, web_client 의 ts/tsx/js : eslint 오류만(--quiet)
// 또한 이번 세션에 고친 파일 목록을 임시 폴더에 적어 Stop 훅이 검사 범위를 좁히게 한다.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const file = input.tool_input?.file_path;
if (!file) process.exit(0);
const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
if (rel.startsWith('..')) process.exit(0);

const stateDir = path.join(tmpdir(), 'claude-stock-app');
mkdirSync(stateDir, { recursive: true });
appendFileSync(path.join(stateDir, `${input.session_id}.txt`), rel + '\n');

const run = (cmd, args, cwd) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 80_000, shell: process.platform === 'win32' });
const out = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
const fail = (msg) => { process.stderr.write(msg + '\n'); process.exit(2); };

if (rel.startsWith('backend/') && rel.endsWith('.py')) {
  const cwd = path.join(root, 'backend');
  const target = rel.slice('backend/'.length);
  const args = ['check', '--select', 'E9,F63,F7,F82', '--output-format', 'concise', target];
  let r = run('ruff', args, cwd);
  if (r.error) r = run('uvx', ['ruff', ...args], cwd);
  if (r.error) r = run('python3', ['-m', 'py_compile', target], cwd);
  if (!r.error && r.status === 1) fail(`[check_edit] ${rel} 검사 실패 (문법 오류 또는 정의 안 된 이름):\n${out(r)}`);
}

const m = rel.match(/^(mobile|web_client)\/(.+\.(ts|tsx|js|jsx))$/);
if (m) {
  const r = run('npx', ['--no-install', 'eslint', '--quiet', '--no-warn-ignored', m[2]], path.join(root, m[1]));
  if (!r.error && r.status === 1) fail(`[check_edit] ${rel} eslint 오류:\n${out(r)}`);
}
process.exit(0);
