import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './paths.mjs';
import { verify } from './verify.mjs';
import { assertStageMatchesCurrentIfPresent } from './stage.mjs';

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

const DEFAULT_RETRY = { retries: 0, intervalSeconds: 30 };
const RETRYABLE_PATTERNS = [
  /queue|queued|排队/i,
  /capacity|busy|overloaded|容量|繁忙|过载/i,
  /timeout|timed out|ETIMEDOUT|超时/i,
  /rate limit|ratelimit|429|限流|请求过多/i,
  /503|502|504|unavailable|temporarily|暂不可用/i,
  /ECONNRESET|ECONNREFUSED|EAI_AGAIN|network|网络/i,
];
const RETRYABLE_ERROR_CODES = new Set(['EAGAIN', 'ETIMEDOUT', 'ECONNRESET']);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryableCocoFailure(result) {
  if (result.status === 0) return { retryable: false, reason: 'success' };
  if (result.error?.code === 'ENOENT') return { retryable: false, reason: 'coco-not-found' };
  if (result.error?.code && RETRYABLE_ERROR_CODES.has(result.error.code)) return { retryable: true, reason: result.error.code };
  const text = `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`;
  const matched = RETRYABLE_PATTERNS.find((re) => re.test(text));
  return matched ? { retryable: true, reason: matched.source } : { retryable: false, reason: 'not-retryable' };
}

// 运行 coco -p，返回 { status, stdout }
function runCoco(prompt, tools, { capture = false, retry = DEFAULT_RETRY, log = () => {} } = {}) {
  const args = ['-p', prompt, ...allowedToolArgs(tools)];
  const retryOptions = { ...DEFAULT_RETRY, ...(retry || {}) };
  const shouldCapture = capture || retryOptions.retries > 0;
  if (shouldCapture) {
    let combined = '';
    for (let attempt = 0; attempt <= retryOptions.retries; attempt++) {
      const r = spawnSync('coco', args, { encoding: 'utf8' });
      const result = {
        status: r.status ?? (r.error ? 127 : 1),
        stdout: r.stdout || '',
        stderr: r.stderr || '',
        error: r.error,
      };
      if (result.error) result.stderr += `[coco] 执行失败: ${result.error.message}\n`;
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      combined += result.stdout + result.stderr;
      if (result.status === 0) return { status: 0, stdout: combined };
      const decision = isRetryableCocoFailure(result);
      if (attempt >= retryOptions.retries || !decision.retryable) return { status: result.status, stdout: combined };
      const msg = `[coco] 可重试失败，等待 ${retryOptions.intervalSeconds}s 后第 ${attempt + 1}/${retryOptions.retries} 次重试（reason: ${decision.reason}）`;
      console.error(msg);
      log(msg);
      sleep(retryOptions.intervalSeconds * 1000);
    }
  }
  const r = spawnSync('coco', args, { stdio: 'inherit' });
  if (r.error) console.error(`[coco] 执行失败: ${r.error.message}`);
  return { status: r.status ?? (r.error ? 127 : 1), stdout: '' };
}

function parseRunArgs(args) {
  const mode = args[0] || 'triage';
  const retry = { ...DEFAULT_RETRY };
  const positionals = [];
  let council = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--council') {
      if (mode !== 'roadmap') return { error: '--council 仅支持 run roadmap', mode };
      council = true;
    } else if (a === '--retries') {
      const v = args[++i];
      if (!/^[0-9]+$/.test(String(v))) return { error: '--retries 必须是非负整数', mode };
      retry.retries = Number(v);
    } else if (a === '--retry-interval') {
      const v = args[++i];
      if (!/^[0-9]+$/.test(String(v)) || Number(v) < 1) return { error: '--retry-interval 必须是 >=1 的整数秒', mode };
      retry.intervalSeconds = Number(v);
    } else if (a.startsWith('--')) {
      return { error: `未知参数: ${a}`, mode };
    } else {
      positionals.push(a);
    }
  }

  return { mode, target: positionals.join(' '), council, retry };
}

