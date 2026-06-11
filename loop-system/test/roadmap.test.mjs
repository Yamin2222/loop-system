import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/loop.mjs');

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'loop-roadmap-test-'));
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

test('run roadmap does not reuse stale roadmap when coco fails', () => {
  const cwd = tempProject();
  const roadmap = join(cwd, '.loop', 'roadmap.md');
  writeFileSync(roadmap, '## Roadmap: stale\n\n### Milestones\n');
  const path = fakeCoco(cwd, 'exit 1');
  const result = runCli(cwd, ['run', 'roadmap', '新项目'], { PATH: path });

  assert.equal(result.status, 1);
  assert.equal(existsSync(roadmap), false);
});

test('run roadmap fails when coco succeeds without writing roadmap', () => {
  const cwd = tempProject();
  const path = fakeCoco(cwd, 'exit 0');
  const result = runCli(cwd, ['run', 'roadmap', '新项目'], { PATH: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /roadmap\.md/);
});

test('run roadmap fails when required headings are missing', () => {
  const cwd = tempProject();
  const path = fakeCoco(cwd, 'mkdir -p .loop\nprintf "## Roadmap: app\\n" > .loop/roadmap.md\nexit 0');
  const result = runCli(cwd, ['run', 'roadmap', '新项目'], { PATH: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Roadmap|Milestones|标题/);
});

test('run roadmap succeeds and only writes roadmap artifact', () => {
  const cwd = tempProject();
  const path = fakeCoco(cwd, 'mkdir -p .loop\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const result = runCli(cwd, ['run', 'roadmap', '新项目'], { PATH: path });

  assert.equal(result.status, 0);
  assert.match(readFileSync(join(cwd, '.loop', 'roadmap.md'), 'utf8'), /### Milestones/);
  assert.equal(existsSync(join(cwd, '.loop', 'plan.md')), false);
  assert.equal(existsSync(join(cwd, '.loop', 'verifier-report.md')), false);
});

