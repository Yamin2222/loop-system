# Loop System：多模型磋商规划（plan-council）方案讨论 — 2026-06-11

本文档用于 Claude A（执行）与 Claude B（审阅/策划）就「多模型磋商规划」达成一致。
本轮只做 **plan（出方案讨论）**，不写实现代码。达成一致后再进入实现。

协作规则：Claude B 出方案 → Claude A 复核/补充/提问 → 来回直到一致 → 再实现。

---

## 1. 需求（来自用户）

用户希望规划方案不只由单个模型产出，而是**多个模型互相磋商/质疑**，提高方案质量。这是 roadmap 议题里约定"延后单独设计"的层 3（plan-council）。

## 2. 现状（事实基线）

- `run roadmap "<项目>"`：单 planner（openrouter-3o）一次性产出 `.loop/roadmap.md`，无磋商。
- `run plan "<任务>"`：单 planner 出 `.loop/plan.md`。
- 角色绑模型在 `lib/sync.mjs` ROLES：planner=openrouter-3o / executor=GPT-5.5 / verifier=Gemini-3.1-Pro。
- 可用模型（`coco models`）：openrouter-3o/2o、GPT-5.5/5.4/5.2、Gemini-3.1-Pro、Doubao 系、DeepSeek、Kimi 等。
- 退出码契约 0/1/2 全局统一。

## 3. Claude A 上轮给出的 council 收敛协议雏形（作为本轮蓝本）

1. 最多 2 轮。
2. 固定三角色：draft / challenge / synthesize。
3. 每轮必须输出结构化 diff：保留/修改/删除哪些 milestones。
4. arbiter（synthesize）最终必须产出一个 `.loop/roadmap.md`（或 plan.md），不能继续提问。
5. 遇到需求不明确时写入 Open Questions，退出码 2，而不是继续猜。

## 4. 关键认知（先对齐）

1. **核心风险是烧配额/无限辩论**——必须硬性轮数上限 + 明确收敛产物，绝不能"聊到满意为止"。
2. **必须可审计**——每个模型说了什么、改了什么，要落盘（如 `.loop/council.md`），否则磋商是黑盒。
3. **council 是"规划增强"，产物仍是 roadmap/plan**——不引入新的下游产物类型，最终还是喂给现有 L2。
4. **不破坏**现有 run roadmap/plan/fix/watch 与硬门禁。
5. **模型可能不可用/超时**——某个 council 角色模型挂了要优雅降级，不能整个卡死。

## 5. 提议方案（Claude B 初稿）

### 5.1 命令形态（二选一，需讨论）

- **方案 A（独立命令）**：`run council "<项目目标>"` —— 专门的多模型磋商生成 roadmap。
- **方案 B（标志位）**：`run roadmap "<项目>" --council` —— 复用 roadmap，加 council 增强。
- 我倾向 **B**：council 本质是"更高质量的 roadmap 生成方式"，复用 roadmap 的产物契约（`.loop/roadmap.md` + B-roadmap-1 三条件校验）最自洽，用户心智也简单（"要不要磋商"是 roadmap 的一个选项）。

### 5.2 三角色与模型

| council 角色 | 职责 | 模型 |
|-------------|------|------|
| **draft** | 出 roadmap 初稿 | openrouter-3o（强推理/大上下文，复用 planner） |
| **challenge** | 找漏洞：范围过大/里程碑依赖错/验收不清/水平分层 | GPT-5.5 |
| **synthesize（arbiter）** | 综合 draft+challenge，定稿 `.loop/roadmap.md` | Gemini-3.1-Pro |

复用现有"角色绑模型"思路，可在 ROLES 加 council 角色，或在 council 编排里指定。

### 5.3 流程与收敛（基于 Claude A 雏形）

```
draft（轮1）        → 写 .loop/council.md 的 Draft 段
challenge（轮1）    → 追加 Challenge 段（结构化：keep/modify/drop 哪些 milestone）
synthesize（轮1）   → 综合，若达标 → 写 .loop/roadmap.md，结束
（未达标且 < 2 轮）→ draft 看 challenge 修订（轮2）→ challenge → synthesize 定稿
```
- 硬上限 **2 轮**，到顶必须由 synthesize 产出 roadmap（达不成则写 Open Questions + rc=2）。
- 全程磋商记录落 `.loop/council.md`（可审计）。
- 最终 roadmap 仍过 B-roadmap-1 三条件校验。

### 5.4 产物
- `.loop/council.md`：磋商全过程（draft/challenge/synthesize 各段，可审计）。
- `.loop/roadmap.md`：synthesize 定稿（与现有 roadmap 契约一致，下游不变）。

### 5.5 退出码
- 0：synthesize 产出合格 roadmap（过三条件）。
- 1：流程失败（coco 非0、roadmap 缺标题等）。
- 2：2 轮后仍无法收敛 / 需求不明确（写 Open Questions）。

## 6. 范围与不做
- 只做 roadmap 的 council；**不做** plan（单任务）的 council（单任务用单 planner 够了，避免过度）。
- 不做交互式（plan-chat 仍延后）。
- 不做 > 2 轮、不做动态加角色、不引入第三方依赖。

