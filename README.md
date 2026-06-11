# Loop System

一个轻量的 **loop engineering** 系统：不再手动 prompt agent，而是设计 loop 去 prompt agent。
支持 **coco（TraeCLI）/ Claude Code / Codex**，借鉴自 `reference/loop-engineering` 与 `reference/agent-infra`。

核心：**三角色分工（策划/执行/校验，各绑不同模型）+ 渐进阶段（L1→L2→L3）+ 确定性门禁 + 可解释入口**。

已发布 npm 包：[`@yaminzhou02/loop-system`](https://www.npmjs.com/package/@yaminzhou02/loop-system)

---

## 1. 它是什么 / 不是什么

- **是**：一套给 agent 的指令包（skills + 三角色子代理）+ 状态记忆（`STATE.md`）+ 调度/门禁 CLI。
- **不是**：一个会自己跑的后台程序。它靠你触发命令（或 cron）调 `coco` 来运行。

要发挥价值，需放进一个**有真实开发活动（CI、issue、日常提交）的项目**。空仓库里跑 triage 结果是空的（正常）。

---

## 2. 安装到项目，然后在 coco 里用

`@yaminzhou02/loop-system` 的 npm 命令主要用于**一次性初始化**和 CI/cron；日常交互入口是在 coco 里输入 `/loop ...`。

在你的项目根目录初始化一次：

```bash
# 脚手架：拷贝 .agents/LOOP.md/STATE.md，并生成 .trae/.claude/.codex 配置
npx @yaminzhou02/loop-system init .
```

然后打开 coco，在项目里使用：

```text
/loop status
/loop 修复 login 在空 token 时的空指针
/loop 从 0 构建一个待办事项 Web 应用
/loop plan 重构 X 模块的错误处理
/loop fix 修复 login 空指针
```

初始化会生成 `.trae/commands/loop.md`，所以 `/loop` 是 coco 内的主入口；不需要把 `npx ... run ...` 当作日常用法。

把这几条加进你项目的 `.gitignore`（init 会提示，不会自动覆盖）：

```
.loop/
.trae/worktrees/
```

> `loop-system ...` CLI 仍保留给 CI、cron、发布前检查和调试使用；例如 `loop-system check`、`loop-system sync --check`。日常修复、规划和 triage 都优先在 coco 内用 `/loop ...`。

---

## 3. 怎么用

### 3.1 coco 内统一入口（最简单）

不用记 npm/npx 子命令，在 coco 里直接 `/loop` 加目标，系统按规则判断该走哪条路径：

```text
/loop 修复 login 在空 token 时的空指针
/loop 从 0 构建一个待办事项 Web 应用
/loop status
```

它会先打印判断卡片（命中了哪些关键词、按什么优先级选了哪条路径、将执行什么命令），再执行：

```
== Loop 判断 ==
目标: 修复整个项目的构建
判断: roadmap
命中: roadmap: 构建/项目; fix: 修复
因为: 按优先级 status > council > roadmap > plan > fix，选择 roadmap
将执行: roadmap
```

判断不对就改措辞，或直接用显式模式：`/loop plan ...`、`/loop fix ...`、`/loop roadmap ...`、`/loop council ...`。

### 3.2 查看进度

```text
/loop status
```
一屏显示当前任务、各阶段、产物、verifier 裁决、最近日志（纯读 `.loop/`，零模型成本）。

### 3.3 单个改动（L2）

```text
# 一把过：策划→执行→校验，APPROVE 才提示可提 PR（不自动合并）
/loop fix 修复 login 空指针

# 想先审方案：先出 plan.md，你看完再执行
/loop plan 重构 X 模块的错误处理   # 产出 .loop/plan.md
/loop fix  重构 X 模块的错误处理   # 复用 plan 执行
```

每轮结束打印结果卡片（做了什么 / 结果 / 产物 / 下一步）。

### 3.4 从 0 构建完整项目（项目级规划）

大项目不要直接 `fix`，先拆成里程碑：

```text
# 项目级拆分：产出 .loop/roadmap.md（有序里程碑，每条带验收标准和"下一步命令"）
/loop roadmap 从 0 构建一个待办事项 Web 应用

# 多模型磋商版（draft→challenge→arbiter，质量更高，成本显著更高）
/loop council 从 0 构建一个待办事项 Web 应用
```

人审 `.loop/roadmap.md` 后，照里程碑逐条进 L2：

```text
/loop plan M1 — 初始化最小可运行骨架
/loop fix  M1 — 初始化最小可运行骨架
# M2、M3 ...
```

> 复杂需求建议先用 coco / Claude 对话把方案聊清楚，再把最终目标交给 `/loop roadmap ...`。

### 3.5 多终端自动接力（watch）

策划/执行/校验分到不同终端，靠 `.loop/stage/*.json` 自动接力：

```text
# 终端 A（先把 B、C 开起来等）
/loop watch plan 修复 login 空指针 --once

# 终端 B：等到 plan.ready 自动执行
/loop watch execute

# 终端 C：等到 execute.ready 自动校验
/loop watch verify
```
通过 taskId 防串台；`--interval`/`--timeout` 控制轮询。

### 3.6 排队/超时自动重试（opt-in）

维护 CLI 内部支持 opt-in 重试；日常使用不需要记这组参数，优先在 coco 内执行 `/loop ...`：

```bash
# 调试/CI 专用：给底层 runner 开启排队/限流/超时重试
loop-system --help
```
只对排队/限流/超时/网络瞬断等**白名单信号**重试；真失败（如 prompt 错）立即失败，不浪费配额。

### 3.7 挂 cron

```bash
0 8 * * 1-5  cd /path/to/项目 && loop-system check >> .loop/cron.log 2>&1
```

### 3.8 Claude Code / Codex

- **coco**：项目初始化后使用 `.trae/commands/loop.md` 提供的 `/loop ...`。
- **Claude Code**：内置 `/loop`，如 `/loop 1d Run $loop-triage. 读 STATE.md，只汇报`。
- **Codex**：Automations tab 建每日任务，prompt 写 `Run $loop-triage. 读 STATE.md，只汇报`。

---

## 4. 三个角色（L2 的核心）

策划、执行、校验拆成三个独立子代理，**各绑不同模型**，互相制衡：

| 角色 | 职责 | 模型 | 隔离 / 写权限 |
|------|------|------|--------------|
| **loop-planner** | 只策划：调研代码库 → 出方案，不写代码 | openrouter-3o | 不隔离；仅写 `.loop/plan.md` |
| **loop-executor** | 只执行：严格照方案改代码+测试 | GPT-5.5 | worktree 隔离；可改源码+测试 |
| **loop-verifier** | 只校验：独立审查，默认 REJECT | Gemini-3.1-Pro | worktree 隔离；仅写 `.loop/verifier-report.md` |

council 模式额外用三个规划角色：`roadmap-drafter`（openrouter-3o）→ `roadmap-challenger`（Gemini-3.1-Pro）→ `roadmap-arbiter`（GPT-5.5）。

主 agent 是**编排者**：依次委派、传递产物、更新 STATE.md。

> 改模型：编辑 `.agents` 真源旁的角色定义（开发本包时在 `loop-system/lib/sync.mjs` 的 `ROLES`），重跑 `loop-system sync`。

---

## 5. 三个阶段（渐进启用）

| 阶段 | 行为 | 命令 |
|------|------|------|
| **L1 汇报** | 只读 triage，写 STATE.md，不改代码 | `/loop status` 或 `/loop triage` |
| **L2 策划+执行** | planner→executor→verifier，APPROVE 才提 PR，不自动合并 | `/loop plan ...` / `/loop fix ...` / `/loop watch ...` |
| **L3 无人值守** | allowlist 内自动跑完并提交 | （信任后再开） |

**建议先跑 L1 一到两周**，triage 质量稳定后再开 L2，长期信任后才考虑 L3。

---

## 6. 退出码（cron / CI 用）

| 码 | 含义 | 场景 |
|----|------|------|
| 0 | 通过 | APPROVE / 门禁全过 |
| 1 | 失败需修 | REQUEST_CHANGES / REJECT / 结构错误 / 拼错命令 |
| 2 | 需人工 | ESCALATE_HUMAN / 无 HEAD / 低置信度入口 / 环境阻塞 |

> **L2 fix 前置**：worktree 子代理要求仓库至少有一次 commit（有效 HEAD）。空仓库先 `git commit`，否则以退出码 2 提示需人工。

---

## 7. 门禁与校验

```bash
loop-system check                 # 代码健康：模块 + 生成物漂移（时间无关，适合 CI）
loop-system check --state 240     # 额外检查 STATE 新鲜度（确认 loop 刚跑过）
loop-system sync --check          # 只查多工具生成物是否与 .agents 真源漂移
loop-system verify [分钟]          # 只校验 STATE.md 结构 + 新鲜度（默认 60 分钟）
```

**裁决唯一可信来源** = verifier 亲自落盘的 `.loop/verifier-report.md` 首行 `## Verdict: ...`。缺失即 ESCALATE_HUMAN（exit 2），绝不从 stdout 猜测。status/summary 也只读这个事实，不自行推断。

---

## 8. 改 skill 内容（单一来源）

skill 正文只在 **`.agents/skills/<name>/SKILL.md`** 维护。`.trae/ .claude/ .codex/` 下全是**生成物（勿手改）**。

```bash
vim .agents/skills/loop-triage/SKILL.md   # 1. 改真源
loop-system sync                          # 2. 重新生成三套工具副本+子代理
loop-system sync --check                  # 3. 确认无漂移
```

---

## 9. 命令总览

```
入口/常用:
  /loop <目标>                         coco 内自然语言入口（可解释路由）
  /loop status                         当前进度/产物/裁决/最近日志
  /loop fix <目标>                     L2 全流程
  /loop roadmap <项目>                 项目级拆分
  /loop council <项目>                 多模型项目级拆分

底层/高级:
  /loop triage | plan | execute | verify-fix   单步执行
  /loop watch plan | execute | verify          多终端自动接力

维护:
  loop-system init | sync [--check] | verify | check [--state N]
```

---

## 10. 安全约束（已内置）

- **Denylist**：executor 永不编辑 `.env`、`auth/`、`payments/`、密钥、CI/CD 配置。
- **Human Gates**：设计决策、多文件重构、安全/认证/支付/基础设施、连续 3 天未解决 → 升级人工。
- **不自动合并**：verifier APPROVE 也只是"可提议 PR"，合并永远由人决定。
- **无人值守规则**：loop 中途不停下问用户（仅入参缺失 / 不可逆操作例外），疑问写进产物留到评审点。

---

## 11. 本仓库开发（贡献者）

npm 包源码在 `loop-system/`。本仓库根的 `.agents/` 是 dogfooding 用 skill 真源，`.trae/.claude/.codex` 是由 `loop-system sync` 生成的多工具配置。

```bash
cd loop-system && npm test          # 全量测试
node bin/loop.mjs sync --check      # 在仓库根跑，检查 templates 与真源无漂移
```

许可证 MIT，第三方借鉴声明见 `loop-system/THIRD_PARTY_NOTICES.md`。
