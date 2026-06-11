import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './paths.mjs';
import { runExecuteOnce, runPlanOnce, runVerifyFixOnce } from './run.mjs';
import {
  acquireLock,
  clearStageForNewTask,
  newTask,
  readCurrent,
  releaseLock,
  stageMatchesCurrent,
  writeCurrent,
  writeStage,
} from './stage.mjs';

const DEFAULT_INTERVAL_SECONDS = 2;

export function watch(args) {
  const root = projectRoot();
  mkdirSync(join(root, '.loop', 'stage'), { recursive: true });

  const role = args[0];
  const parsed = parseArgs(args.slice(1));
  if (!role || parsed.help) { usage(); return parsed.help ? 0 : 2; }
  if (parsed.error) { console.error(parsed.error); usage(); return 2; }

  if (role === 'plan') return watchPlan(root, parsed);
  if (role === 'execute') return watchDownstream(root, 'execute', 'plan.ready', 'execute.ready', parsed);
  if (role === 'verify') return watchDownstream(root, 'verify', 'execute.ready', 'verify.done', parsed);

  console.error(`未知 watch 角色: ${role}`);
  usage();
  return 2;
}

function watchPlan(root, parsed) {
  const target = parsed.positionals.join(' ');
  if (!target) { console.error('用法: loop-system watch plan "<目标>" --once'); return 2; }
  if (!parsed.once) {
    console.error('[watch plan] MVP 阶段仅支持 --once；持续任务队列见后续版本');
    return 2;
  }

  const task = newTask(target, parsed.taskId);
  clearStageForNewTask(root);
  writeCurrent(root, task);

  const result = runPlanOnce(root, target);
  if (result.rc !== 0) return result.rc;
  writeStage(root, 'plan.ready', task, { artifact: '.loop/plan.md' });
  return 0;
}

function watchDownstream(root, role, upstreamStage, outputStage, parsed) {
  if (parsed.positionals.length > 0) { usage(); return 2; }
  const lock = acquireLock(root, role);
  if (!lock.ok) { console.error(lock.message); return 2; }

  try {
    const ready = waitForStage(root, upstreamStage, parsed);
    if (!ready.ok) {
      console.error(`[watch ${role}] 超时：未等到匹配 current.json 的 ${upstreamStage}`);
      return 2;
    }

    const current = readCurrent(root);
    const target = current?.target || ready.stage?.target || '';
    const result = role === 'execute' ? runExecuteOnce(root, target) : runVerifyFixOnce(root, target);
    if (result.rc === 0 || role === 'verify') {
      writeStage(root, outputStage, current, {
        artifact: role === 'execute' ? '.loop/execute-output.md' : '.loop/verifier-report.md',
        ...(result.verdict ? { verdict: result.verdict } : {}),
      });
    }
    return result.rc;
  } finally {
    releaseLock(lock);
  }
}

function waitForStage(root, name, parsed) {
  const intervalMs = parsed.intervalSeconds * 1000;
  const timeoutMs = parsed.timeoutMinutes === undefined ? undefined : parsed.timeoutMinutes * 60 * 1000;
  const started = Date.now();

  while (true) {
    const match = stageMatchesCurrent(root, name);
    if (match.ok) return match;
    if (timeoutMs !== undefined && Date.now() - started >= timeoutMs) return { ok: false, reason: 'timeout' };
    sleep(Math.max(intervalMs, 1));
  }
}

function parseArgs(args) {
  const out = { once: false, intervalSeconds: DEFAULT_INTERVAL_SECONDS, positionals: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--once') out.once = true;
    else if (a === '--task-id') {
      if (!args[i + 1]) return { error: '--task-id 需要参数', positionals: [] };
      out.taskId = args[++i];
    } else if (a === '--interval') {
      const v = args[++i];
      if (!/^[0-9]+$/.test(String(v)) || Number(v) < 1) return { error: '--interval 必须是 >=1 的整数秒', positionals: [] };
      out.intervalSeconds = Number(v);
    } else if (a === '--timeout') {
      const v = args[++i];
      if (!/^[0-9]+$/.test(String(v))) return { error: '--timeout 必须是非负整数分钟', positionals: [] };
      out.timeoutMinutes = Number(v);
    } else if (a.startsWith('--')) {
      return { error: `未知参数: ${a}`, positionals: [] };
    } else {
      out.positionals.push(a);
    }
  }
  return out;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function usage() {
  console.error(`用法:
  loop-system watch plan "<目标>" --once [--task-id ID] [--interval 秒] [--timeout 分钟]
  loop-system watch execute [--once] [--interval 秒] [--timeout 分钟]
  loop-system watch verify [--once] [--interval 秒] [--timeout 分钟]`);
}

