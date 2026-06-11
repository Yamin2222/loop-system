# Loop System — 使用说明

一个轻量的 **loop engineering** 系统：不再手动 prompt agent，而是设计 loop 去 prompt agent。
支持 **coco（TraeCLI）/ Claude Code / Codex** 三种工具，借鉴自 `reference/loop-engineering` 与 `reference/agent-infra`。

核心是**三角色分工 + 渐进阶段（L1→L2→L3）+ 确定性门禁**。

---

## 1. 它是什么 / 不是什么

- **是**：一套给 agent 的指令包（skills + 三角色子代理）+ 状态记忆（STATE.md）+ 调度/门禁脚本。
- **不是**：一个会自己跑的后台程序。它靠 cron 或你手动触发 `coco` 来运行。

要发挥价值，需放进一个**有真实开发活动（CI、issue、日常提交）的项目**。空仓库里跑 triage 结果是空的（正常）。

---

## 2. 三个角色（L2 的核心）

策划、执行、校验拆成三个独立子代理，**各绑不同模型**，互相制衡：

| 角色 | 职责 | 模型 | 隔离 / 写权限 |
|------|------|------|--------------|
| **loop-planner** | 只策划：调研代码库 → 出方案，不写代码 | openrouter-3o | 不隔离；仅写 `.loop/plan.md` |
| **loop-executor** | 只执行：严格照方案改代码+测试 | GPT-5.5 | worktree 隔离；可改源码+测试 |
| **loop-verifier** | 只校验：独立审查，默认 REJECT | Gemini-3.1-Pro | worktree 隔离；仅写 `.loop/verifier-report.md` |

主 agent 是**编排者**：依次委派三角色、在它们之间传递产物、更新 STATE.md。

> 改模型：编辑 `scripts/sync-skills.sh` 顶部的 `ROLES=()`，重跑 `bash scripts/sync-skills.sh`。

---

## 3. 三个阶段（渐进启用）

| 阶段 | 行为 | 命令 |
|------|------|------|
| **L1 汇报** | 只读 triage，写 STATE.md，不改代码 | `run-loop.sh triage` |
| **L2 策划+执行** | planner→executor→verifier，APPROVE 才提 PR，不自动合并 | `run-loop.sh plan` / `fix` |
| **L3 无人值守** | allowlist 内自动跑完并提交 | （信任后再开） |

**建议先跑 L1 一到两周**，triage 质量稳定后再开 L2，长期信任后才考虑 L3。

---

## 4. 安装到你的项目

### 方式一：npm 快速安装（推荐）

