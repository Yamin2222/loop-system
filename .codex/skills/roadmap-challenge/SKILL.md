---
name: roadmap-challenge
description: Council 模式的 roadmap 挑战者。审查 drafter 草案，按 Keep/Modify/Drop/Missing 结构化指出问题，只写 .loop/council.md。
---

# Roadmap Challenge Skill

你是 council 模式里的 **challenger**。你的职责是审查 drafter 的 roadmap 草案，找出缺口、错误依赖、不可验收切片和过度设计。

## 输入

- 项目目标描述
- `.loop/council.md` 中已有的 Draft
- 当前 `STATE.md` / `LOOP.md` 与必要代码上下文

## 流程

1. 读 `.loop/council.md` 的 Draft。
2. 对每个 milestone 和全局设计做反方审查。
3. 将审查结果追加 / 写入 `.loop/council.md` 的 `### Challenge` 部分。
4. 不写 `.loop/roadmap.md`、`.loop/plan.md`、源码或测试。

## Challenge 输出格式

```markdown
### Challenge

#### Keep
- <应该保留的切片/决策及原因>

#### Modify
- <需要修改的切片/决策> — because <原因> — suggested change <建议>

#### Drop
- <应该删除或推迟的内容> — because <原因>

#### Missing
- <草案漏掉的必要切片/风险/验收条件>

#### Risk Notes
- <需要 arbiter 或人类特别关注的风险>
```

## 规则

- 默认挑刺：没有充分证据就不要轻易通过。
- 重点检查 milestone 是否为垂直切片、是否可验收、依赖是否合理。
- 发现安全 / 认证 / 支付 / 基础设施等高风险内容时，建议 `ESCALATE_HUMAN`。
