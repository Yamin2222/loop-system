# @yaminzhou02/loop-system

轻量三角色 loop engineering 系统脚手架与 CLI，支持 coco（TraeCLI）/ Claude Code / Codex。

核心能力：

- `init`：把 loop skill 真源、状态模板和多工具 agent 配置安装到目标项目。
- coco `/loop` 入口：直接描述目标，自动路由到合适的 status/roadmap/plan/fix/watch 路径。
- `status`：一屏查看当前任务、stage 接力、关键产物和最近日志。
- `run`：驱动 L1 triage、项目级 roadmap、L2 plan / fix 流程。
- `watch`：支持多终端自动接力，按 plan → execute → verify 三角色串行推进。
- `sync`：从 `.agents/skills/` 生成 `.trae/.claude/.codex` 配置，并支持漂移检查。
- `verify` / `check`：提供 STATE 运行态门禁和时间无关的代码健康门禁。

## 快速开始：初始化后在 coco 里用 `/loop`

```bash
# 在目标项目根目录初始化一次
npx @yaminzhou02/loop-system init
```

然后打开 coco，在项目中直接使用：

```text
/loop status
/loop 修复 login 空指针
/loop 从 0 构建一个待办事项 Web 应用
/loop plan 重构 X 模块的错误处理
/loop fix 修复 login 空指针
```

`init` 会生成 `.trae/commands/loop.md`，这是 coco 内的主入口。`loop-system ...` CLI 仍可用于 CI、cron 和调试，但不需要把 `npx ... run ...` 当作日常交互方式。

```bash
# 检查生成物是否健康（适合 CI）
loop-system check
```

## 常用命令

```text
# 推荐：coco 内 /loop 会按目标选择 status/roadmap/plan/fix/watch
/loop 修复 login 空指针
/loop 从 0 构建一个待办事项 Web 应用
/loop status

# 项目级拆分：只生成 .loop/roadmap.md，不执行代码
/loop roadmap 从 0 构建一个待办事项 Web 应用

# 重要项目可启用 council：drafter → challenger → arbiter，多模型复核，成本显著更高
/loop council 从 0 构建一个待办事项 Web 应用

# L2-策划：只生成 .loop/plan.md
/loop plan 修复某个明确问题

# L2-执行：严格照 .loop/plan.md 执行
/loop execute 修复某个明确问题

# L2-校验：独立 verifier 写 .loop/verifier-report.md
/loop verify-fix 修复某个明确问题

# L2-全流程：planner → executor → verifier
/loop fix 修复某个明确问题
```

CLI 维护命令：

```bash
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

# coco 排队/限流/超时时 opt-in 重试（默认不重试）
loop-system run roadmap --council "从 0 构建一个待办事项 Web 应用" --retries 3 --retry-interval 60
```

coco `/loop` 入口不要求用户记 npm/npx 命令；它读取 `LOOP.md` / `STATE.md`，按规则选择 status、roadmap、plan、fix 或 watch，并委派已生成的 skill/agent。

## 状态与结果汇总

```text
/loop status
```

`status` 纯读 `.loop/`，汇总当前 `taskId`、watch stage 接力、关键 artifact、verifier verdict 首行和最近 cron 日志。它不做语义判断；verdict 永远以 `.loop/verifier-report.md` 首行为准。

CLI `run plan/roadmap/execute/verify-fix/fix` 结束时会打印 `== Loop 结果 ==` 卡片，聚合目标、模式、退出码含义、关键产物和下一步建议。summary 只读已有 artifact，不新增模型调用，不替代 verifier 裁决。

## 项目级 Roadmap

当目标是“从 0 构建完整项目”时，先生成项目级路线图：

```text
/loop roadmap 从 0 构建一个待办事项 Web 应用
```

该命令只写 `.loop/roadmap.md`，不会写 `.loop/plan.md`，也不会执行代码。roadmap 中每个 milestone 都应包含 `Goal`、`Acceptance`、`Depends on` 和 `Suggested next command`。人审 roadmap 后，再挑选一个 milestone 进入 L2：

```text
/loop plan M1 — 初始化最小可运行骨架
/loop fix M1 — 初始化最小可运行骨架
```

如果 `.loop/roadmap.md` 中仍有 `Open Questions`，建议先通过人工/对话澄清，不要无人值守执行后续 milestone。

### Council Roadmap

对重要项目可使用 council 模式：

```text
/loop council 从 0 构建一个待办事项 Web 应用
```

该模式会要求 `roadmap-drafter → roadmap-challenger → roadmap-arbiter` 顺序协作，写入可审计的 `.loop/council.md`，并最终写 `.loop/roadmap.md`。机器门禁要求：council 记录非空、roadmap 包含 `## Roadmap:` 与 `### Milestones`；若 council verdict 为 `ESCALATE_HUMAN`，命令返回退出码 2。

`--council` 成本显著高于普通 roadmap（最多 2 轮、多角色模型调用），建议仅对重要或高不确定性的项目使用。

## coco 调用重试

`run` 命令支持在 coco 排队、限流、超时或临时服务错误时显式重试：

```bash
loop-system run plan "修复某个明确问题" --retries 3 --retry-interval 60
loop-system run roadmap --council "从 0 构建一个待办事项 Web 应用" --retries 3 --retry-interval 60
```

默认 `--retries 0`，即不重试，保持原有行为。开启后仅对白名单信号（如 queue/timeout/rate limit/429/503/网络瞬断等）重试；普通 prompt 失败或产物缺失不会盲目重试。重试不会放松 `.loop/plan.md`、`.loop/roadmap.md`、`.loop/council.md`、`.loop/verifier-report.md` 等 artifact gate，只影响 coco 调用本身。

重试会增加等待时间和模型调用成本，建议仅在明确遇到排队、限流或临时服务故障时使用。

## 多终端自动接力（watch MVP）

在同一个已初始化项目里开三个 coco 终端：

```text
# 终端 A：生成本轮任务与 plan.ready（MVP 阶段 plan 必须 --once）
/loop watch plan 修复某个明确问题 --once

# 终端 B：等待 plan.ready，自动执行，成功后写 execute.ready
/loop watch execute --once

# 终端 C：等待 execute.ready，自动校验，写 verify.done 和 verifier-report.md
/loop watch verify --once
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
- `run --retries` 默认关闭；开启后只对白名单排队/超时/限流/临时服务错误重试，不替代 artifact 校验。
- `.loop/` 与 `.trae/worktrees/` 是运行产物，应加入目标项目 `.gitignore`。
- watch 的 execute / verify 会使用 `.loop/stage/<role>.lock` 防重复启动；残留 lock 需要人工确认后删除。

## 许可证与第三方声明

本包使用 MIT 许可证，详见 `LICENSE`。

部分 loop engineering 模式、角色划分和 skill 文档参考或改写自 MIT 许可项目 `loop-engineering` 与 `agent-infra`。第三方版权与许可文本详见 `THIRD_PARTY_NOTICES.md`。
