# @yaminzhou02/loop-system

轻量三角色 loop engineering 系统脚手架与 CLI，支持 coco（TraeCLI）/ Claude Code / Codex。

核心能力：

- `init`：把 loop skill 真源、状态模板和多工具 agent 配置安装到目标项目。
- `run`：驱动 L1 triage / L2 plan / L2 fix 三阶段流程。
- `watch`：支持多终端自动接力，按 plan → execute → verify 三角色串行推进。
- `sync`：从 `.agents/skills/` 生成 `.trae/.claude/.codex` 配置，并支持漂移检查。
- `verify` / `check`：提供 STATE 运行态门禁和时间无关的代码健康门禁。

## 快速开始

```bash
# 在目标项目根目录初始化
npx @yaminzhou02/loop-system init

# 检查生成物是否健康（适合 CI）
npx @yaminzhou02/loop-system check

# L1：只汇报，更新 STATE.md
npx @yaminzhou02/loop-system run triage
```

## 常用命令

```bash
# L2-策划：只生成 .loop/plan.md
loop-system run plan "修复某个明确问题"

# L2-执行：严格照 .loop/plan.md 执行
loop-system run execute "修复某个明确问题"

# L2-校验：独立 verifier 写 .loop/verifier-report.md
loop-system run verify-fix "修复某个明确问题"

# L2-全流程：planner → executor → verifier
loop-system run fix "修复某个明确问题"

# 重新生成 .trae/.claude/.codex
loop-system sync

# 只检查生成物漂移，不写文件
loop-system sync --check

# 时间无关代码健康门禁：模块加载 + 生成物漂移
loop-system check

# 运行态门禁：额外检查 STATE.md 新鲜度
loop-system check --state 240

# 只校验 STATE.md
loop-system verify 60
```

## 多终端自动接力（watch MVP）

在同一个已初始化项目里开三个终端：

```bash
# 终端 A：生成本轮任务与 plan.ready（MVP 阶段 plan 必须 --once）
loop-system watch plan "修复某个明确问题" --once

# 终端 B：等待 plan.ready，自动执行，成功后写 execute.ready
loop-system watch execute --once

# 终端 C：等待 execute.ready，自动校验，写 verify.done 和 verifier-report.md
loop-system watch verify --once
```

watch 通过 `.loop/stage/*.json` 传递 `taskId`，下游只处理与 `current.json` 匹配的本轮任务，避免旧产物串台。`verify.done.json` 只是通知；最终裁决仍以 `.loop/verifier-report.md` 首行为准。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 通过 |
| 1 | 失败 / 需要修复 |
| 2 | 需人工 / 环境阻塞 / 参数错误 |

## 重要约束

- `fix` 要求目标项目已有有效 `HEAD`，因为 executor / verifier 依赖 worktree 隔离。
- verifier 裁决唯一可信来源是本轮落盘的 `.loop/verifier-report.md` 首行。
- `.loop/` 与 `.trae/worktrees/` 是运行产物，应加入目标项目 `.gitignore`。
- watch 的 execute / verify 会使用 `.loop/stage/<role>.lock` 防重复启动；残留 lock 需要人工确认后删除。

## 许可证与第三方声明

本包使用 MIT 许可证，详见 `LICENSE`。

部分 loop engineering 模式、角色划分和 skill 文档参考或改写自 MIT 许可项目 `loop-engineering` 与 `agent-infra`。第三方版权与许可文本详见 `THIRD_PARTY_NOTICES.md`。
