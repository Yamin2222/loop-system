import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './paths.mjs';

// verify [新鲜度分钟数, 默认 60]
export function verify(args) {
  const root = projectRoot();
  const statePath = join(root, 'STATE.md');
  const freshArg = args[0] ?? '60';

  if (!/^[0-9]+$/.test(String(freshArg))) {
    console.error(`[verify] 新鲜度分钟数必须是非负整数: ${args[0]}`);
    return 2;
  }
  const freshMin = Number(freshArg);
  if (!existsSync(statePath)) {
    console.error(`[verify] 找不到 STATE.md`);
    return 2;
  }

  const text = readFileSync(statePath, 'utf8');
  let rc = 0;
  console.log('== 校验 STATE.md ==');

  // 1. 必需段落
  for (const sec of ['## High Priority', '## Watch List', '## Activity Log']) {
    if (text.includes(sec)) console.log(`  [ok] 段落: ${sec}`);
    else { console.log(`  [FAIL] 缺段落: ${sec}`); rc = 1; }
  }

  // 2. Last run 非 never
  const lastMatch = text.match(/^Last run:\s*(.*)$/m);
  const last = lastMatch ? lastMatch[1].trim() : '';
  if (!last || last === 'never') {
    console.log(`  [FAIL] Last run 未更新（=${last}）`); rc = 1;
  } else {
    console.log(`  [ok] Last run: ${last}`);
    // 3. 新鲜度
    const ts = Date.parse(last);
    if (!Number.isNaN(ts)) {
      const ageMin = Math.floor((Date.now() - ts) / 60000);
      if (ageMin <= freshMin) console.log(`  [ok] 新鲜度: ${ageMin}min ≤ ${freshMin}min`);
      else { console.log(`  [FAIL] 产物过期: ${ageMin}min > ${freshMin}min（疑似拿旧产物冒充）`); rc = 1; }
    } else {
      console.log('  [warn] 无法解析 Last run 时间格式，跳过新鲜度检查');
    }
  }

  // 4. 今天是否有 Activity Log 条目（排除示例行）
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD（本地时区）
  const re = new RegExp(`^${today}.*\\|.*\\|`);
  const hasEntry = text.split('\n').some((l) => re.test(l) && !l.startsWith('例'));
  if (hasEntry) console.log(`  [ok] 今天(${today})有 Activity Log 条目`);
  else { console.log(`  [FAIL] 今天(${today})无 Activity Log 条目（loop 未追加记录）`); rc = 1; }

  console.log(`== verify rc=${rc} ==`);
  return rc;
}
