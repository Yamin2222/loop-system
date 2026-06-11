import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STAGES = ['plan.ready', 'execute.ready', 'verify.done'];

export function stageDir(root) {
  return join(root, '.loop', 'stage');
}

export function targetHash(target) {
  return createHash('sha256').update(target).digest('hex');
}

export function newTask(target, taskId) {
  const hash = targetHash(target);
  return {
    taskId: taskId || `${compactIsoNow()}-${hash.slice(0, 8)}`,
    target,
    targetHash: hash,
    createdAt: new Date().toISOString(),
  };
}

export function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function currentPath(root) {
  return join(stageDir(root), 'current.json');
}

export function stagePath(root, name) {
  return join(stageDir(root), `${name}.json`);
}

export function writeCurrent(root, task) {
  writeJsonAtomic(currentPath(root), task);
}

export function readCurrent(root) {
  return readJson(currentPath(root));
}

export function clearStageForNewTask(root) {
  mkdirSync(stageDir(root), { recursive: true });
  for (const name of STAGES) rmSync(stagePath(root, name), { force: true });
}

export function writeStage(root, name, task, extra = {}) {
  writeJsonAtomic(stagePath(root, name), {
    taskId: task.taskId,
    target: task.target,
    targetHash: task.targetHash,
    stage: name,
    artifact: extra.artifact,
    createdAt: new Date().toISOString(),
    ...extra,
  });
}

export function readStage(root, name) {
  return readJson(stagePath(root, name));
}

export function stageMatchesCurrent(root, name) {
  const current = readCurrent(root);
  const stage = readStage(root, name);
  if (!current || !stage) return { ok: false, current, stage, reason: 'missing' };
  if (current.taskId !== stage.taskId) return { ok: false, current, stage, reason: 'taskId-mismatch' };
  return { ok: true, current, stage };
}

export function assertStageMatchesCurrentIfPresent(root, name) {
  const current = readCurrent(root);
  const stage = readStage(root, name);
  if (!current && !stage) return { ok: true };
  if (!current || !stage) return { ok: false, reason: 'missing-stage-anchor' };
  if (current.taskId !== stage.taskId) return { ok: false, reason: 'taskId-mismatch' };
  return { ok: true, current, stage };
}

export function acquireLock(root, role) {
  mkdirSync(stageDir(root), { recursive: true });
  const path = join(stageDir(root), `${role}.lock`);
  if (existsSync(path)) {
    const lock = readJson(path);
    if (lock?.pid && pidAlive(lock.pid)) {
      return { ok: false, path, message: `[watch] ${role} 已有运行中的 lock: pid=${lock.pid}` };
    }
    return { ok: false, path, message: `[watch] ${role} lock 可能残留: ${path}；请人工确认后删除` };
  }
  const lock = { role, pid: process.pid, startedAt: new Date().toISOString() };
  writeJsonAtomic(path, lock);
  return { ok: true, path, lock };
}

export function releaseLock(lock) {
  if (!lock?.path) return;
  const existing = readJson(lock.path);
  if (existing?.pid === process.pid) rmSync(lock.path, { force: true });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function compactIsoNow() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