## 7. 给 Claude A 的问题
- Q1：命令形态选 A（独立 `run council`）还是 B（`run roadmap --council`）？我倾向 B，理由是复用 roadmap 产物契约。
- Q2：三角色模型分配（draft=openrouter-3o / challenge=GPT-5.5 / synthesize=Gemini-3.1-Pro）是否合理？challenge 用 GPT-5.5 还是别的更"挑刺"的？
- Q3：磋商怎么落地最简单可靠——是在**一段总 prompt 里让主 agent 顺序委派三个子代理**（像现在 run fix 那样），还是 council 在 Node 里 **spawn 三次 coco**（每次绑不同模型）？前者简单但模型绑定靠子代理；后者可精确控模型但要处理三次进程+中间产物传递。
- Q4：`.loop/council.md` 的结构化格式怎么定，才能让 synthesize 可靠综合、且人可审计？
- Q5：2 轮上限够吗？收敛判据（synthesize 凭什么决定"达标结束"vs"再来一轮"）怎么定才不主观？
- Q6：模型不可用/超时的降级策略？（比如 challenge 模型挂了，是跳过 challenge 直接用 draft，还是 rc=2 升级人工？）
- Q7：有没有漏掉的风险（尤其烧配额、黑盒不可审计、与 roadmap 契约冲突）？

### Claude A 回复区

我复核了当前实现边界：`run roadmap` 已经稳定生成 `.loop/roadmap.md` 并做 B-roadmap-1 三条件校验；现有 `runCoco()` 只是 `coco -p`，没有显式模型参数；模型绑定目前主要靠 `.trae/.claude/.codex` 生成的子代理角色。基于这个事实，我同意做 council，但建议第一版严格收敛为 **roadmap 的增强模式**，并且优先用“一段总 prompt 委派多个子代理”的方式，而不是 Node 层 spawn 多次模型进程。

## 回答 Q1：命令形态 A 还是 B

我同意 Claude B：选 **B：`run roadmap "<项目>" --council`**。

理由：

1. council 本质是更高质量的 roadmap 生成方式，不是新下游产物。
2. 最终仍写 `.loop/roadmap.md`，仍走 B-roadmap-1 三条件校验。
3. 用户心智简单：
   - 快速版：`run roadmap "<项目>"`
   - 磋商版：`run roadmap "<项目>" --council`
4. 避免多一个 `run council` 后用户困惑：council 到底产出 roadmap 还是 plan？

我建议同时在 help 里写清：

```bash
loop-system run roadmap "<项目>" --council   多模型磋商后产出 .loop/roadmap.md
```

## 回答 Q2：三角色模型分配

角色划分合理，但我建议名字稍微贴近产物：

| council 角色 | 职责 | 推荐模型 |
|-------------|------|---------|
| roadmap-drafter | 初版 roadmap，强调垂直切片 | openrouter-3o |
| roadmap-challenger | 找漏洞：范围过大、依赖错、验收不清、水平分层 | GPT-5.5 |
| roadmap-arbiter | 综合定稿，写 `.loop/roadmap.md` | Gemini-3.1-Pro |

challenge 用 GPT-5.5 可以，原因是它偏 coding/落地视角，适合挑“这个 milestone 实际能不能实现/验收”。Gemini 作为 arbiter 更适合交叉综合与最终把关。

不过这里有一个实现约束：要真正保证三模型，最好新增 council 专用子代理角色并由 `sync` 生成，而不是临时口头让主 agent “扮演”。否则模型绑定不可审计。

## 回答 Q3：总 prompt 委派子代理 vs Node spawn 三次 coco

我倾向 **MVP 用一段总 prompt 委派 council 子代理**，不要 Node 层 spawn 三次 coco。

原因：

- 当前 `runCoco()` 没有模型参数，Node spawn 三次要先确认 coco CLI 是否稳定支持 `--model`，否则会引入工具耦合。
- 现有系统已经通过 `.trae/agents/*.md` 做模型绑定，沿用这个机制更符合架构。
- 一段总 prompt 可以要求主 agent 顺序委派：drafter → challenger → arbiter，并把全过程写入 `.loop/council.md`。
- exit code / artifact gate 仍由主进程检查 `.loop/roadmap.md` 和 `.loop/council.md`，不相信 stdout。

但为了让“多模型”不是口头承诺，MVP 需要补一个前置：**新增并同步 council 子代理定义**。

建议改 `sync.mjs` 的 ROLES，增加：

```text
roadmap-drafter     model=openrouter-3o
roadmap-challenger  model=GPT-5.5
roadmap-arbiter     model=Gemini-3.1-Pro
```

这三个 agent 的正文可以先由生成器内置最小说明，或复用新 skill（见下面 MVP 范围）。我倾向新建 3 个小 skill，避免把 challenge/arbiter 都套在 `loop-plan` 的正文里语义不清。

## 回答 Q4：`.loop/council.md` 结构

建议固定结构，便于人审和 arbiter 综合：

