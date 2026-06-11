#!/usr/bin/env node
import { init } from '../lib/init.mjs';
import { sync } from '../lib/sync.mjs';
import { verify } from '../lib/verify.mjs';
import { check } from '../lib/check.mjs';
import { run } from '../lib/run.mjs';
import { watch } from '../lib/watch.mjs';
import { status } from '../lib/status.mjs';
import { routeNaturalInput, renderRouteDecision } from '../lib/route.mjs';

const HELP = `loop-system — 三角色 loop engineering 系统（coco / Claude Code / Codex）

coco 内常用:
  /loop status                       查看当前进度、产物、最近日志
  /loop 修复 login 空指针             自动选择 plan/fix 并编排三角色
  /loop 从 0 构建待办 Web 应用         自动生成项目 roadmap
  /loop plan <目标>                  只策划，产出 .loop/plan.md
  /loop fix <目标>                   planner→executor→verifier
  /loop council <项目>               多模型 council 路线图（成本显著更高）

一次性安装:
  npx @yaminzhou02/loop-system init  在项目中生成 .agents 与 .trae/commands/loop.md

维护:
  loop-system init [目标目录]        脚手架：拷贝 .agents/LOOP.md/STATE.md 并生成三套工具配置
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
  case 'status': rc = status(rest); break;
  case 'sync': rc = sync(rest); break;
  case 'verify': rc = verify(rest); break;
  case 'check': rc = check(rest); break;
  case '-h':
  case '--help':
  case undefined:
    console.log(HELP);
    rc = 0;
    break;
  default:
    {
      const decision = routeNaturalInput([cmd, ...rest]);
      if (!decision.ok) {
        console.error(decision.message);
        rc = decision.rc;
      } else {
        console.log(renderRouteDecision(decision));
        rc = decision.mode === 'status' ? status([]) : run(decision.args);
      }
    }
}
process.exit(rc);
