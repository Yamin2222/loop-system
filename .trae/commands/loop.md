---
description: loop 编排入口。triage=L1只汇报；plan=委派策划出方案；fix=三角色全流程（策划→执行→校验）。
argument-hint: triage | plan <目标> | fix <目标>
---

读取 `LOOP.md` 与 `STATE.md`，按下面模式编排三角色子代理。

模式：${1:-triage}
目标 / 上下文：$ARGUMENTS

- **triage（L1）**：运行 `loop-triage` skill。先读 STATE.md，把 High-Priority 和 Watch 合并进去，更新 Last run，在 Activity Log 追加一行。**只汇报，不改代码。**

- **plan（L2-策划）**：委派 `@loop-planner` 子代理（模型 openrouter-3o）调研代码库并产出 `plan.md`（写到 `.loop/plan.md`）。**只策划，不写代码。** 方案里的取舍写进 Open Questions 供你确认。

- **fix（L2-全流程）**：三角色依次编排——
  1. `@loop-planner` 出 plan.md（若已有匹配的 `.loop/plan.md` 可复用）
  2. `@loop-executor`（GPT-5.5，worktree 隔离）严格照 plan.md 落地实现+测试
  3. `@loop-verifier`（Gemini-3.1-Pro）独立校验，输出 APPROVE / REQUEST_CHANGES / REJECT
  
  verifier APPROVE 才提议 PR，**绝不自动合并**；否则回 executor 修一轮或升级人工。把结果追加到 STATE.md 的 Activity Log。

遵守 `LOOP.md` 的人工门槛、拒绝清单与无人值守规则。