```markdown
## Council: <项目目标>

### Round 1 / Draft
- Author: roadmap-drafter
- Model: openrouter-3o

<初版 roadmap 摘要或完整草案>

### Round 1 / Challenge
- Author: roadmap-challenger
- Model: GPT-5.5

#### Keep
- ...

#### Modify
- Milestone: M1
  - Problem: ...
  - Proposed change: ...

#### Drop
- ...

#### Missing
- ...

### Round 1 / Synthesis
- Author: roadmap-arbiter
- Model: Gemini-3.1-Pro
- Decision: FINAL | NEEDS_ROUND_2 | ESCALATE_HUMAN

#### Applied changes
- ...

#### Remaining open questions
- ...

### Round 2 / Draft Revision
...

### Final Decision
- Verdict: APPROVE | ESCALATE_HUMAN
- Roadmap: .loop/roadmap.md
```

关键点：

- challenge 必须结构化输出 Keep / Modify / Drop / Missing。
- arbiter 必须明确 Decision。
- 最终如果无法定稿，仍写 `.loop/roadmap.md`，但把不确定项放 `Open Questions`，并 rc=2。

## 回答 Q5：2 轮上限与收敛判据

2 轮足够做 MVP。超过 2 轮通常说明需求不清或范围太大，应该升级人工，而不是继续烧配额。

收敛判据建议机器上只看 artifact，语义由 arbiter 判定：

1. arbiter 若认为 roadmap 已满足：
   - 写 `.loop/roadmap.md`
   - `.loop/council.md` Final Decision = APPROVE
   - 主进程再跑 B-roadmap-1 三条件
   - rc=0
2. arbiter 若认为需求仍不清：
   - 写 `.loop/roadmap.md`，包含 Open Questions
   - `.loop/council.md` Final Decision = ESCALATE_HUMAN
   - 如果 roadmap 过三条件，主进程返回 rc=2
3. 如果 2 轮结束仍没有 Final Decision：
   - rc=2

不建议让 Node 解析复杂语义；Node 只检查：

- `.loop/council.md` 非空；
- `.loop/roadmap.md` 过 B-roadmap-1；
- council 是否包含 `Verdict: ESCALATE_HUMAN`。

## 回答 Q6：模型不可用/超时降级策略

我不建议跳过某个 council 角色继续“假装 council 成功”。原因：council 的价值就在多模型质疑；少一环就不应该返回 0。

策略：

- `coco` 非 0 / 未生成 council / 未生成 roadmap：rc=1。
- 子代理未完成某段，主 agent 应在 `.loop/council.md` 写明缺失；若仍能产出含 Open Questions 的 roadmap，则 rc=2。
- 不做自动 fallback 到单 planner；如果用户想 fallback，可以手动再跑普通 `run roadmap`。

这样避免“用户以为经过 council，实际上没有 challenger”的黑盒风险。

## 回答 Q7：补充风险

我补充 8 个风险与收口：

1. **council 产物旧文件假成功**  
   开始前必须删除旧 `.loop/council.md` 和旧 `.loop/roadmap.md`。

2. **只生成 roadmap、没生成 council 记录**  
   `--council` 成功必须要求 `.loop/council.md` 非空；否则 rc=1。council 必须可审计。

3. **arbiter 写出不合格 roadmap**  
   复用 B-roadmap-1 三条件，不合格 rc=1。

4. **ESCALATE_HUMAN 被当成功**  
   如果 `.loop/council.md` 包含 `Verdict: ESCALATE_HUMAN`，即使 roadmap 结构合格，也 rc=2。

5. **新增 council 子代理导致 sync 漂移**  
   如果增加 `.agents/skills/roadmap-*` 或生成物，必须更新 templates，并让 `npm test` 的 check-templates 覆盖新增 skill。

6. **scope 膨胀到 plan council / chat**  
   本轮只做 roadmap council，不做单任务 plan council，不做交互式 chat。

7. **成本不可见**  
   `.loop/council.md` 记录最多 2 轮，文档提醒 council 成本高于普通 roadmap。

8. **版本发布节奏**  
   当前 package 已是 `0.2.0`，全部实现和复核后再统一提交/发布，符合用户“全部实现后再提交发布”的要求。

## 我建议的 MVP 范围

如果进入实现，我建议做：

1. `run roadmap "<项目>" --council` 参数解析。
2. 新增 `promptRoadmapCouncil(target)`。
3. 新增 `runRoadmapCouncilOnce(root, target)`：
   - 删除旧 `.loop/council.md` / `.loop/roadmap.md`。
   - 委派 council 子代理顺序工作。
   - 要求 `.loop/council.md` 非空。
   - 要求 `.loop/roadmap.md` 过 B-roadmap-1。
   - 若 council verdict 为 ESCALATE_HUMAN → rc=2。
4. 新增 council 子代理/skill，并纳入 sync：
   - `roadmap-drafter`
   - `roadmap-challenger`
   - `roadmap-arbiter`
5. 更新 README / templates/LOOP.md：说明普通 roadmap vs council roadmap。
6. 测试：
   - `--council` 删除旧 council/roadmap，coco 失败不假成功。
   - coco 成功但缺 council.md → rc=1。
   - 缺 roadmap 或 roadmap 缺标题 → rc=1。
   - council 写 `Verdict: ESCALATE_HUMAN` 且 roadmap 合格 → rc=2。
   - 成功路径 rc=0，roadmap+council 均存在，不写 plan/report/stage。

明确不做：

- 不做 `run council` 独立命令。
- 不做 plan 级 council。
- 不做交互式 plan-chat。
- 不做 Node spawn 多次模型进程。
- 不做 >2 轮或动态角色。

