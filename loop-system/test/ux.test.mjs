import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/loop.mjs');

function tempProject(name = 'loop-ux-test-') {
  const dir = mkdtempSync(join(tmpdir(), name));
  mkdirSync(join(dir, '.loop'), { recursive: true });
  return dir;
}

function runCli(cwd, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
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

test('no args prints friendly entry help with rc 0', () => {
  const cwd = tempProject();
  const result = runCli(cwd, []);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /coco 内使用|\/loop 修复|\/loop status/);
  assert.doesNotMatch(result.stdout, /loop-system run fix/);
  assert.doesNotMatch(result.stdout, /loop-system run roadmap/);
});

test('status works without loop artifacts', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'loop-ux-status-empty-'));
  const result = runCli(cwd, ['status']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /暂无|下一步|\/loop/);
  assert.doesNotMatch(result.stdout, /loop-system "修复/);
});

test('status shows current task stage artifacts and recent logs', () => {
  const cwd = tempProject();
  mkdirSync(join(cwd, '.loop', 'stage'), { recursive: true });
  writeFileSync(join(cwd, '.loop', 'stage', 'current.json'), JSON.stringify({ taskId: 'task-a', target: '修复登录' }, null, 2));
  writeFileSync(join(cwd, '.loop', 'stage', 'plan.ready.json'), JSON.stringify({ taskId: 'task-a', target: '修复登录', stage: 'plan.ready' }, null, 2));
  writeFileSync(join(cwd, '.loop', 'plan.md'), '## Plan: 修复登录\n');
  writeFileSync(join(cwd, '.loop', 'cron.log'), '[now] plan ready\n');

  const result = runCli(cwd, ['status']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /task-a/);
  assert.match(result.stdout, /修复登录/);
  assert.match(result.stdout, /plan\.ready|plan/);
  assert.match(result.stdout, /plan\.md/);
  assert.match(result.stdout, /plan ready/);
});

test('run roadmap success prints a unified summary card', () => {
  const cwd = tempProject();
  const path = fakeCoco(cwd, 'mkdir -p .loop\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const result = runCli(cwd, ['run', 'roadmap', '新项目'], { PATH: path });
  const output = result.stdout + result.stderr;

  assert.equal(result.status, 0);
  assert.match(output, /Loop 结果/);
  assert.match(output, /roadmap/);
  assert.match(output, /\.loop\/roadmap\.md/);
  assert.match(output, /下一步/);
});

test('run verify-fix summary reads verifier-report verdict line', () => {
  const cwd = tempProject();
  initGit(cwd);
  const path = fakeCoco(cwd, 'exit 0');
  const result = runCli(cwd, ['run', 'verify-fix', '目标'], { PATH: path });
  const output = result.stdout + result.stderr;

  assert.equal(result.status, 2);
  assert.match(output, /Loop 结果/);
  assert.match(output, /ESCALATE_HUMAN/);
  assert.match(output, /\.loop\/verifier-report\.md/);
});

test('top-level natural language routes fix with explanation', () => {
  const cwd = tempProject();
  initGit(cwd);
  const path = fakeCoco(cwd, 'mkdir -p .loop\nprintf "## Verdict: APPROVE\\n" > .loop/verifier-report.md\nexit 0');
  const result = runCli(cwd, ['修复 login 空指针'], { PATH: path });
  const output = result.stdout + result.stderr;

  assert.equal(result.status, 0);
  assert.match(output, /Loop 判断/);
  assert.match(output, /fix/);
  assert.match(output, /将执行: \/loop fix/);
});

test('top-level natural language routes roadmap and council roadmap', () => {
  const roadmapCwd = tempProject();
  const roadmapPath = fakeCoco(roadmapCwd, 'mkdir -p .loop\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const roadmap = runCli(roadmapCwd, ['从 0 构建待办 Web 应用'], { PATH: roadmapPath });
  assert.equal(roadmap.status, 0);
  assert.match(roadmap.stdout + roadmap.stderr, /Loop 判断[\s\S]*roadmap/);

  const councilCwd = tempProject();
  const councilPath = fakeCoco(councilCwd, 'mkdir -p .loop\nprintf "## Verdict: APPROVE\\n" > .loop/council.md\nprintf "## Roadmap: app\\n\\n### Milestones\\n" > .loop/roadmap.md\nexit 0');
  const council = runCli(councilCwd, ['用 council 规划从 0 构建待办 Web 应用'], { PATH: councilPath });
  assert.equal(council.status, 0);
  assert.match(council.stdout + council.stderr, /Loop 判断[\s\S]*council|--council/);
});

test('single unknown english token is treated as possible typo not natural language', () => {
  const cwd = tempProject();
  const marker = join(cwd, 'called');
  const path = fakeCoco(cwd, `touch "${marker}"\nexit 0`);
  const result = runCli(cwd, ['fixx'], { PATH: path });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /未知命令|是否想|引号/);
  assert.equal(existsSync(marker), false);
});

test('low confidence natural language does not execute and suggests next commands', () => {
  const cwd = tempProject();
  const marker = join(cwd, 'called');
  const path = fakeCoco(cwd, `touch "${marker}"\nexit 0`);
  const result = runCli(cwd, ['帮我看看'], { PATH: path });
  const output = result.stdout + result.stderr;

  assert.equal(result.status, 2);
  assert.match(output, /建议|\/loop plan|\/loop fix|\/loop roadmap|\/loop status/);
  assert.equal(existsSync(marker), false);
});

test('root README presents /loop as daily UX without loop-system run examples', () => {
  const readme = readFileSync(resolve('..', 'README.md'), 'utf8');

  assert.match(readme, /日常交互入口是在 coco 里输入 `\/loop \.\.\.`/);
  assert.match(readme, /\/loop fix 修复 login 空指针/);
  assert.doesNotMatch(readme, /loop-system run (fix|plan|roadmap|triage|execute|verify-fix)/);
});

test('package README presents /loop as daily UX without loop-system run examples', () => {
  const readme = readFileSync(resolve('README.md'), 'utf8');

  assert.match(readme, /初始化后在 coco 里用 `\/loop`/);
  assert.match(readme, /\/loop fix 修复 login 空指针/);
  assert.doesNotMatch(readme, /loop-system run (fix|plan|roadmap|triage|execute|verify-fix)/);
});

test('init installs coco /loop command for in-cli usage', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'loop-ux-init-coco-'));
  const result = runCli(cwd, ['init', cwd]);
  const commandPath = join(cwd, '.trae', 'commands', 'loop.md');

  assert.equal(result.status, 0);
  assert.equal(existsSync(commandPath), true);
  const command = readFileSync(commandPath, 'utf8');
  assert.match(command, /description: loop 编排入口。在 coco 内使用/);
  assert.match(command, /用户输入：\$ARGUMENTS/);
  assert.match(command, /@loop-planner/);
  assert.match(command, /@loop-verifier/);
  assert.doesNotMatch(command, /npx @yaminzhou02\/loop-system/);
});
