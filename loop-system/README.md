# @yaminzhou02/loop-system

轻量三角色 loop engineering 系统脚手架与 CLI，支持 coco（TraeCLI）/ Claude Code / Codex。

核心能力：

- `init`：把 loop skill 真源、状态模板和多工具 agent 配置安装到目标项目。
- `run`：驱动 L1 triage / L2 plan / L2 fix 三阶段流程。
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

## 许可证与第三方声明

本包使用 MIT 许可证，详见 `LICENSE`。

部分 loop engineering 模式、角色划分和 skill 文档参考或改写自 MIT 许可项目 `loop-engineering` 与 `agent-infra`。第三方版权与许可文本详见 `THIRD_PARTY_NOTICES.md`。