## 结论

我同意 Claude B 的大方向，并建议 MVP 定为：**`run roadmap --council` + 可审计 `.loop/council.md` + 最多 2 轮三角色子代理 + 最终仍产出 `.loop/roadmap.md` 并复用 B-roadmap-1 gate**。

唯一需要 Claude B 再确认的是：是否接受“通过新增 council 子代理/skill + 总 prompt 委派”的实现路线，而不是 Node 层 spawn 三次 coco。若同意，下一步写实现计划。

#### Claude B 回复区（第二轮：MVP 收敛复核）

<!-- Claude B 请复核 Claude A 的 council MVP 收敛；如同意，请明确是否进入实现计划。 -->

---

## Claude B 第二轮回复：同意 MVP 收敛 + 实现路线，补 2 点收口

我核对了关键事实：`coco -p` **没有 `--model` 命令行参数**（只有 `models` 子命令列模型），模型只能靠 `.trae/agents/*.md` frontmatter 绑定。**所以 Claude A 的路线判断正确**——Node spawn 三次 coco 无法精确控模型，必须走"新增 council 子代理 + sync 绑模型 + 总 prompt 委派"。我**接受这个实现路线**。

逐条确认：
- **Q1 命令形态 `run roadmap --council`**：同意（复用 roadmap 产物契约，心智简单）。
- **Q2 三角色命名 roadmap-drafter/challenger/arbiter + 模型分配**：同意，命名贴产物更清晰。
- **Q3 子代理+总prompt委派（不 Node spawn）**：**同意，且已用事实佐证**——coco 无 `--model`，spawn 路线行不通。新增 3 个 council 子代理由 sync 生成绑模型，是唯一能"真多模型"的路子。
- **Q4 `.loop/council.md` 结构（Round/Draft/Challenge[Keep/Modify/Drop/Missing]/Synthesis[Decision])**：同意，结构化挑刺 + 明确 Decision，可审计。
- **Q5 2 轮上限 + Node 只检 artifact（council.md 非空 / roadmap 过三条件 / 含 ESCALATE_HUMAN→rc2）语义交 arbiter**：同意，与"机检结构、语义人/arbiter 判"一脉相承。
- **Q6 不跳过角色假装成功、不自动 fallback 单 planner**：**强烈赞同**。council 价值就在多模型质疑，少一环就不该 rc=0，否则是黑盒欺骗。
- **Q7 八条风险**：全部认同，尤其 #1 删旧 council/roadmap、#2 council.md 必须非空（可审计）、#4 ESCALATE_HUMAN→rc2、#5 新 council 子代理要纳入 check-templates 防漂移。

### 补充 2 点收口

**B-council-1：新增 council 子代理必须同步进 templates + check-templates。**
新增 `roadmap-drafter/challenger/arbiter` 子代理(或 skill)后，`loop-system/templates/.agents/` 和生成的 `.trae/.claude/.codex/agents/` 都要更新，且 `lib/check-templates.mjs` 的覆盖范围要确认能抓到新增项的漂移。否则会出现"开发仓库改了 council 角色、npm 包 templates 没跟上"的双份真源漂移（我们 npm 化时专门防过这个）。实现时务必跑 `sync --check` 确认零漂移。

**B-council-2：成本要在 help/README 显式警示。**
配额是真实约束（当前 openrouter-3o 已用到较高水位）。council 一次最多烧 draft+challenge+arbiter × 2 轮 = 最多 6 次模型调用，远高于普通 roadmap 的 1 次。README/help 必须写明"`--council` 成本显著高于普通 roadmap，建议仅对重要项目使用"。这不阻塞实现，但要写进文档。

### 其余确认
- MVP 范围（--council 解析 / promptRoadmapCouncil / runRoadmapCouncilOnce / 3 个 council 子代理 / 文档 / 6 条测试）：同意。
- 不做 run council 独立命令 / plan 级 council / plan-chat / Node spawn / >2轮：同意，范围干净。
- 测试 6 条（删旧不假成功 / 缺 council.md→1 / 缺 roadmap 或缺标题→1 / ESCALATE_HUMAN+roadmap合格→2 / 成功 rc0 且不写 plan/report/stage）：同意，精确覆盖。

### 结论

**同意 council MVP 收敛 + "子代理+总prompt委派"实现路线，可进入实现计划。** 带上 B-council-1（council 子代理纳入 templates+check-templates，实现后跑 sync --check 验零漂移）和 B-council-2（成本警示写文档）。

请 Claude A 据此写实现计划，确认后落代码。

#### Claude A 回复区（第三轮：实现计划）

我认同 Claude B 第二轮所有收口，尤其两点事实约束：`coco -p` 无 `--model`，所以不能 Node spawn 三次精确控模型；必须走“新增 council 子代理 + sync 生成模型绑定 + 总 prompt 委派”的路线。下面给出实现计划；本回复只写计划，不落代码。

## Claude A 实现计划草案：roadmap council MVP

### 目标

新增 roadmap 的多模型磋商模式：

```bash
loop-system run roadmap "<项目目标>" --council
```

它执行最多 2 轮 draft → challenge → arbiter/synthesize 的规划磋商，写入：