const PROMPT_TRIAGE =
  '运行 loop-triage skill。先读 STATE.md 和 LOOP.md，把 High-Priority 和 Watch 项合并进 STATE.md，更新 Last run 时间戳为当前时间，并在 Activity Log 末尾追加一行记录。只汇报，不改任何源码。';

const promptPlan = (target) =>
  `读 LOOP.md 与 STATE.md。把以下目标委派给 @loop-planner 子代理，让它调研代码库并产出 plan.md（写到 .loop/plan.md）。只策划，不写实现代码。目标：${target}`;

const promptRoadmap = (target) =>
  `读 LOOP.md 与 STATE.md。把以下项目目标委派给 @loop-planner 子代理，产出项目级 roadmap，必须写到 .loop/roadmap.md。只做项目级拆分，不写实现代码，不写 .loop/plan.md，不写 .loop/verifier-report.md，不触发 execute/watch。

roadmap 必须使用以下结构：
## Roadmap: <项目一句话>

### Vision / Done Criteria
<整个项目完成的验收标准>

### Milestones

#### M1 — <垂直切片目标>
- Status: TODO
- Goal: <该里程碑要交付什么>
- Acceptance:
  - <可验收条件>
- Depends on: none
- Suggested next command: \`loop-system run plan "M1 — <垂直切片目标>"\`

### Risks / Architecture Decisions

### Open Questions

milestones 必须是可独立验收的垂直切片，可逐个交给 run plan 或 run fix。不确定项写入 Open Questions，不要中途提问或硬猜。项目目标：${target}`;

const promptRoadmapCouncil = (target) =>
  `读 LOOP.md 与 STATE.md。以 council 模式为以下项目目标生成项目级 roadmap。必须按顺序委派 @roadmap-drafter、@roadmap-challenger、@roadmap-arbiter，最多 2 轮；任何角色无法完成都不要假装成功，不要 fallback 到单 planner。

产物要求：
1. 必须写非空 .loop/council.md，记录 Draft、Challenge、Synthesis/Decisions，且包含首行或独立行：## Verdict: APPROVE | ESCALATE_HUMAN。
2. 必须写最终 .loop/roadmap.md。
3. 不写 .loop/plan.md，不写 .loop/verifier-report.md，不触发 execute/watch，不改源码。

.loop/council.md 至少包含：
### Round 1
### Draft
### Challenge
#### Keep
#### Modify
#### Drop
#### Missing
### Synthesis / Decisions

.loop/roadmap.md 必须使用以下结构：
## Roadmap: <项目一句话>

### Vision / Done Criteria
<整个项目完成的验收标准>

### Milestones

#### M1 — <垂直切片目标>
- Status: TODO
- Goal: <该里程碑要交付什么>
- Acceptance:
  - <可验收条件>
- Depends on: none
- Suggested next command: \`loop-system run plan "M1 — <垂直切片目标>"\`

### Risks / Architecture Decisions

### Open Questions

milestones 必须是可独立验收的垂直切片。若目标仍关键不清、缺少必要上下文或风险需人决策，在 .loop/council.md 写 ## Verdict: ESCALATE_HUMAN。项目目标：${target}`;

const promptFix = (target) =>
  `读 LOOP.md 与 STATE.md，按三角色编排处理以下目标：
1) 委派 @loop-planner 产出 .loop/plan.md（若 .loop/plan.md 已存在且匹配该目标，可复用）。
2) 委派 @loop-executor 严格照 plan.md 在隔离 worktree 中落地实现+测试。
3) 委派 @loop-verifier 独立校验。verifier 可在子代理环境写报告并返回摘要；主编排者必须把最终机器可解析裁决写入当前主工作区 .loop/verifier-report.md，首行必须是 ## Verdict: APPROVE | REQUEST_CHANGES | REJECT | ESCALATE_HUMAN。
verifier APPROVE 才提议 PR，绝不自动合并；REQUEST_CHANGES/REJECT 则回 executor 修一轮或升级人工。
命中拒绝清单或模糊项一律升级人工。把结果追加到 STATE.md 的 Activity Log。
目标：${target}`;

