import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/loop.mjs');

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'loop-retry-test-'));
  mkdirSync(join(dir, '.loop'), { recursive: true });
  return dir;
}

function fakeCoco(dir, body) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, 'coco');
  writeFileSync(exe, `#!/bin/sh\n${body}\n`);
  chmodSync(exe, 0o755);
  return `${bin}:${process.env.PATH}`;
}

function runCli(cwd, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function initGit(cwd) {
  spawnSync('git', ['init'], { cwd, stdio: 'ignore' });
  writeFileSync(join(cwd, 'README.md'), 'test\n');
  spawnSync('git', ['add', 'README.md'], { cwd, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'], { cwd, stdio: 'ignore' });
}

function countScript(counter, body) {
  return `count=0\nif [ -f "${counter}" ]; then count=$(cat "${counter}"); fi\ncount=$((count + 1))\nprintf "%s" "$count" > "${counter}"\n${body}`;
}

test('run does not retry by default even for retryable coco output', () => {
  const cwd = tempProject();
  const counter = join(cwd, 'count');
  const path = fakeCoco(cwd, countScript(counter, 'printf "queue timeout\\n" >&2\nexit 1'));
  const result = runCli(cwd, ['run', 'roadmap', '项目'], { PATH: path });

  assert.equal(result.status, 1);
  assert.equal(readFileSync(counter, 'utf8'), '1');
});

test('run retries retryable coco failure until a later attempt succeeds', () => {
  const cwd = tempProject();
  const counter = join(cwd, 'count');
  const path = fakeCoco(cwd, countScript(counter, 'if [ "$count" -lt 3 ]; then printf "queue timeout\\n" >&2; exit 1; fi\nmkdir -p .loop\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0'));
  const result = runCli(cwd, ['run', 'roadmap', '项目', '--retries', '2', '--retry-interval', '1'], { PATH: path });

  assert.equal(result.status, 0);
  assert.equal(readFileSync(counter, 'utf8'), '3');
  assert.match(readFileSync(join(cwd, '.loop', 'roadmap.md'), 'utf8'), /### Milestones/);
  assert.match(result.stderr, /重试|retry|queue/);
});

test('run does not retry non-retryable coco failure', () => {
  const cwd = tempProject();
  const counter = join(cwd, 'count');
  const path = fakeCoco(cwd, countScript(counter, 'printf "syntax error\\n" >&2\nexit 1'));
  const result = runCli(cwd, ['run', 'roadmap', '项目', '--retries', '3', '--retry-interval', '1'], { PATH: path });

  assert.equal(result.status, 1);
  assert.equal(readFileSync(counter, 'utf8'), '1');
});

test('run stops after retries are exhausted and logs retry attempts', () => {
  const cwd = tempProject();
  const counter = join(cwd, 'count');
  const path = fakeCoco(cwd, countScript(counter, 'printf "rate limit 429\\n" >&2\nexit 1'));
  const result = runCli(cwd, ['run', 'roadmap', '项目', '--retries', '2', '--retry-interval', '1'], { PATH: path });

  assert.equal(result.status, 1);
  assert.equal(readFileSync(counter, 'utf8'), '3');
  assert.match(readFileSync(join(cwd, '.loop', 'cron.log'), 'utf8'), /重试|retry|rate limit|429/);
});

test('run execute capture output keeps all retry attempts for diagnostics', () => {
  const cwd = tempProject();
  initGit(cwd);
  writeFileSync(join(cwd, '.loop', 'plan.md'), 'plan');
  const counter = join(cwd, 'count');
  const path = fakeCoco(cwd, countScript(counter, 'if [ "$count" -lt 2 ]; then printf "queue timeout attempt $count\\n" >&2; exit 1; fi\nprintf "executor ok attempt $count\\n"\nexit 0'));
  const result = runCli(cwd, ['run', 'execute', '目标', '--retries', '1', '--retry-interval', '1'], { PATH: path });

  assert.equal(result.status, 0);
  const output = readFileSync(join(cwd, '.loop', 'execute-output.md'), 'utf8');
  assert.match(output, /queue timeout attempt 1/);
  assert.match(output, /executor ok attempt 2/);
});

test('run retry arguments work before and after target and with council', () => {
  const beforeCwd = tempProject();
  const beforeCounter = join(beforeCwd, 'count');
  const beforePath = fakeCoco(beforeCwd, countScript(beforeCounter, 'mkdir -p .loop\nprintf "## Plan: ok\\n" > .loop/plan.md\nexit 0'));
  const before = runCli(beforeCwd, ['run', 'plan', '--retries', '0', '--retry-interval', '1', '目标'], { PATH: beforePath });
  assert.equal(before.status, 0);
  assert.equal(readFileSync(beforeCounter, 'utf8'), '1');

  const afterCwd = tempProject();
  const afterCounter = join(afterCwd, 'count');
  const afterPath = fakeCoco(afterCwd, countScript(afterCounter, 'mkdir -p .loop\nprintf "## Plan: ok\\n" > .loop/plan.md\nexit 0'));
  const after = runCli(afterCwd, ['run', 'plan', '目标', '--retries', '0', '--retry-interval', '1'], { PATH: afterPath });
  assert.equal(after.status, 0);
  assert.equal(readFileSync(afterCounter, 'utf8'), '1');

  const councilCwd = tempProject();
  const councilPath = fakeCoco(councilCwd, 'case "$2" in *--retries*|*--retry-interval*) exit 42;; esac\nmkdir -p .loop\nprintf "## Verdict: APPROVE\\n" > .loop/council.md\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const council = runCli(councilCwd, ['run', 'roadmap', '--council', '项目', '--retries', '0', '--retry-interval', '1'], { PATH: councilPath });
  assert.equal(council.status, 0);
});

test('run retry arguments reject invalid values before calling coco', () => {
  const cwd = tempProject();
  const marker = join(cwd, 'called');
  const path = fakeCoco(cwd, `touch "${marker}"\nexit 0`);

  const badRetries = runCli(cwd, ['run', 'plan', '目标', '--retries', 'nope'], { PATH: path });
  assert.equal(badRetries.status, 2);
  assert.match(badRetries.stderr, /retries|非负整数/);

  const badIntervalZero = runCli(cwd, ['run', 'plan', '目标', '--retry-interval', '0'], { PATH: path });
  assert.equal(badIntervalZero.status, 2);
  assert.match(badIntervalZero.stderr, /retry-interval|整数秒/);

  const badIntervalText = runCli(cwd, ['run', 'plan', '目标', '--retry-interval', 'nope'], { PATH: path });
  assert.equal(badIntervalText.status, 2);
  assert.match(badIntervalText.stderr, /retry-interval|整数秒/);

  assert.equal(existsSync(marker), false);
});
