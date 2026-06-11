import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const repoRoot = dirname(packageRoot);

export function checkTemplates({ root = repoRoot, pkg = packageRoot } = {}) {
  const rootSkills = join(root, '.agents', 'skills');
  const templateSkills = join(pkg, 'templates', '.agents', 'skills');
  const rootCocoCommand = join(root, '.trae', 'commands', 'loop.md');
  const templateCocoCommand = join(pkg, 'templates', '.trae', 'commands', 'loop.md');

  if (!existsSync(rootSkills)) {
    console.log('== template skills drift ==');
    console.log(`  [skip] 未找到开发仓库真源: ${rootSkills}`);
    return 0;
  }

  console.log('== template skills drift ==');
  if (!existsSync(templateSkills)) {
    console.error(`  [FAIL] 未找到 npm 模板 skills: ${templateSkills}`);
    return 1;
  }

  const rootNames = skillNames(rootSkills);
  const templateNames = skillNames(templateSkills);
  const allNames = [...new Set([...rootNames, ...templateNames])].sort();
  let failed = false;

  for (const name of allNames) {
    const rootPath = join(rootSkills, name, 'SKILL.md');
    const templatePath = join(templateSkills, name, 'SKILL.md');

    if (!existsSync(rootPath)) {
      console.error(`  [FAIL] 模板多出 skill: ${name}`);
      failed = true;
      continue;
    }
    if (!existsSync(templatePath)) {
      console.error(`  [FAIL] 模板缺少 skill: ${name}`);
      failed = true;
      continue;
    }
    if (readFileSync(rootPath, 'utf8') !== readFileSync(templatePath, 'utf8')) {
      console.error(`  [FAIL] skill 模板漂移: ${name}/SKILL.md`);
      failed = true;
      continue;
    }
    console.log(`  [ok] ${name}/SKILL.md`);
  }

  if (existsSync(rootCocoCommand) || existsSync(templateCocoCommand)) {
    if (!existsSync(rootCocoCommand)) {
      console.error('  [FAIL] 缺少根 coco /loop 命令: .trae/commands/loop.md');
      failed = true;
    } else if (!existsSync(templateCocoCommand)) {
      console.error('  [FAIL] 缺少 npm 模板 coco /loop 命令: templates/.trae/commands/loop.md');
      failed = true;
    } else if (readFileSync(rootCocoCommand, 'utf8') !== readFileSync(templateCocoCommand, 'utf8')) {
      console.error('  [FAIL] coco /loop 命令模板漂移: .trae/commands/loop.md');
      failed = true;
    } else {
      console.log('  [ok] .trae/commands/loop.md');
    }
  }

  if (failed) {
    console.error('请先同步根 .agents/skills 与 .trae/commands/loop.md 到 loop-system/templates 后再发布');
    return 1;
  }
  return 0;
}

function skillNames(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(checkTemplates());
}