- `.loop/council.md`：可审计的磋商记录。
- `.loop/roadmap.md`：最终项目级 roadmap，继续复用 B-roadmap-1 三条件。

最终仍只产生项目级规划产物，不写 `.loop/plan.md` / `.loop/verifier-report.md`，不触发 execute/watch。

### 影响文件

预计新增/修改：

#### 新增 council skills（根与 npm templates 各一份）

- `.agents/skills/roadmap-draft/SKILL.md`
- `.agents/skills/roadmap-challenge/SKILL.md`
- `.agents/skills/roadmap-arbitrate/SKILL.md`
- `loop-system/templates/.agents/skills/roadmap-draft/SKILL.md`
- `loop-system/templates/.agents/skills/roadmap-challenge/SKILL.md`
- `loop-system/templates/.agents/skills/roadmap-arbitrate/SKILL.md`

命名使用 skill 动词，生成出的 agent 使用：

- `roadmap-drafter`
- `roadmap-challenger`
- `roadmap-arbiter`

#### 修改 sync / check 相关

- `loop-system/lib/sync.mjs`
  - `SKILLS` 增加三个 roadmap council skills。
  - `ROLES` 增加三个 council agents：
    - `roadmap-drafter | roadmap-draft | openrouter-3o | no | Read, Write, Grep, Glob, Bash`
    - `roadmap-challenger | roadmap-challenge | GPT-5.5 | no | Read, Write, Grep, Glob, Bash`
    - `roadmap-arbiter | roadmap-arbitrate | Gemini-3.1-Pro | no | Read, Write, Grep, Glob, Bash`
  - worktree=false：这些角色只写 `.loop/council.md` / `.loop/roadmap.md`，不改源码。
- `loop-system/lib/check-templates.mjs`
  - 当前自动枚举根 `.agents/skills/*` 与 templates skills，理论上无需硬编码修改；实现后用测试/运行确认新增 skill 被覆盖。

#### 修改 run / CLI / 文档

- `loop-system/lib/run.mjs`
  - `run roadmap` 支持 `--council` 参数。
  - 新增 `promptRoadmapCouncil(target)`。
  - 新增 `runRoadmapCouncilOnce(root, target)`。
- `loop-system/bin/loop.mjs`
  - help 增加 `run roadmap "<项目>" --council`。
- `loop-system/README.md`
  - 增加 council 用法和成本警示。
- `loop-system/templates/LOOP.md`
  - 增加 council 用法、产物、成本警示。
- `loop-system/test/council.test.mjs`（新增）
  - 覆盖 council gate。

#### 生成物

运行：

```bash
node loop-system/bin/loop.mjs sync
```

或等价方式，生成/更新：

- `.trae/skills/roadmap-*`
- `.claude/skills/roadmap-*`
- `.codex/skills/roadmap-*`
- `.trae/agents/roadmap-drafter.md`
- `.trae/agents/roadmap-challenger.md`
- `.trae/agents/roadmap-arbiter.md`
- `.claude/agents/...`
- `.codex/agents/...`

然后跑：

```bash
node loop-system/bin/loop.mjs sync --check
npm test --prefix loop-system
```

确保 B-council-1 的 templates + check-templates 无漂移。

### Council skill 职责

#### `roadmap-draft`

职责：根据项目目标生成初版 roadmap 草案，强调垂直切片与可验收里程碑。

输出要求：

- 写入 `.loop/council.md` 的 `### Round N / Draft` 段。
- 不写源码。
- 不写 `.loop/plan.md`。

#### `roadmap-challenge`

职责：审查 draft，找问题，不直接改 roadmap。

必须输出结构：

```markdown
#### Keep
#### Modify
#### Drop
#### Missing
```

重点挑刺：

- milestone 是否过大；
- 是否水平分层；
- 是否缺验收；
- 是否依赖不清；
- 是否存在 Open Questions。

#### `roadmap-arbitrate`

职责：综合 draft + challenge，产出最终 `.loop/roadmap.md`，并在 `.loop/council.md` 写 Final Decision。

Decision：

```markdown
- Verdict: APPROVE | ESCALATE_HUMAN
```

若需求不明确：

- roadmap 仍应包含 `## Roadmap:` 与 `### Milestones`；
- 不确定项写入 `### Open Questions`；
- council Final Decision 写 `Verdict: ESCALATE_HUMAN`；
- 主命令返回 rc=2。

### `promptRoadmapCouncil(target)` 文案

总 prompt 负责顺序委派：

1. 清楚说明最多 2 轮。
2. 委派 `@roadmap-drafter` 写 Draft 段。
3. 委派 `@roadmap-challenger` 写 Challenge 段。
4. 委派 `@roadmap-arbiter` 综合：
   - 若可定稿：写 `.loop/roadmap.md` + Final Decision APPROVE。
   - 若仍不明确且未超过 2 轮：再进行一轮。
   - 若 2 轮后仍不明确：写含 Open Questions 的 `.loop/roadmap.md` + Final Decision ESCALATE_HUMAN。
5. 全程必须写 `.loop/council.md`。
6. 不写 `.loop/plan.md` / `.loop/verifier-report.md` / `.loop/stage/*`。

### `runRoadmapCouncilOnce(root, target)` 行为

1. 删除旧：
   - `.loop/council.md`
   - `.loop/roadmap.md`
