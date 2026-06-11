import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './paths.mjs';

export function status(args = []) {
  if (args.length > 0 && !args.includes('-h') && !args.includes('--help')) {
    console.error('用法: loop-system status');
    return 2;
  }
  console.log(renderStatus(projectRoot()));
  return 0;
}

export function renderStatus(root) {
  const loop = join(root, '.loop');
  if (!existsSync(loop)) {
    return `== Loop Status ==\n暂无 .loop/ 运行产物。\n下一步：可运行 loop-system "修复 xxx"、loop-system "从 0 构建 xxx"，或先执行 loop-system init。`;
  }

  const current = readJson(join(loop, 'stage', 'current.json'));
  const stages = [
    ['plan', readJson(join(loop, 'stage', 'plan.ready.json'))],
    ['execute', readJson(join(loop, 'stage', 'execute.ready.json'))],
    ['verify', readJson(join(loop, 'stage', 'verify.done.json'))],
  ];
  const currentLine = current?.taskId ? `${current.taskId} "${current.target || ''}"` : '—';
  const stageLine = stages.map(([name, value]) => `${name} ${stageMark(current, value)}`).join(' → ');
  const artifactLine = [
    artifact(loop, 'roadmap.md'),
    artifact(loop, 'council.md'),
    artifact(loop, 'plan.md'),
    artifact(loop, 'execute-output.md'),
    artifact(loop, 'verifier-report.md', readVerdict(join(loop, 'verifier-report.md'))),
    artifact(loop, 'fix-output.md'),
  ].join(' | ');
  const logs = tailLines(join(loop, 'cron.log'), 6);

  return `== Loop Status ==\n当前任务: ${currentLine}\n阶段: ${stageLine}\n产物: ${artifactLine}\n最近日志:\n${logs.length ? logs.map((l) => `  ${l}`).join('\n') : '  —'}`;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function stageMark(current, stage) {
  if (!stage) return '—';
  if (current?.taskId && stage.taskId && current.taskId !== stage.taskId) return '旧/不匹配';
  return '✅';
}

function artifact(loop, name, suffix = '') {
  const p = join(loop, name);
  if (!existsSync(p)) return `${name} —`;
  const mtime = statSync(p).mtime.toISOString().slice(0, 19);
  return `${name} ✅${suffix ? ` ${suffix}` : ''} (${mtime})`;
}

function readVerdict(path) {
  try {
    const text = readFileSync(path, 'utf8');
    const m = text.match(/^## Verdict:\s*(.*)$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

function tailLines(path, n) {
  try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).slice(-n); } catch { return []; }
}