const promptExecute = (target) =>
  `读 LOOP.md、STATE.md 与 .loop/plan.md。把以下目标委派给 @loop-executor 子代理，让它严格照 .loop/plan.md 在隔离 worktree 中落地实现并运行必要验证。只执行 plan，不重新策划，不做无关重构。目标：${target}`;

const promptVerifyFix = (target) =>
  `读 LOOP.md、STATE.md、.loop/plan.md 和当前代码改动。把以下目标委派给 @loop-verifier 子代理独立校验。verifier 可在子代理环境写报告并返回摘要；主编排者必须把最终机器可解析裁决写入当前主工作区 .loop/verifier-report.md，首行必须是 ## Verdict: APPROVE | REQUEST_CHANGES | REJECT | ESCALATE_HUMAN。目标：${target}`;

function nonEmptyFile(p) {
  try { return statSync(p).size > 0; } catch { return false; }
}

function checkRoadmapArtifact(root, label = 'roadmap') {
  const roadmapPath = join(root, '.loop', 'roadmap.md');
  if (!nonEmptyFile(roadmapPath)) {
    console.error(`[${label}] FAIL: .loop/roadmap.md 未生成或为空`);
    cronLog(root, `[${label}] FAIL: .loop/roadmap.md 未生成或为空`);
    return { ok: false, roadmapPath };
  }
  const text = readFileSync(roadmapPath, 'utf8');
  if (!text.includes('## Roadmap:') || !text.includes('### Milestones')) {
    console.error(`[${label}] FAIL: .loop/roadmap.md 缺少必需标题（## Roadmap: / ### Milestones）`);
    cronLog(root, `[${label}] FAIL: .loop/roadmap.md 缺少必需标题`);
    return { ok: false, roadmapPath };
  }
  return { ok: true, roadmapPath, text };
}