2. 调 `runCoco(promptRoadmapCouncil(target), READONLY_TOOLS)`。
3. coco 非 0 → rc=1。
4. `.loop/council.md` 缺失或为空 → rc=1。
5. `.loop/roadmap.md` 缺失或为空 → rc=1。
6. roadmap 缺 `## Roadmap:` 或 `### Milestones` → rc=1。
7. council 包含 `Verdict: ESCALATE_HUMAN` → rc=2。
8. 否则 rc=0。

注意：不解析 `Open Questions`，不做 milestone 语义机检。

### 参数解析

当前 `run(args)` 通过 `target = args.slice(1).join(' ')` 拼目标。为了支持 `--council`，需要最小解析：

- `loop-system run roadmap --council "目标"`
- `loop-system run roadmap "目标" --council`

两种都支持。

规则：

- 只在 `mode === 'roadmap'` 时识别 `--council`。
- 从 target tokens 中过滤 `--council`。
- 若过滤后 target 为空 → 用法错误 rc=1。
- 其他命令不解析 `--council`，避免影响 `run plan/fix`。

### 文档更新

#### README

增加：

```bash
# 普通项目级拆分：一次 planner 调用
loop-system run roadmap "从 0 构建一个待办事项 Web 应用"

# 多模型磋商版：成本更高，仅建议重要项目使用
loop-system run roadmap "从 0 构建一个待办事项 Web 应用" --council
```

说明：

- `--council` 最多 2 轮；可能触发最多 6 次模型调用；成本明显高于普通 roadmap。
- 产物：`.loop/council.md` + `.loop/roadmap.md`。
- 如果 council verdict 为 `ESCALATE_HUMAN`，先处理 Open Questions，不要无人值守执行。

#### templates/LOOP.md

增加同样说明，强调 council 是 roadmap 增强，不是执行队列。

### 测试计划

新增 `loop-system/test/council.test.mjs`，用 fake `coco` 覆盖：

1. **旧产物不假成功**
   - 预置旧 `.loop/council.md` + `.loop/roadmap.md`。
   - fake coco exit 1。
   - 执行 `run roadmap --council`。
   - 预期 rc=1，旧产物已删除或不被视为成功。

2. **缺 council.md → rc=1**
   - fake coco 写合格 roadmap，但不写 council。
   - 预期 rc=1。

3. **缺 roadmap 或 roadmap 缺标题 → rc=1**
   - fake coco 写 council，但 roadmap 缺 `### Milestones`。
   - 预期 rc=1。

4. **ESCALATE_HUMAN → rc=2**
   - fake coco 写合格 roadmap + council 包含 `Verdict: ESCALATE_HUMAN`。
   - 预期 rc=2。

5. **成功路径 → rc=0**
   - fake coco 写合格 roadmap + council 包含 `Verdict: APPROVE`。
   - 预期 rc=0。
   - `.loop/plan.md` 不存在。
   - `.loop/verifier-report.md` 不存在。
   - `.loop/stage` 不被创建或不含本轮产物。

6. **参数位置兼容**
   - `run roadmap --council "目标"` 与 `run roadmap "目标" --council` 都能进入 council 路径。

回归验证：

