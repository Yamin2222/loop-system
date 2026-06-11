# LOOP.md — My Loop System

我自己的 loop 系统配置，支持 coco / Claude Code / Codex 三种工具。
核心理念：不再手动 prompt agent，而是设计 loop 去 prompt agent。

## 状态主轴

- `STATE.md`：loop 跨会话记忆。每次运行必须读它、更新它。

## 三角色分工（核心）

不再让一个 agent 包揽全部。策划 / 执行 / 校验拆成三个独立子代理，**各绑不同模型**，互相制衡：

| 角色（子代理） | 职责 | skill | 模型 | 隔离 / 写权限 |
|---------------|------|-------|------|------|
| **loop-planner** | 只策划：调研代码库 → 出 `plan.md`，不写代码 | `loop-plan` | openrouter-3o（强推理/超大上下文） | 不隔离；仅写 `.loop/plan.md` |
| **loop-executor** | 只执行：严格照 `plan.md` 改代码+测试 | `loop-execute` | GPT-5.5（coding） | worktree；可改源码+测试 |
| **loop-verifier** | 只校验：独立审查，默认 REJECT | `loop-verifier` | Gemini-3.1-Pro（交叉检查） | worktree；仅写 `.loop/verifier-report.md` |

> 主 agent 是**编排者**，负责按流程依次委派这三个子代理、在它们之间传递产物（plan.md / diff / 校验报告）、并更新 STATE.md。

> **minimal-fix vs loop-execute 边界**：`minimal-fix` = 无需方案的单点快修（typo / 单测失败 / 一行评论，主 agent 直接跑）；`loop-execute` = 照 planner 的 `.loop/plan.md` 施工（executor 子代理）。**有方案走 fix 全流程，无方案的小问题走 minimal-fix。**

### 编排流程

```
triage（loop-triage，汇报）
   ↓ 选定一个 High-Priority 项
@loop-planner  → 产出 plan.md
   ↓ （人工或自动确认方案）
@loop-executor → 照 plan.md 在 worktree 落地
   ↓
@loop-verifier → 校验，输出 APPROVE / REQUEST_CHANGES / REJECT
   ↓ APPROVE 才提 PR；否则回 executor 或升级人工
更新 STATE.md（含 Activity Log）→ 门禁 verify-loop.sh
```

### 多终端自动接力（watch MVP）

需要把 plan / execute / verify 拆到多个终端时，可使用 watch 模式。它通过 `.loop/stage/*.json` 写入 `taskId`，下游只处理与 `current.json` 匹配的本轮任务，避免旧产物串台：

```bash
# 终端 A：源头任务，MVP 阶段 plan 必须 --once
loop-system watch plan "修复某个明确问题" --once

# 终端 B：等待 plan.ready 后自动执行
loop-system watch execute --once

# 终端 C：等待 execute.ready 后自动校验
loop-system watch verify --once
```

`verify.done.json` 只是接力通知；最终裁决仍以 `.loop/verifier-report.md` 首行为唯一可信来源。

## 其余原语

| 原语 | 作用 | 实现 |
|------|------|------|
| Skill | 持久化项目知识 | `loop-triage` / `loop-plan` / `loop-execute` / `minimal-fix` / `loop-verifier` |
| Worktree | 隔离执行 | coco `-w` / `isolation: worktree`；Codex 自带 worktree |
| State | 记忆 | `STATE.md`（含 append-only Activity Log） |
| Schedule | 周期触发 | `loop-system run` + cron |
| Gate | 产物门禁 | `loop-system verify` / `loop-system check`（退出码驱动） |

### 单一来源（勿手改生成物）

skill 正文只在 `.agents/skills/<name>/SKILL.md` 维护。`.trae/ .claude/ .codex/` 下的 skill/子代理都是**生成物**。改完正文跑：

```bash
loop-system sync
```


## 阶段（L1 → L2 → L3）

| 阶段 | 行为 | 角色 | 人工门槛 |
|------|------|------|---------|
| **L1** 汇报 | 只读 triage，写 `STATE.md`，不改代码 | triage | 人读 STATE.md 决策 |
| **L2** 策划+执行 | planner 出方案 → executor 照做 → verifier 校验 | planner/executor/verifier | 方案确认 + verifier APPROVE 才提 PR；不自动合并 |
| **L3** 无人值守 | allowlist 内自动跑完三角色并提交/PR | 全部 | 仅 allowlist；其余升级人工 |

先跑 L1 一到两周，triage 质量稳定后再开 L2 三角色流程，长期信任后才考虑 L3。

> **L2 fix 前置**：worktree 子代理要求仓库至少有一次 commit（有效 HEAD）。空仓库请先完成初始 commit，否则 `loop-system run fix` 会以退出码 2 提示需人工。

## 人工门槛（Human Gates）

- 设计决策、多文件重构 → 人工
- 安全 / 认证 / 支付 / 基础设施 → 人工
- triage 标 "needs discussion" → 人工
- 同一项连续 3 天未解决 → 升级人工

## 无人值守规则（no-mid-flow-questions）

loop 自动跑时最怕中途卡在等用户输入。因此：

- skill 执行中**默认不停下问用户**。拿不准时按"最稳健方案"推进，优先级：
  1. 与现有代码 / 约定一致
  2. 更可逆
  3. 影响面更小
- 把假设和疑问写进产物对应段落（triage → State Updates；minimal-fix → Risks），由人在**评审点**统一处理。
- 仅两类例外允许中断：
  1. 入口式入参缺失（如 `fix` 没给目标描述）
  2. 不可逆破坏操作（删数据、force push 等）
- 本规则唯一锚点在此；各 skill 只引用、不重复正文。

## 安全 / 拒绝清单（Denylist）

minimal-fix 永不编辑：`.env`、`auth/`、`payments/`、密钥文件、CI/CD 配置。
verifier 默认 REJECT，除非证据充分。

## 各工具触发方式

| 工具 | 触发 | 备注 |
|------|------|------|
| coco | `loop-system run`（cron 调度） | 用 `coco -p` 无头运行 |
| Claude Code | `/loop 1d Run $loop-triage ...` | 内置 /loop |
| Codex | Automations tab，每日调 `$loop-triage` | 自带 worktree |

## 本地运行

```bash
# L1 单次 triage（coco）
loop-system run triage

# 代码健康门禁：语法 + 生成物漂移（适合 CI，结果不随时间漂移）
loop-system check

# 运行态门禁：额外检查 STATE 新鲜度（适合本地确认 loop 刚跑过）
loop-system check --state 240

# 只检查多工具 skill / agent 生成物是否漂移
loop-system sync --check

# 多终端自动接力（各开一个终端）
loop-system watch plan "修复某个明确问题" --once
loop-system watch execute --once
loop-system watch verify --once

# 挂 cron：每个工作日 08:00 跑 triage
# 0 8 * * 1-5  cd /path/to/repo && loop-system run triage >> .loop/cron.log 2>&1
```