function readVerifierResult(root) {
  const reportPath = join(root, '.loop', 'verifier-report.md');
  if (!nonEmptyFile(reportPath)) {
    writeFileSync(reportPath,
      '## Verdict: ESCALATE_HUMAN\n\nverifier 未落盘 .loop/verifier-report.md，checker 产物缺失，自动流程无法证明安全。\n');
    return { rc: 2, verdict: 'ESCALATE_HUMAN', message: '[verify-fix] 需人工（ESCALATE_HUMAN）：verifier 未落盘裁决' };
  }
  const report = readFileSync(reportPath, 'utf8');
  if (/^## Verdict: APPROVE$/m.test(report)) return { rc: 0, verdict: 'APPROVE' };
  const vm = report.match(/^## Verdict:\s*(.*)$/m);
  const verdict = vm ? vm[1].trim() : 'unknown';
  if (verdict === 'ESCALATE_HUMAN') return { rc: 2, verdict, message: '[verify-fix] 需人工（ESCALATE_HUMAN），见 .loop/verifier-report.md' };
  return { rc: 1, verdict, message: `[verify-fix] verifier 未通过（${verdict || 'unknown'}），见 .loop/verifier-report.md` };
}

function needGitHead(label) {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' });
  if (head.status !== 0) {
    const msg = `[${label}] 需人工：当前仓库没有有效 HEAD，worktree 子代理无法创建隔离环境；请先完成一次初始 commit 后重试`;
    console.error(msg);
    return { ok: false, msg };
  }
  return { ok: true, msg: '' };
}

export function runPlanOnce(root, target, ts = tsNow(), cocoOptions = {}) {
  cronLog(root, `[${ts}] L2 plan 开始: ${target}`);
  const planPath = join(root, '.loop', 'plan.md');
  rmSync(planPath, { force: true });
  const { status } = runCoco(promptPlan(target), READONLY_TOOLS, cocoOptions);
  if (status !== 0) {
    cronLog(root, `[plan] coco 执行失败 rc=${status}`);
    return { rc: 1, planPath };
  }
  if (!nonEmptyFile(planPath)) {
    console.error('[plan] FAIL: .loop/plan.md 未生成或为空');
    cronLog(root, '[plan] FAIL: .loop/plan.md 未生成或为空');
    return { rc: 1, planPath };
  }
  cronLog(root, `[plan] 方案见 .loop/plan.md，确认后可跑: loop-system run fix "${target}"`);
  return { rc: 0, planPath };
}

export function runRoadmapOnce(root, target, ts = tsNow(), cocoOptions = {}) {
  cronLog(root, `[${ts}] roadmap 开始: ${target}`);
  const roadmapPath = join(root, '.loop', 'roadmap.md');
  rmSync(roadmapPath, { force: true });
  const { status } = runCoco(promptRoadmap(target), READONLY_TOOLS, cocoOptions);
  if (status !== 0) {
    cronLog(root, `[roadmap] coco 执行失败 rc=${status}`);
    return { rc: 1, roadmapPath };
  }
  const check = checkRoadmapArtifact(root, 'roadmap');
  if (!check.ok) return { rc: 1, roadmapPath };
  cronLog(root, '[roadmap] 项目级路线图见 .loop/roadmap.md；人审后选择 milestone 运行 loop-system run plan/fix');
  return { rc: 0, roadmapPath };
}

export function runRoadmapCouncilOnce(root, target, ts = tsNow(), cocoOptions = {}) {
  cronLog(root, `[${ts}] roadmap council 开始: ${target}`);
  const councilPath = join(root, '.loop', 'council.md');
  const roadmapPath = join(root, '.loop', 'roadmap.md');
  rmSync(councilPath, { force: true });
  rmSync(roadmapPath, { force: true });
  const { status } = runCoco(promptRoadmapCouncil(target), READONLY_TOOLS, cocoOptions);
  if (status !== 0) {
    cronLog(root, `[roadmap:council] coco 执行失败 rc=${status}`);
    return { rc: 1, councilPath, roadmapPath };
  }
  if (!nonEmptyFile(councilPath)) {
    console.error('[roadmap:council] FAIL: .loop/council.md 未生成或为空');
    cronLog(root, '[roadmap:council] FAIL: .loop/council.md 未生成或为空');
    return { rc: 1, councilPath, roadmapPath };
  }
  const check = checkRoadmapArtifact(root, 'roadmap:council');
  if (!check.ok) return { rc: 1, councilPath, roadmapPath };
  const council = readFileSync(councilPath, 'utf8');
  if (/^## Verdict:\s*ESCALATE_HUMAN\s*$/m.test(council)) {
    const msg = '[roadmap:council] 需人工（ESCALATE_HUMAN），见 .loop/council.md';
    console.error(msg);
    cronLog(root, msg);
    return { rc: 2, councilPath, roadmapPath };
  }
  cronLog(root, '[roadmap:council] council 记录见 .loop/council.md；最终路线图见 .loop/roadmap.md');
  return { rc: 0, councilPath, roadmapPath };
}

export function runExecuteOnce(root, target, cocoOptions = {}) {
  const planPath = join(root, '.loop', 'plan.md');
  if (!nonEmptyFile(planPath)) {
    console.error('[execute] FAIL: .loop/plan.md 不存在或为空');
    return { rc: 1 };
  }
  const stageCheck = assertStageMatchesCurrentIfPresent(root, 'plan.ready');
  if (!stageCheck.ok) {
    console.error(`[execute] 需人工：stage taskId 串台或缺锚点（${stageCheck.reason}）`);
    return { rc: 2 };
  }
  if (!needGitHead('execute').ok) return { rc: 2 };
  const { status, stdout } = runCoco(promptExecute(target), FIX_TOOLS, { ...cocoOptions, capture: true });
  writeFileSync(join(root, '.loop', 'execute-output.md'), stdout);
  if (status !== 0) {
    cronLog(root, `[execute] coco 执行失败 rc=${status}`);
    return { rc: 1 };
  }
  cronLog(root, '[execute] 执行完成');
  return { rc: 0 };
}

export function runVerifyFixOnce(root, target, cocoOptions = {}) {
  const stageCheck = assertStageMatchesCurrentIfPresent(root, 'execute.ready');
  if (!stageCheck.ok) {
    console.error(`[verify-fix] 需人工：stage taskId 串台或缺锚点（${stageCheck.reason}）`);
    return { rc: 2, verdict: 'ESCALATE_HUMAN' };
  }
  if (!needGitHead('verify-fix').ok) return { rc: 2, verdict: 'ESCALATE_HUMAN' };
  const reportPath = join(root, '.loop', 'verifier-report.md');
  rmSync(reportPath, { force: true });
  const { status, stdout } = runCoco(promptVerifyFix(target), READONLY_TOOLS, { ...cocoOptions, capture: true });
  writeFileSync(join(root, '.loop', 'verify-output.md'), stdout);
  if (status !== 0) cronLog(root, `[verify-fix] coco 执行失败 rc=${status}，继续检查 .loop/verifier-report.md`);
  const result = readVerifierResult(root);
  if (result.message) console.error(result.message);
  return result;
}

// run triage|plan|fix [目标...]
export function run(args) {
  const root = projectRoot();
  mkdirSync(join(root, '.loop'), { recursive: true });
  const parsed = parseRunArgs(args);
  if (parsed.error) { console.error(parsed.error); return 2; }
  const { mode, target, council, retry } = parsed;
  const cocoOptions = { retry, log: (line) => cronLog(root, line) };
  const ts = tsNow();

  if (mode === 'triage') {
    cronLog(root, `[${ts}] L1 triage 开始`);
    runCoco(PROMPT_TRIAGE, READONLY_TOOLS, cocoOptions);
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
    const result = runPlanOnce(root, target, ts, cocoOptions);
    if (result.rc !== 0) return result.rc;
    cronLog(root, `[${tsNow()}] ${mode} 结束`);
    return 0;
  }

  if (mode === 'roadmap') {
    if (!target) { console.error('用法: loop-system run roadmap [--council] "<项目目标>"'); return 1; }
    const result = council ? runRoadmapCouncilOnce(root, target, ts, cocoOptions) : runRoadmapOnce(root, target, ts, cocoOptions);
    if (result.rc !== 0) return result.rc;
    cronLog(root, `[${tsNow()}] ${mode} 结束`);
    return 0;
  }

  if (mode === 'execute') {
    if (!target) { console.error('用法: loop-system run execute "<目标描述>"'); return 1; }
    const result = runExecuteOnce(root, target, cocoOptions);
    return result.rc;
  }

  if (mode === 'verify-fix') {
    if (!target) { console.error('用法: loop-system run verify-fix "<目标描述>"'); return 1; }
    const result = runVerifyFixOnce(root, target, cocoOptions);
    return result.rc;
  }

  if (mode === 'fix') {
    if (!target) { console.error('用法: loop-system run fix "<目标描述>"'); return 1; }
    const headCheck = needGitHead('fix');
    if (!headCheck.ok) { cronLog(root, headCheck.msg); return 2; }
    cronLog(root, `[${ts}] L2 fix(三角色) 开始: ${target}`);
    rmSync(join(root, '.loop', 'verifier-report.md'), { force: true });
    rmSync(join(root, '.loop', 'fix-output.md'), { force: true });
    const { status, stdout } = runCoco(promptFix(target), FIX_TOOLS, { ...cocoOptions, capture: true });
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

  console.error(`未知模式: ${mode}（支持: triage | roadmap | plan | execute | verify-fix | fix）`);
  return 1;
}
