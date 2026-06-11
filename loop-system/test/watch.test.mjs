import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/loop.mjs');

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'loop-watch-test-'));
  mkdirSync(join(dir, '.loop', 'stage'), { recursive: true });
  return dir;
}

function runCli(cwd, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function fakeCoco(dir, body) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, 'coco');
  writeFileSync(exe, `#!/bin/sh\n${body}\n`);
  chmodSync(exe, 0o755);
  return `${bin}:${process.env.PATH}`;
}

function initGit(cwd) {
  spawnSync('git', ['init'], { cwd, stdio: 'ignore' });
  writeFileSync(join(cwd, 'README.md'), 'test\n');
  spawnSync('git', ['add', 'README.md'], { cwd, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'], { cwd, stdio: 'ignore' });
}

test('watch plan requires --once in MVP', () => {
  const cwd = tempProject();
  const result = runCli(cwd, ['watch', 'plan', '目标']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /watch plan.*--once/);
});

test('watch execute times out with rc 2 when plan.ready is absent', () => {
  const cwd = tempProject();
  const result = runCli(cwd, ['watch', 'execute', '--once', '--timeout', '0']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /timeout|超时/);
});

test('run execute fails before coco when plan is missing', () => {
  const cwd = tempProject();
  const marker = join(cwd, 'called');
  const path = fakeCoco(cwd, `touch "${marker}"\nexit 0`);
  const result = runCli(cwd, ['run', 'execute', '目标'], { PATH: path });

  assert.equal(result.status, 1);
  assert.equal(existsSync(marker), false);
  assert.match(result.stderr, /plan\.md/);
});

test('run execute rejects mismatched stage taskId without calling coco', () => {
  const cwd = tempProject();
  writeFileSync(join(cwd, '.loop', 'plan.md'), 'plan');
  writeJson(join(cwd, '.loop', 'stage', 'current.json'), { taskId: 'task-a', target: 'A', targetHash: 'aaa' });
  writeJson(join(cwd, '.loop', 'stage', 'plan.ready.json'), { taskId: 'task-b', target: 'B', targetHash: 'bbb', stage: 'plan.ready' });
  const marker = join(cwd, 'called');
  const path = fakeCoco(cwd, `touch "${marker}"\nexit 0`);
  const result = runCli(cwd, ['run', 'execute', '目标'], { PATH: path });

  assert.equal(result.status, 2);
  assert.equal(existsSync(marker), false);
  assert.match(result.stderr, /taskId|串台/);
});

test('run verify-fix escalates when verifier report is missing', () => {
  const cwd = tempProject();
  initGit(cwd);
  const path = fakeCoco(cwd, 'exit 0');
  const result = runCli(cwd, ['run', 'verify-fix', '目标'], { PATH: path });

  assert.equal(result.status, 2);
  const report = readFileSync(join(cwd, '.loop', 'verifier-report.md'), 'utf8');
  assert.match(report, /^## Verdict: ESCALATE_HUMAN/m);
});
