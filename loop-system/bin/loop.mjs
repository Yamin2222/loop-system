#!/usr/bin/env node
import { init } from '../lib/init.mjs';
import { sync } from '../lib/sync.mjs';
import { verify } from '../lib/verify.mjs';
import { check } from '../lib/check.mjs';
import { run } from '../lib/run.mjs';
import { watch } from '../lib/watch.mjs';

const HELP = `loop-system — 三角色 loop engineering 系统（coco / Claude Code / Codex）

用法:
  loop-system init [目标目录]        脚手架：拷贝 .agents/LOOP.md/STATE.md 并生成三套工具配置
  loop-system run triage             L1：只汇报，更新 STATE.md（+门禁）
  loop-system run plan "<目标>"      L2-策划：委派 loop-planner 出 .loop/plan.md
  loop-system run execute "<目标>"   L2-执行：严格照 .loop/plan.md 执行
  loop-system run verify-fix "<目标>" L2-校验：独立 verifier 写 verifier-report.md
  loop-system run fix  "<目标>"      L2-全流程：planner→executor→verifier（需有效 HEAD）
  loop-system watch plan "<目标>" --once  多终端接力：生成 plan.ready
  loop-system watch execute          多终端接力：等待 plan.ready 后执行
  loop-system watch verify           多终端接力：等待 execute.ready 后校验
  loop-system sync [--check]         同步多工具生成物；--check 只查漂移不写
  loop-system verify [新鲜度分钟]     STATE.md 门禁（默认 60 分钟窗口）
  loop-system check [--state [N]]    聚合门禁：模块健康 + 漂移[ + --state STATE 新鲜度]

退出码: 0 通过 | 1 失败/需修 | 2 需人工/环境阻塞
`;

const [, , cmd, ...rest] = process.argv;

let rc = 0;
switch (cmd) {
  case 'init': rc = init(rest); break;
  case 'run': rc = run(rest); break;
  case 'watch': rc = watch(rest); break;
  case 'sync': rc = sync(rest); break;
  case 'verify': rc = verify(rest); break;
  case 'check': rc = check(rest); break;
  case '-h':
  case '--help':
  case undefined:
    console.log(HELP);
    rc = cmd === undefined ? 2 : 0;
    break;
  default:
    console.error(`未知子命令: ${cmd}\n`);
    console.error(HELP);
    rc = 2;
}
process.exit(rc);
