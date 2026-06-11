import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/loop.mjs');

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'loop-council-test-'));
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

test('run roadmap --council does not reuse stale artifacts when coco fails', () => {
  const cwd = tempProject();
  const council = join(cwd, '.loop', 'council.md');
  const roadmap = join(cwd, '.loop', 'roadmap.md');
  writeFileSync(council, 'stale council');
  writeFileSync(roadmap, '## Roadmap: stale\n\n### Milestones\n');
  const path = fakeCoco(cwd, 'exit 1');
  const result = runCli(cwd, ['run', 'roadmap', '--council', '新项目'], { PATH: path });

  assert.equal(result.status, 1);
  assert.equal(existsSync(council), false);
  assert.equal(existsSync(roadmap), false);
});

test('run roadmap --council fails when council audit trail is missing', () => {
  const cwd = tempProject();
  const path = fakeCoco(cwd, 'mkdir -p .loop\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const result = runCli(cwd, ['run', 'roadmap', '新项目', '--council'], { PATH: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /council\.md/);
});

test('run roadmap --council fails when roadmap is missing or lacks required headings', () => {
  const missingCwd = tempProject();
  const missingPath = fakeCoco(missingCwd, 'mkdir -p .loop\nprintf "## Verdict: APPROVE\\n" > .loop/council.md\nexit 0');
  const missing = runCli(missingCwd, ['run', 'roadmap', '--council', '新项目'], { PATH: missingPath });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /roadmap\.md/);

  const badCwd = tempProject();
  const badPath = fakeCoco(badCwd, 'mkdir -p .loop\nprintf "## Verdict: APPROVE\\n" > .loop/council.md\nprintf "## Roadmap: app\\n" > .loop/roadmap.md\nexit 0');
  const bad = runCli(badCwd, ['run', 'roadmap', '--council', '新项目'], { PATH: badPath });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Roadmap|Milestones|标题/);
});

test('run roadmap --council returns 2 when council escalates to human', () => {
  const cwd = tempProject();
  const path = fakeCoco(cwd, 'mkdir -p .loop\nprintf "## Verdict: ESCALATE_HUMAN\\n" > .loop/council.md\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const result = runCli(cwd, ['run', 'roadmap', '--council', '新项目'], { PATH: path });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /ESCALATE_HUMAN|需人工/);
});

test('run roadmap --council succeeds and only writes council artifacts', () => {
  const cwd = tempProject();
  const path = fakeCoco(cwd, 'mkdir -p .loop\nprintf "## Verdict: APPROVE\\n\\n### Round 1\\n" > .loop/council.md\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const result = runCli(cwd, ['run', 'roadmap', '--council', '新项目'], { PATH: path });

  assert.equal(result.status, 0);
  assert.match(readFileSync(join(cwd, '.loop', 'council.md'), 'utf8'), /APPROVE/);
  assert.match(readFileSync(join(cwd, '.loop', 'roadmap.md'), 'utf8'), /### Milestones/);
  assert.equal(existsSync(join(cwd, '.loop', 'plan.md')), false);
  assert.equal(existsSync(join(cwd, '.loop', 'verifier-report.md')), false);
  assert.equal(existsSync(join(cwd, '.loop', 'stage')), false);
});

test('run roadmap --council supports flag before or after target without leaking flag into prompt', () => {
  const beforeCwd = tempProject();
  const body = 'case "$2" in *--council*) exit 42;; esac\nmkdir -p .loop\nprintf "## Verdict: APPROVE\\n" > .loop/council.md\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0';
  const beforePath = fakeCoco(beforeCwd, body);
  const before = runCli(beforeCwd, ['run', 'roadmap', '--council', '新项目'], { PATH: beforePath });
  assert.equal(before.status, 0);

  const afterCwd = tempProject();
  const afterPath = fakeCoco(afterCwd, body);
  const after = runCli(afterCwd, ['run', 'roadmap', '新项目', '--council'], { PATH: afterPath });
  assert.equal(after.status, 0);
  assert.equal(readdirSync(join(afterCwd, '.loop')).includes('stage'), false);
});
