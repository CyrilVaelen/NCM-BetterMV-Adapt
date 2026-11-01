// Antigravity Stop 生命周期钩子：检查插件仓库是否有未提交或未推送到 GitHub 的改动
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_DIR = 'd:\\NCM\\NCM-BetterMV-0.9.0';

function allow() {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

try {
  const raw = fs.readFileSync(0, 'utf8').trim();
  const payload = raw ? JSON.parse(raw) : {};

  // 仅在模型正常结束（无工具调用）且属于首次结束检查时拦截，防止断网或异常时死循环
  if (payload.terminationReason !== 'NO_TOOL_CALL' || (payload.executionNum ?? 1) > 1) {
    allow();
  }

  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    allow();
  }

  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: REPO_DIR,
    encoding: 'utf8',
    timeout: 5000,
  }).trim();

  let ahead = 0;
  try {
    const countStr = execFileSync('git', ['rev-list', '@{u}..HEAD', '--count'], {
      cwd: REPO_DIR,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    ahead = Number.parseInt(countStr, 10) || 0;
  } catch {
    // 尚未绑定上游分支时不报错
  }

  if (dirty.length > 0 || ahead > 0) {
    const detail = dirty.length > 0 ? '存在未提交的本地文件改动' : `存在 ${ahead} 个已提交但尚未 push 的本地版本`;
    process.stdout.write(
      JSON.stringify({
        decision: 'continue',
        reason: `[GitHub 实时同步检查] 检测到 NCM-BetterMV-0.9.0 ${detail}。若本轮插件修改已完成，请按 GEMINI.md 规则确认构建无误后执行 git add、中文 git commit 并 git push origin main 同步到 GitHub；若因网络故障或用户要求暂不推送，请直接向用户说明即可。`,
      }),
    );
    process.exit(0);
  }

  allow();
} catch {
  allow();
}
