import { sync } from './sync.mjs';
import { verify } from './verify.mjs';

// check [--state [N] | N]
export function check(args) {
  let runState = false;
  let freshArg = '240';

  if (args.length > 0) {
    const a = args[0];
    if (a === '--state') {
      runState = true;
      if (args.length > 2) { usage(); return 2; }
      if (args[1] !== undefined) freshArg = args[1];
    } else if (a === '-h' || a === '--help') {
      usage(); return 0;
    } else if (args.length === 1 && /^[0-9]+$/.test(a)) {
      runState = true; freshArg = a; // 兼容旧用法
    } else {
      usage(); return 2;
    }
  }

  if (!/^[0-9]+$/.test(String(freshArg))) {
    console.error(`[check] STATE 新鲜度分钟数必须是非负整数: ${args[1] ?? args[0]}`);
    return 2;
  }
  const freshMin = Number(freshArg);

  // 代码健康：模块可加载（等价 bash 的 bash -n）— 本文件能 import sync/verify 即已通过
  console.log('== module health ==');
  console.log('  [ok] lib 模块可加载');

  console.log('== generated skills drift ==');
  const drc = sync(['--check']);
  if (drc !== 0) return drc;

  console.log('== loop state gate ==');
  if (runState) {
    const vrc = verify([String(freshMin)]);
    if (vrc !== 0) return vrc;
  } else {
    console.log(`  [skip] 默认跳过时间敏感的 STATE 新鲜度检查；需要时运行: loop-system check --state ${freshMin}`);
  }

  console.log('== check PASS ==');
  return 0;
}

function usage() {
  console.error('用法: loop-system check [--state [新鲜度分钟数] | 新鲜度分钟数]');
}
