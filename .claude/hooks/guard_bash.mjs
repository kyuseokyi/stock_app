// PreToolUse(Bash): 운영 배포·비밀 파일에 닿는 명령은 실행 전에 사용자에게 묻는다.
// settings.local.json 이 "Bash" 를 통째로 허용하므로, 이 훅이 마지막 안전장치다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const cmd = input.tool_input?.command ?? '';
const reasons = [];

// 1) main push = 운영 자동 배포 (docs/git_workflow.md)
if (/\bgit\s+push\b/.test(cmd)) {
  let branch = '';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {}
  if (/\bmain\b/.test(cmd) || branch === 'main') reasons.push('main 브랜치 push → 운영 자동 배포');
}

// 2) 그 밖의 운영 배포·되돌리기 어려운 명령
const prodRules = [
  [/\b(ota|build:\w+|ios|android):prod\b/, '운영 앱 빌드/OTA 배포'],
  [/\beas\s+(update|submit)\b/, 'EAS 업데이트/스토어 제출'],
  [/deploy\/swarm\/(deploy|cutover|rollback-to-compose)\.sh/, '운영 서버 배포 스크립트'],
  [/docker-compose\.prod\.yml/, '운영 docker compose'],
  [/\bkubectl\b/, 'Kubernetes 조작'],
  [/\balembic\b.*\bdowngrade\b/, 'DB 마이그레이션 되돌리기'],
];
for (const [re, why] of prodRules) if (re.test(cmd)) reasons.push(why);

// 3) 비밀 파일 (.env.example 은 허용)
if (/(^|[\s'"\/=<])\.env(\.(development|production)(\.local)?)?(?![\w.])/.test(cmd) ||
    /(^|[\s'"\/])secrets\//.test(cmd)) {
  reasons.push('비밀 파일(.env, mobile/secrets) 접근');
}

if (reasons.length) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `확인 필요: ${[...new Set(reasons)].join(', ')}`,
    },
  }));
}
process.exit(0);
