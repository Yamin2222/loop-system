---
name: loop-triage
description: 分流近期变更、CI 失败、issue 和对话，产出一份精简、可执行、按优先级排序的发现报告，并写入 STATE.md。用于 loop 的 L1 汇报阶段。
---

# Loop Triage Skill

你是工程分流（triage）专家。任务：产出一份干净、按优先级排序的清单，供 loop 决定是否行动。

## 输入（loop 会提供）

- 近 24h 的 CI / 测试失败
- 分配给团队的 open issue / 工单
- main 上近 24–48h 的提交
- loop 可见的聊天线程
- 当前 `STATE.md`（loop 已知的内容）

## 流程

1. 先读 `STATE.md` 和 `LOOP.md`，了解已知项与规则，避免重复。
2. 收集上述输入信号。
3. 按下方格式产出报告，并**合并**进 `STATE.md` 对应小节。
4. 更新 `STATE.md` 顶部的 `Last run` 时间戳。
5. 清理 `STATE.md` 中已解决 / 已合并的项，防止无限膨胀。
6. 在 `STATE.md` 的 Activity Log 末尾**追加一行**（不覆盖）：`时间戳 | loop-triage | <工具> | findings=N high=N watch=N`。

## 输出格式

### 1. High-Priority（今天就该行动）
- 一句话描述
- 为什么重要（影响 / 风险 / 客户痛点）
- 建议的下一步（如 "在隔离 worktree 里起草 minimal fix"）
- 粗略工作量估计

### 2. Watch（监控，暂不行动）
- 同上格式，紧急度更低

### 3. Noise / Ignore
- 看过但判定不值得行动的项

### 4. State Updates
- 下次运行要记住的事实（如 "PR #1234 已有 2 个 approval"）

## 规则

- 极度精简，loop 和读 STATE.md 的人都会感谢你。
- 只有"一个理性工程师今天会想知道"的事才放进 High-Priority。
- 拿不准时放 Watch 或 Noise，不要凭空制造工作。
- triage 阶段绝不提议架构重构——只产出信号，不发明工作。
- 尊重项目既有的规范与 skill（会在上下文中提供）。
- 遵守 `LOOP.md` 的"无人值守"规则：中途不停下问用户，把疑问记进 State Updates，留待评审点处理。
- **L1 阶段：只汇报，不改任何源码。**