已发布为 npm 包 [`@yaminzhou02/loop-system`](https://www.npmjs.com/package/@yaminzhou02/loop-system)。在你的项目根目录执行：

```bash
# 脚手架：拷贝 .agents/LOOP.md/STATE.md，并自动生成 .trae/.claude/.codex 三套配置
npx @yaminzhou02/loop-system init .

# 之后用统一 CLI（详见下方「怎么用」）
npx @yaminzhou02/loop-system run triage
npx @yaminzhou02/loop-system check
```

> npm 版用统一 CLI（`loop-system run|sync|verify|check`），无需 bash 脚本；cron 直接调 `loop-system run triage`。详见 [`loop-system/README.md`](loop-system/README.md)。

### 方式二：手动复制（不装 npm 时）

把以下内容复制到你的项目根目录。推荐只复制真源和脚本，然后在目标项目里重新生成 `.trae` / `.claude` / `.codex`，避免把本仓库的运行态 worktree 一起带过去：

```bash
PROJ=/path/to/你的项目
SRC=/home/bytedance/codes/Loop\ Engineering

cp -r "$SRC/.agents"   "$PROJ/"   # skill 正文唯一来源
cp    "$SRC/STATE.md"  "$PROJ/"   # 状态模板（改标题；按需重置 Last run / Activity Log）
cp    "$SRC/LOOP.md"   "$PROJ/"   # 配置 + 规则
cp -r "$SRC/scripts"   "$PROJ/"   # run-loop / verify-loop / sync-skills / check-loop

# 不建议直接覆盖目标项目已有 .gitignore；手动合并这些规则即可：
# .loop/
# .trae/worktrees/
# reference/

# 在目标项目生成三套工具配置
(cd "$PROJ" && bash scripts/sync-skills.sh)
```

> `reference/` 不要复制。`.loop/` 与 `.trae/worktrees/` 都是运行产物，应保持 gitignore。
> 新项目首次使用前，建议把 `STATE.md` 里的历史 Activity Log 清空，只保留格式说明，避免把本仓库运行记录带过去。

---

## 5. 怎么用

### 5.1 coco（脚本 / cron）

```bash
# L1：只汇报，更新 STATE.md（跑完自动门禁校验）
bash scripts/run-loop.sh triage

# L2-策划：只让 planner 出方案到 .loop/plan.md，你先审
bash scripts/run-loop.sh plan "重构 X 模块的错误处理"

# L2-全流程：planner→executor→verifier。APPROVE 才提示可提 PR
bash scripts/run-loop.sh fix "修复 login 在空 token 时的空指针"
```

挂 cron（工作日 08:00 自动 triage）：
```bash
0 8 * * 1-5  cd /path/to/项目 && bash scripts/run-loop.sh triage >> .loop/cron.log 2>&1
```

### 5.2 coco 交互界面

```
/loop triage              # L1
/loop plan <目标>          # L2-策划
/loop fix <目标>           # L2-全流程
```

### 5.3 Claude Code / Codex

- **Claude Code**：用内置 `/loop`，例如 `/loop 1d Run $loop-triage. 读 STATE.md，只汇报`。
- **Codex**：在 Automations tab 建每日任务，prompt 写 `Run $loop-triage. 读 STATE.md，只汇报`。

---

## 6. 退出码（cron / CI 用）

`run-loop.sh fix` 和门禁脚本统一退出码语义：

| 码 | 含义 | 场景 |
|----|------|------|
| 0 | 通过 | APPROVE / 门禁全过 |
| 1 | 失败需修 | REQUEST_CHANGES / REJECT / 结构错误 |
| 2 | 需人工 | ESCALATE_HUMAN / 无 HEAD / 环境阻塞 |

> **L2 fix 前置**：worktree 子代理要求仓库至少有一次 commit（有效 HEAD）。空仓库先 `git commit`，否则 fix 以退出码 2 提示需人工。

---

## 7. 门禁与校验

```bash
# 代码健康门禁：语法 + 生成物漂移（时间无关，适合 CI）
bash scripts/check-loop.sh

# 运行态门禁：额外检查 STATE 新鲜度（确认 loop 刚跑过）
bash scripts/check-loop.sh --state 240

# 只检查多工具生成物是否与 .agents 真源漂移
bash scripts/sync-skills.sh --check

# 只校验 STATE.md 结构 + 新鲜度（默认 60 分钟窗口）
bash scripts/verify-loop.sh
```

**裁决唯一可信来源** = verifier 亲自落盘的 `.loop/verifier-report.md` 首行 `## Verdict: ...`。缺失即 ESCALATE_HUMAN（exit 2），绝不从 stdout 猜测。

---

## 8. 改 skill 内容（单一来源）

skill 正文只在 **`.agents/skills/<name>/SKILL.md`** 维护。`.trae/ .claude/ .codex/` 下的全是**生成物（勿手改）**。

```bash
# 1. 编辑真源
vim .agents/skills/loop-triage/SKILL.md

# 2. 重新生成三套工具的副本与子代理
bash scripts/sync-skills.sh

# 3. 确认无漂移
bash scripts/sync-skills.sh --check
```

---

## 9. 文件清单

| 路径 | 作用 |
|------|------|
| `LOOP.md` | 配置 + 规则（人工门槛 / denylist / 无人值守规则），**单一事实源** |
| `STATE.md` | loop 跨会话记忆 + append-only Activity Log |
| `.agents/skills/*/SKILL.md` | skill 正文唯一来源 |
| `.trae/ .claude/ .codex/` | 各工具的 skill 副本 + 三角色子代理（生成物） |
| `scripts/run-loop.sh` | 调度入口：triage / plan / fix |
| `scripts/verify-loop.sh` | STATE 门禁（结构 + 新鲜度） |
| `scripts/sync-skills.sh` | 单一来源同步器（`--check` 查漂移） |
| `scripts/check-loop.sh` | 聚合门禁（语法 + 漂移 [+ `--state` 新鲜度]） |
| `.loop/` | 运行产物（plan.md / verifier-report.md / cron.log），**已 gitignore** |

---

## 10. 安全约束（已内置）

- **Denylist**：minimal-fix/executor 永不编辑 `.env`、`auth/`、`payments/`、密钥、CI/CD 配置。
- **Human Gates**：设计决策、多文件重构、安全/认证/支付/基础设施、连续 3 天未解决 → 升级人工。
- **不自动合并**：verifier APPROVE 也只是"可提议 PR"，合并永远由人决定。
- **无人值守规则**：loop 中途不停下问用户（仅入参缺失 / 不可逆操作例外），疑问写进产物留到评审点。