```bash
npm test --prefix "/home/bytedance/codes/Loop Engineering/loop-system"
node "/home/bytedance/codes/Loop Engineering/loop-system/bin/loop.mjs" sync --check
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

### 风险与收口

- 不跳过任一 council 角色假装成功。
- 不 fallback 到普通 roadmap。
- `council.md` 必须非空，保证可审计。
- `roadmap.md` 仍复用 B-roadmap-1。
- `ESCALATE_HUMAN` 为 rc=2，不能当成功。
- 新 skills 必须同步到 templates；`check-templates` 和 `sync --check` 必须通过。
- 文档必须提示成本。

### 结论

实现计划已纳入 B-council-1 / B-council-2。我与 Claude B 当前无实质分歧。若 Claude B 同意该计划，下一步进入实现：先写 failing tests，再补 council skills/sync、`run roadmap --council`、文档与验证。

#### Claude B 回复区（实现计划复核）

<!-- Claude B 请复核实现计划；如同意，请明确“同意进入实现”。 -->

---

## Claude B 复核实现计划：同意进入实现（含 1 个实现提醒）

实现计划完整、准确纳入 B-council-1/2。我核对了两处关键事实，逐项确认：

- **check-templates 自动枚举**：已确认 `lib/check-templates.mjs` 用 `readdirSync` 枚举 skill 目录（非硬编码），所以新增 `roadmap-draft/challenge/arbitrate` 三个 skill 会被**自动纳入漂移检查**，B-council-1 天然满足——前提是 templates 同步了。✅ Claude A 判断正确。
- **三 council 角色 worktree=false**：合理，它们只写 `.loop/council.md` / `.loop/roadmap.md`，不改源码，不需 worktree 隔离。✅

### 1 个实现提醒（不是分歧，是别踩的坑）

**B-council-3：`sync.mjs` 的 `SKILLS` 是硬编码数组，新增 council skill 必须手动加进去。**
我看了 `lib/sync.mjs:7`：`const SKILLS = ['loop-triage','loop-plan','loop-execute','minimal-fix','loop-verifier']`——这是**硬编码**的。新增 `roadmap-draft/challenge/arbitrate` 后，必须：
1. 加进 `SKILLS` 数组（否则 sync 不会把它们复制到 .trae/.claude/.codex）；
2. 加进 `ROLES`（生成三个 council 子代理）。
check-templates 虽自动枚举，但它比的是"根 .agents vs templates"——如果 SKILLS 漏加，sync 不复制，两边可能都缺，反而测不出。所以**实现时务必：改 SKILLS+ROLES → 在根 .agents 和 templates 各放 3 个 SKILL.md → 跑 sync 生成 → 跑 sync --check 确认零漂移**。Claude A 计划里已提到要跑 sync --check，这点补充强调 SKILLS 数组别漏。

### 其余确认
- **命令 `run roadmap --council`（两种参数位置都支持）**：同意，过滤 `--council`、空 target→rc1、其他命令不解析 --council（不污染 run plan/fix）。✅
- **runRoadmapCouncilOnce 八步**（删旧 council+roadmap → coco非0→1 → council缺失→1 → roadmap缺失→1 → roadmap缺标题→1 → council含ESCALATE_HUMAN→2 → 否则0）：同意，gate 顺序正确，复用 B-roadmap-1 三条件。✅
- **三 council skill 职责**（draft 出稿 / challenge 结构化 Keep·Modify·Drop·Missing / arbiter 综合+Final Decision）：同意，可审计。✅
- **不跳过角色、不 fallback、council.md 必须非空、ESCALATE_HUMAN→rc2、文档警示成本**：同意。✅
- **6 条测试**（旧产物不假成功 / 缺council→1 / 缺roadmap或缺标题→1 / ESCALATE_HUMAN→2 / 成功rc0且不写plan·report·stage / 参数位置兼容）：同意，精确覆盖。✅
- **回归验证含 `sync --check`**：同意（正是 B-council-1 的验证手段）。✅

### 结论

**同意进入实现。** 带上 B-council-3（SKILLS+ROLES 都要加 council 项，实现后跑 sync --check 验零漂移）。实现顺序按计划：failing tests(RED) → 3 个 council skill(根+templates) + sync SKILLS/ROLES → run.mjs（promptRoadmapCouncil/runRoadmapCouncilOnce/--council 解析）→ 生成物 sync → 测试转 GREEN → help/README/LOOP.md → npm test + sync --check + pack --dry-run 回归。落地后我做独立复核（fake coco 实测 6 条 + sync --check 零漂移 + 不写 plan/report/stage）。

#### Claude A 实现记录区

<!-- Claude A 实现后在此记录改动与验证结果，等待 Claude B 复核。 -->

---

## Claude A 实现记录：council MVP 已落地，等待 Claude B 独立复核

按 TDD 顺序完成：先写 `test/council.test.mjs`，确认 RED；再实现 council skills / sync / run.mjs / docs，最后验证 GREEN。

### RED 记录

先运行：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/council.test.mjs
```

结果：6 条 council 测试中 4 条失败，失败点正是未实现 `--council` 的预期差异：

- stale council 未删除；
- 缺 `.loop/council.md` 未失败；
- `ESCALATE_HUMAN` 未映射 rc=2；
- `--council` 参数未过滤导致 prompt 泄漏。

### 实现改动

1. 新增 3 个 council skill 真源与模板：
   - `.agents/skills/roadmap-draft/SKILL.md`
   - `.agents/skills/roadmap-challenge/SKILL.md`
   - `.agents/skills/roadmap-arbitrate/SKILL.md`
   - `loop-system/templates/.agents/skills/roadmap-draft/SKILL.md`
   - `loop-system/templates/.agents/skills/roadmap-challenge/SKILL.md`
   - `loop-system/templates/.agents/skills/roadmap-arbitrate/SKILL.md`

2. 更新 `loop-system/lib/sync.mjs`：
   - `SKILLS` 加入 `roadmap-draft` / `roadmap-challenge` / `roadmap-arbitrate`，落实 B-council-3。
   - `ROLES` 加入：
     - `roadmap-drafter ← roadmap-draft ← openrouter-3o`
     - `roadmap-challenger ← roadmap-challenge ← Gemini-3.1-Pro`
     - `roadmap-arbiter ← roadmap-arbitrate ← GPT-5.5`
   - 三个 council role 均 `worktree=false`。

3. 运行 `loop-system sync` 生成：
   - `.trae/.claude/.codex` 下三套 council skill；
   - `.trae/.claude/.codex` 下三个 council agent；
   - 现有生成物的 generated note 也统一为 `generated by loop-system sync`。

4. 更新 `loop-system/lib/run.mjs`：
   - 新增 `promptRoadmapCouncil(target)`。
   - 新增 `checkRoadmapArtifact(root, label)`，普通 roadmap 与 council 复用 B-roadmap-1 三条件。
   - 新增 `runRoadmapCouncilOnce(root, target, ts)`：
     1. 删除旧 `.loop/council.md` / `.loop/roadmap.md`；
     2. coco 非 0 → rc=1；
     3. `.loop/council.md` 缺失/空 → rc=1；
     4. `.loop/roadmap.md` 缺失/空 → rc=1；
     5. roadmap 缺 `## Roadmap:` 或 `### Milestones` → rc=1；
     6. council 含 `## Verdict: ESCALATE_HUMAN` → rc=2；
     7. 否则 rc=0。
   - `run roadmap` 参数解析仅对 roadmap 模式识别 `--council`，支持：
     - `loop-system run roadmap --council "目标"`
     - `loop-system run roadmap "目标" --council`
   - `--council` 被过滤，不进入 target / prompt。

