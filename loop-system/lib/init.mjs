import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { templatesDir } from './paths.mjs';
import { generateInto } from './sync.mjs';

// init [目标目录, 默认 cwd]
export function init(args) {
  const dest = resolve(args[0] || process.cwd());
  mkdirSync(dest, { recursive: true });
  console.log(`== 初始化 loop 系统到 ${dest} ==`);

  // 1. 拷贝 .agents 真源（已存在则跳过，不覆盖）
  const agentsDst = join(dest, '.agents');
  if (existsSync(agentsDst)) {
    console.log('  [skip] .agents 已存在，未覆盖');
    backfillMissingSkills(agentsDst);
  } else {
    cpSync(join(templatesDir, '.agents'), agentsDst, { recursive: true });
    console.log('  [ok] .agents/（skill 真源）');
  }

  // 2. LOOP.md
  copyIfAbsent(join(templatesDir, 'LOOP.md'), join(dest, 'LOOP.md'), 'LOOP.md');

  // 3. STATE.md（替换项目名占位）
  const statePath = join(dest, 'STATE.md');
  if (existsSync(statePath)) {
    console.log('  [skip] STATE.md 已存在，未覆盖');
  } else {
    const tpl = readFileSync(join(templatesDir, 'STATE.md'), 'utf8')
      .replace('{{PROJECT_NAME}}', basename(dest));
    writeFileSync(statePath, tpl);
    console.log('  [ok] STATE.md');
  }

  // 4. 生成三套工具配置
  console.log('== 生成多工具配置 ==');
  generateInto(dest, dest, { verbose: true });

  // 5. 提示 .gitignore 合并规则
  const snippet = readFileSync(join(templatesDir, 'gitignore.snippet'), 'utf8').trim();
  console.log('\n== 请把以下规则合并进你项目的 .gitignore（不会自动覆盖）==');
  console.log(snippet);

  console.log('\n== 完成。下一步 ==');
  console.log('  1. 编辑 STATE.md 第一行项目名（如需要）');
  console.log('  2. 打开 coco，在项目中输入：/loop status 或 /loop triage');
  console.log('  3. CI/cron/调试时可运行：loop-system check');
  return 0;
}

function copyIfAbsent(src, dst, label) {
  if (existsSync(dst)) { console.log(`  [skip] ${label} 已存在，未覆盖`); return; }
  copyFileSync(src, dst);
  console.log(`  [ok] ${label}`);
}

function backfillMissingSkills(agentsDst) {
  const templateSkills = join(templatesDir, '.agents', 'skills');
  const dstSkills = join(agentsDst, 'skills');
  mkdirSync(dstSkills, { recursive: true });
  for (const entry of readdirSync(templateSkills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = join(templateSkills, entry.name);
    const dst = join(dstSkills, entry.name);
    if (existsSync(dst)) continue;
    cpSync(src, dst, { recursive: true });
    console.log(`  [ok] .agents/skills/${entry.name}（补齐缺失 skill）`);
  }
}
