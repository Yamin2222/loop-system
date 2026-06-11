import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './paths.mjs';
import { verify } from './verify.mjs';

const tsNow = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function cronLog(root, line) {
  appendFileSync(join(root, '.loop', 'cron.log'), line + '\n');
}

const READONLY_TOOLS = ['Read', 'Write', 'Grep', 'Glob', 'Bash'];
const FIX_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'];

function allowedToolArgs(tools) {
  return tools.flatMap((t) => ['--allowed-tool', t]);
}

// 运行 coco -p，返回 { status, stdout }
function runCoco(prompt, tools, { capture = false } = {}) {
  const args = ['-p', prompt, ...allowedToolArgs(tools)];
  if (capture) {
    const r = spawnSync('coco', args, { encoding: 'utf8' });
    if (r.error) console.error(`[coco] 执行失败: ${r.error.message}`);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return { status: r.status ?? (r.error ? 127 : 1), stdout: (r.stdout || '') + (r.stderr || '') };
  }
  const r = spawnSync('coco', args, { stdio: 'inherit' });
  if (r.error) console.error(`[coco] 执行失败: ${r.error.message}`);
  return { status: r.status ?? (r.error ? 127 : 1), stdout: '' };
}

const PROMPT_TRIAGE =
  '运行 loop-triage skill。先读 STATE.md 和 LOOP.md，把 High-Priority 和 Watch 项合并进 STATE.md，更新 Last run 时间戳为当前时间，并在 Activity Log 末尾追加一行记录。只汇报，不改任何源码。';

const promptPlan = (target) =>
  `读 LOOP.md 与 STATE.md。把以下目标委派给 @loop-planner 子代理，让它调研代码库并产出 plan.md（写到 .loop/plan.md）。只策划，不写实现代码。目标：${target}`;

const promptFix = (target) =>
  `读 LOOP.md 与 STATE.md，按三角色编排处理以下目标：
1) 委派 @loop-planner 产出 .loop/plan.md（若 .loop/plan.md 已存在且匹配该目标，可复用）。
2) 委派 @loop-executor 严格照 plan.md 在隔离 worktree 中落地实现+测试。
3) 委派 @loop-verifier 独立校验。verifier 可在子代理环境写报告并返回摘要；主编排者必须把最终机器可解析裁决写入当前主工作区 .loop/verifier-report.md，首行必须是 ## Verdict: APPROVE | REQUEST_CHANGES | REJECT | ESCALATE_HUMAN。
verifier APPROVE 才提议 PR，绝不自动合并；REQUEST_CHANGES/REJECT 则回 executor 修一轮或升级人工。
命中拒绝清单或模糊项一律升级人工。把结果追加到 STATE.md 的 Activity Log。
目标：${target}`;

function nonEmptyFile(p) {
  try { return statSync(p).size > 0; } catch { return false; }
}

// run triage|plan|fix [目标...]
export function run(args) {
  const root = projectRoot();
  mkdirSync(join(root, '.loop'), { recursive: true });
  const mode = args[0] || 'triage';
  const target = args.slice(1).join(' ');
  const ts = tsNow();

  if (mode === 'triage') {
    cronLog(root, `[${ts}] L1 triage 开始`);
    runCoco(PROMPT_TRIAGE, READONLY_TOOLS);
    const vrc = verify([]);
    if (vrc === 0) cronLog(root, '[verify] PASS');
    else {
      cronLog(root, `[verify] FAIL rc=${vrc} — STATE.md 可能未正确更新，请人工查 .loop/cron.log`);
      return vrc;
    }
    cronLog(root, `[${tsNow()}] ${mode} 结束`);
    return 0;
  }

  if (mode === 'plan') {
    if (!target) { console.error('用法: loop-system run plan "<目标描述>"'); return 1; }
    cronLog(root, `[${ts}] L2 plan 开始: ${target}`);
    const planPath = join(root, '.loop', 'plan.md');
    rmSync(planPath, { force: true });
    const { status } = runCoco(promptPlan(target), READONLY_TOOLS);
    if (status !== 0) {
      cronLog(root, `[plan] coco 执行失败 rc=${status}`);
      return 1;
    }
    if (!nonEmptyFile(planPath)) {
      console.error('[plan] FAIL: .loop/plan.md 未生成或为空');
      cronLog(root, '[plan] FAIL: .loop/plan.md 未生成或为空');
      return 1;
    }
    cronLog(root, `[plan] 方案见 .loop/plan.md，确认后可跑: loop-system run fix "${target}"`);
    cronLog(root, `[${tsNow()}] ${mode} 结束`);
    return 0;
  }

  if (mode === 'fix') {
    if (!target) { console.error('用法: loop-system run fix "<目标描述>"'); return 1; }
    // need_git_head
    const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' });
    if (head.status !== 0) {
      const msg = '[fix] 需人工：当前仓库没有有效 HEAD，worktree 子代理无法创建隔离环境；请先完成一次初始 commit 后重试';
      console.error(msg); cronLog(root, msg);
      return 2;
    }
    cronLog(root, `[${ts}] L2 fix(三角色) 开始: ${target}`);
    rmSync(join(root, '.loop', 'verifier-report.md'), { force: true });
    rmSync(join(root, '.loop', 'fix-output.md'), { force: true });
    const { status, stdout } = runCoco(promptFix(target), FIX_TOOLS, { capture: true });
    writeFileSync(join(root, '.loop', 'fix-output.md'), stdout);
    if (status !== 0) cronLog(root, `[fix] coco 执行失败 rc=${status}，继续检查 .loop/verifier-report.md`);

    const reportPath = join(root, '.loop', 'verifier-report.md');
    // 裁决唯一可信来源：verifier 亲自落盘的 verifier-report.md
    if (!nonEmptyFile(reportPath)) {
      writeFileSync(reportPath,
        '## Verdict: ESCALATE_HUMAN\n\nverifier 未落盘 .loop/verifier-report.md，checker 产物缺失，自动流程无法证明安全。诊断见 .loop/fix-output.md。\n');
      const msg = '[fix] 需人工（ESCALATE_HUMAN）：verifier 未落盘裁决，见 .loop/fix-output.md';
      console.error(msg); cronLog(root, msg);
      return 2;
    }
    const report = readFileSync(reportPath, 'utf8');
    if (/^## Verdict: APPROVE$/m.test(report)) {
      cronLog(root, '[fix] verifier APPROVE — 可提议 PR（仍不自动合并）');
      cronLog(root, `[${tsNow()}] ${mode} 结束`);
      return 0;
    }
    const vm = report.match(/^## Verdict:\s*(.*)$/m);
    const verdict = vm ? vm[1].trim() : 'unknown';
    if (verdict === 'ESCALATE_HUMAN') {
      const msg = '[fix] 需人工（ESCALATE_HUMAN），见 .loop/verifier-report.md';
      console.error(msg); cronLog(root, msg);
      return 2;
    }
    const msg = `[fix] verifier 未通过（${verdict || 'unknown'}），见 .loop/verifier-report.md`;
    console.error(msg); cronLog(root, msg);
    return 1;
  }

  console.error(`未知模式: ${mode}（支持: triage | plan | fix）`);
  return 1;
}
