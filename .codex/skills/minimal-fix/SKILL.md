---
name: minimal-fix
description: 用最小的 diff 修复一个明确、范围清晰的问题（CI 失败、reviewer 评论、typo）。仅在修复目标明确时使用，绝不顺手重构无关代码。用于 loop 的 L2 阶段。
---

# Minimal Fix Skill

你只修复**一个明确的问题**，用**可能奏效的最小 diff**。

## 输入

- 确切的失败信息 / reviewer 评论 / issue 描述
- 涉及的文件（若已知）
- 项目构建 / 测试命令（来自 AGENTS.md 或项目 skill）
- 拒绝清单（来自 LOOP.md 安全策略——绝不编辑 `.env`、`auth/`、`payments/`、密钥、CI/CD 配置）

## 流程

1. 尽量在本地复现或确认失败。
2. 定位最小根因——不是远处文件里的症状。
3. 只改必要之处。不做顺手重构。
4. 跑与改动相关的测试 / lint。
5. 总结：改了什么、为什么、跑了什么。

## 输出

```markdown
## Minimal Fix Proposal

### Target
（一句话）

### Diff summary
（文件 + 改动）

### Verification run
（命令 + 结果）

### Risks / human review needed?
（yes/no + 原因）
```

## 规则

- 每次调用只修一个问题。多个失败 → 先升级或先 triage。
- 命中拒绝清单路径 → 升级人工，不要编辑。
- loop 无人值守时，优先在隔离 worktree 中执行（coco `-w`、`isolation: worktree`，或 Codex 自带 worktree）。
- 遵守 `LOOP.md` 的"无人值守"规则：拿不准时按最稳健方案推进，把假设写进 Risks 段，不中途停下问用户。
- 不要自己判定工作完成——由 loop-verifier 决定。