5. 更新文档与 help：
   - `loop-system/bin/loop.mjs` help 增加 `run roadmap --council`。
   - `loop-system/README.md` 增加 Council Roadmap 说明与成本警示。
   - `loop-system/templates/LOOP.md` 增加 Council Roadmap 说明、成本警示、skills 列表更新。

### GREEN / 回归验证

单测：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/council.test.mjs
```

结果：6/6 pass。

全量测试：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm test
```

结果：15/15 pass，包含：

- council 6 条；
- roadmap 4 条；
- watch 5 条；
- `check-templates` 自动覆盖新增 3 个 council skill，全部 `[ok]`。

sync 漂移检查：

```bash
cd "/home/bytedance/codes/Loop Engineering" && node loop-system/bin/loop.mjs sync --check
```

结果：PASS，所有 `.trae/.claude/.codex` skills 与 agents 均 `[ok]`，包含 3 个 council role，无漂移。

npm pack dry-run：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

结果：成功，tarball 共 25 files，包含新增 3 个 template skill，不含 `.loop/` 运行态产物。

### 请 Claude B 复核重点

请重点复核：

1. `--council` 是否只污染 roadmap 模式，不影响 plan/fix/watch。
2. `runRoadmapCouncilOnce` gate 顺序是否符合 B-council-1/2/3。
3. `.loop/council.md` 非空 + `ESCALATE_HUMAN → rc=2` 是否正确。
4. 普通 roadmap 是否仍只写 `.loop/roadmap.md`，不引入 council 行为。
5. sync / templates / generated agents 是否无漂移。

#### Claude B 回复区（实现复核）

<!-- Claude B 请独立复核实现与验证结果；如通过，请明确“实现通过”。 -->

---

## Claude B 实现复核：实现通过

读 run.mjs/sync.mjs diff + 用 fake coco 在临时项目独立实测。逐条复核 5 点：

| 复核点 | 验证 | 结果 |
|--------|------|------|
| 1. --council 只污染 roadmap 模式 | run.mjs:278 `mode==='roadmap' && includes('--council')`；plan/fix/watch 不解析 | ✅ |
| 2. runRoadmapCouncilOnce gate 顺序 | 删旧council+roadmap → coco非0→1 → council缺→1 → roadmap缺/缺标题→1 → ESCALATE_HUMAN→2 → 否则0 | ✅ 符合 B-council-1/2/3 |
| 3. council 非空 + ESCALATE_HUMAN→rc2 | fake coco 实测：缺council→rc1；含 `## Verdict: ESCALATE_HUMAN`→rc2 | ✅ |
| 4. 普通 roadmap 不引入 council 行为 | 普通 roadmap 仍只写 roadmap.md（checkRoadmapArtifact 复用，无 council 逻辑） | ✅ |
| 5. sync/templates/generated 无漂移 | 仓库根 `sync --check` PASS，含 3 个 council role | ✅ |

独立实测补充：
- 成功路径 rc=0，且**不写 plan/report/stage**（硬边界守住）✅
- 参数兼容：`--council "目标"` 与 `"目标" --council` 都进 council 路径，rc=0 ✅
- 三角色模型绑定：drafter=openrouter-3o / challenger=Gemini-3.1-Pro / arbiter=GPT-5.5 ✅
  - 注：challenger/arbiter 模型与我初稿对调（challenger=Gemini、arbiter=GPT-5.5），合理，不影响功能（arbiter 综合定稿用 coding 模型可行）。
- `npm test` 15/15 pass（council 6 + roadmap 4 + watch 5），check-templates 自动覆盖新 3 skill ✅
- B-council-3 落实：SKILLS+ROLES 都加了 council 项，sync --check 零漂移 ✅

### 结论

**实现通过。** council MVP 全部落地并独立验证：多模型真绑定（三角色三模型）、council.md 可审计、ESCALATE_HUMAN→rc2、复用 B-roadmap-1、硬边界守住、零回归、零漂移。双 agent 一致，可提交收尾。

至此 plan-council（多模型磋商规划）完成。用户"从 0 建项目 + 多模型磋商"诉求的工具链已齐：`run roadmap --council`（多模型磋商出里程碑）→ 人审 → 逐 milestone `run plan`/`run fix`。

### 后续议题（用户提出，记录待办，非本轮）

**loop-system 内置"循环等待/重试"能力**：用户指出模型常需排队，watch 的"轮询等待上游"机制很实用；建议让 loop-system 的命令（尤其 run plan/fix/roadmap/council 这些调 coco 的）也具备"遇排队/瞬时失败时按间隔循环等待重试"的能力，类似 watch 的 `--interval/--timeout`。这是独立增强，值得单独一轮 dialogue 设计（要考虑：区分"可重试的排队/超时" vs "真失败"、重试上限、退出码语义、不破坏现有 gate）。本轮不做。
