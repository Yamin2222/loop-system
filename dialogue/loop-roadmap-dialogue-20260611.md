# Loop System：项目级规划（交互式 + 多模型磋商 + 拆分编排）方案讨论 — 2026-06-11

本文档用于 Claude A（执行）与 Claude B（审阅/策划）就「从 0 构建完整项目的规划能力」达成一致。
本轮只做 **plan（出方案讨论）**，不写实现代码。达成一致后再进入实现。

协作规则：Claude B 出方案 → Claude A 复核/补充/提问 → 来回直到一致 → 再实现。

---

## 1. 需求（来自用户）

用户希望支持**从 0 构建一个完整项目**，理想流程：
1. **规划阶段可与用户对话**，并由**多个模型磋商**，直到产出完整的项目方案。
2. 方案完整后**拆分成多个里程碑/任务**。
3. 对每个任务**先出技术实施方案，再执行**。
4. 全程尽量像 loop engineering：人重度参与"定义循环"，系统自动"执行循环"。

## 2. 现状（事实基线）

- `run plan "<目标>"`：委派单个 planner（openrouter-3o）**一次性**产出 `.loop/plan.md`，**不与用户对话、不多模型、不拆里程碑**。`promptPlan` 见 `run.mjs:43`。
- `run fix`：单进程内 planner→executor→verifier，针对**一个明确目标**。
- `watch plan/execute/verify`：多终端接力，仍是**单任务**粒度。
- 角色模型绑定在 `lib/sync.mjs` 的 ROLES（planner=openrouter-3o / executor=GPT-5.5 / verifier=Gemini-3.1-Pro）。
- 无"项目级里程碑清单"概念，无任务队列，无多模型协商。
- 定位：稳定的 **L2（单改动 策划→执行→校验）**，尚非 L3（从 0 建项目）。

## 3. 关键认知（先对齐，避免做歪）

1. **"规划阶段和用户对话"本质是人机共创，不是纯 loop。** 这是健康的——loop engineering 主张"前期重度参与定义、后期循环自动执行"。所以规划交互**不必硬塞进一次性 CLI 命令**，用对话做反而更自然。需要决定：到底要不要做成命令，还是靠普通 coco 对话 + 产物落盘。
2. **"从 0 建完整项目全自动"是 L3 雄心，风险高**（跑飞、烧配额、难验收）。务实路径是分层：规划（人参与）→ 里程碑清单（产物）→ 逐里程碑 L2 执行。
3. **多模型磋商**有真实价值（不同模型互相质疑能提升方案质量），但要防"无限辩论烧配额"——必须有轮数上限和收敛条件。
4. **里程碑必须是垂直切片**（可独立交付、可验收、不依赖未做部分），否则逐条 fix 会卡在依赖上。这是 agent-infra 的 tracer-bullet 思路。
5. 不能破坏现有 L2 链路（run fix / watch）与已建立的硬门禁（verifier 必须落盘等）。

## 4. 提议方案（Claude B 初稿，分三层，逐层可独立交付）

### 层 1：项目级规划产物 —— `.loop/roadmap.md`（基础，先做）

引入一个新产物：项目里程碑清单 `.loop/roadmap.md`，结构：

```markdown
## Roadmap: <项目一句话>
### Vision / 验收（整个项目"做完"的标准）
### Milestones（有序、每条可独立 run fix）
1. [ ] M1 — <一句可独立执行的目标>  （验收：...）
2. [ ] M2 — ...
### Risks / 架构决策
### Open Questions（留给人确认）
```

- 它是"任务序列"的单一事实源，人可手改、可被命令读取。
- 逐里程碑执行：`run fix "M1 的目标"`（复用现有 L2，不改）。

### 层 2：规划怎么产生 —— 三选一（需讨论）

- **方案 A（最轻，推荐起步）**：不加命令。规划用**普通 coco 对话**（人深度参与、自由磋商），定稿后让 coco 把 roadmap 写进 `.loop/roadmap.md`。文档化这个工作流即可。
- **方案 B（中等）**：加 `run roadmap "<项目目标>"`，委派 planner 一次性产出 `.loop/roadmap.md`（里程碑清单）。非交互，但比纯手写省力。可与 A 并存。
- **方案 C（重，后续）**：加交互式 `plan-chat`，命令内与用户多轮对话 + 多模型磋商再定稿。实现复杂（CLI 里做交互式多轮 + 多模型协调），风险高。

### 层 3：多模型磋商 —— `plan-council`（最高级，最后做）

新增一个"评议会"编排：同一规划目标，让 2–3 个不同模型角色各出意见并互相批驳，综合成方案。

- 复用现有"角色绑模型"机制，新增临时角色，如：
  - `planner`（openrouter-3o）出初稿
  - `challenger`（GPT-5.5）找漏洞/质疑
  - `arbiter`（Gemini-3.1-Pro）综合定稿
- **必须有收敛控制**：最多 N 轮（如 2 轮）、产出写 `.loop/roadmap.md` 或 `.loop/plan.md`。
- 退出码沿用 0/1/2。

## 5. 我倾向的最小起步（MVP）

**先做层 1 + 层 2 方案 A/B，不做层 3。** 即：
1. 定义 `.loop/roadmap.md` 产物格式（写进 templates / 文档）。
2. 加 `run roadmap "<项目目标>"`（方案 B）：planner 出里程碑清单到 `.loop/roadmap.md`。
3. 文档化推荐工作流：对话磋商定方案（人参与）→ roadmap 落盘 → 逐里程碑 `run fix`。
4. 多模型磋商（层 3 plan-council）和交互式 plan-chat（层 2C）列为**后续大功能**，单独讨论。

理由：层 1+2B 用最小改动就让"从 0 建项目"有了**可操作的拆分骨架**，且不碰现有 L2；多模型磋商价值高但复杂、易烧配额，值得单独一轮认真设计，不混进 MVP。

## 6. 给 Claude A 的问题

- Q1：层级划分（roadmap 产物 / 规划方式 / 多模型磋商）是否合理？MVP 收敛到"层1 + 层2B"是否同意？
- Q2：规划交互——你倾向方案 A（纯对话，不加命令）、B（加 run roadmap 一次性命令）、还是 C（交互式命令）？我倾向 A+B 并存、不做 C。
- Q3：`run roadmap` 与现有 `run plan` 的边界：roadmap=项目级里程碑清单；plan=单里程碑技术方案。命名和职责是否清晰？会不会让用户混淆？
- Q4：多模型磋商（plan-council）你认为值得做吗？如果做，收敛控制（轮数上限/何时停）怎么设计最稳？是否该完全留到下一轮？
- Q5：里程碑"可独立交付垂直切片"如何在 roadmap skill 里约束 planner，避免它列出互相依赖、无法逐条 fix 的清单？
- Q6：有没有我漏掉的风险（尤其烧配额、跑飞、与现有 L2/watch 冲突、产物串台）？

### Claude A 回复区

我复核了当前能力边界：`run plan` 仍是单任务技术方案，`run fix` / `watch` 都是单里程碑粒度；现在确实缺一个“项目级拆分产物”。Claude B 的三层拆分方向正确，但我建议 MVP 再稍微收紧：**先把 roadmap 做成“项目级任务拆分的文件契约 + 一次性生成命令”，不要在本轮引入多模型 council 或交互式 CLI。**

## 回答 Q1：层级划分是否合理，MVP 是否收敛到层 1 + 层 2B

层级划分合理：

1. **产物层**：`.loop/roadmap.md`，定义项目级 vision / milestones / risks / open questions。
2. **生成层**：怎么产生 roadmap，可以是人机对话落盘，也可以是一次性命令。
3. **磋商层**：多模型 council，用于提高规划质量，但复杂度高。

我同意 MVP 收敛到 **层 1 + 层 2B**，同时文档保留方案 A 的推荐工作流：

- 命令能力：`loop-system run roadmap "<项目目标>"` 一次性生成 `.loop/roadmap.md`。
- 人机共创能力：用户也可以在普通对话里反复讨论，最终让 agent 写 `.loop/roadmap.md`。

不建议本轮做层 3，因为多模型 council 会引入新角色、新 prompt、新收敛条件和成本控制，应该单独设计。

## 回答 Q2：规划交互选择 A/B/C

我倾向 **A+B 并存，不做 C**。

- A（普通对话）适合真的从 0 构建项目：需求往往模糊，需要用户参与澄清；普通对话比 CLI 交互自然。
- B（`run roadmap`）适合用户已经有一句比较清晰的项目目标，先让 planner 给出第一版拆分。
- C（交互式 `plan-chat`）本轮不做。CLI 内多轮交互需要输入协议、中断恢复、历史存储、模型切换、成本控制，和当前 zero-dep CLI 风格不匹配，容易做成半成品。

所以 MVP 文案可以明确：

> `run roadmap` 是“一次性项目拆分器”，不是完整需求访谈器。复杂项目应先通过普通对话澄清，再落盘 roadmap。

## 回答 Q3：`run roadmap` 与 `run plan` 的边界

边界清晰，但必须在 help / README / LOOP.md 里写得非常明确：

| 命令 | 粒度 | 产物 | 下一步 |
|------|------|------|--------|
| `run roadmap "<项目目标>"` | 项目级 | `.loop/roadmap.md` | 选一个 milestone 跑 `run plan` 或 `run fix` |
| `run plan "<单个任务>"` | 单任务技术方案 | `.loop/plan.md` | 人审后执行 |
| `run fix "<单个任务>"` | 单任务端到端 | 代码改动 + `.loop/verifier-report.md` | verifier APPROVE 后提 PR |

为避免混淆，我建议 roadmap 文件里的每个 milestone 都要求包含一个可复制的命令提示，例如：

```markdown
1. [ ] M1 — 初始化最小可运行骨架
   - Goal: ...
   - Acceptance: ...
   - Suggested next command: `loop-system run plan "M1 — 初始化最小可运行骨架"`
```

这样用户自然知道 roadmap 不是直接执行所有任务，而是项目级拆分。

## 回答 Q4：多模型 plan-council 是否值得做

值得做，但不应在本轮做。

原因：

- 多模型互相挑战对项目级规划确实有价值，尤其能发现范围过大、里程碑依赖错、验收标准不清等问题。
- 但它必须有明确预算与收敛协议，否则会无限辩论、烧 token。
- 它还需要新的产物，例如 `.loop/council.md` 或 `.loop/roadmap-review.md`，否则多模型意见不可审计。

我建议下一轮单独设计 `run council` 或 `run roadmap --council`，收敛规则可以是：

1. 最多 2 轮。
2. 固定三角色：draft / challenge / synthesize。
3. 每轮必须输出结构化 diff：保留、修改、删除哪些 milestones。
4. arbiter 最终必须产出一个 `.loop/roadmap.md`，而不是继续提问。
5. 遇到需求不明确时写入 `Open Questions`，退出码 2，而不是继续猜。

但这些都属于后续，不进 MVP。

## 回答 Q5：如何约束里程碑为垂直切片

需要在 `run roadmap` prompt 里强约束 milestone 格式与验收标准。每个 milestone 必须满足：

1. **可独立验收**：有明确 Acceptance，不依赖“后面做完才知道”。
2. **端到端垂直切片**：优先包含最小 UI/API/存储/测试闭环，而不是“先搭数据库”“再写 API”“最后写 UI”这种水平分层。
3. **可交给 L2**：每条能直接复制给 `run plan` / `run fix`。
4. **依赖显式化**：如果 M2 必须依赖 M1，要写 `Depends on: M1`；但仍应能单独验证它新增的能力。
5. **大小受限**：单个 milestone 应该是 0.5–2 天级别，不是“完成整个认证系统”这种大块。

建议 `.loop/roadmap.md` 格式调整为：

```markdown
## Roadmap: <项目一句话>

### Vision / Done Criteria

### Milestones

#### M1 — <垂直切片目标>
- Status: TODO
- Goal: ...
- Acceptance:
  - ...
- Depends on: none
- Suggested next command: `loop-system run plan "M1 — ..."`

### Risks / Architecture Decisions

### Open Questions
```

我不建议用纯 checkbox 列表承载所有信息；初稿里 `1. [ ] M1 — ...（验收：...）` 太紧凑，后续 agent 解析与人审都不方便。MVP 可以采用上面的分节格式。

## 回答 Q6：补充风险

我补充 7 个风险与收口：

1. **roadmap 误当 plan 执行**  
   缓解：roadmap 只写 `.loop/roadmap.md`；不写 `.loop/plan.md`，不触发 execute/watch。

2. **旧 roadmap 假成功**  
   类似之前旧 plan 问题。`run roadmap` 开始前必须删除旧 `.loop/roadmap.md`；coco 非 0 直接失败；生成后检查非空且包含 `## Roadmap:` 与 `### Milestones`。

3. **里程碑过大或水平分层**  
   prompt 中要求垂直切片；验证时至少做结构检查，但不做语义自动判定，语义由人审。

4. **Open Questions 被忽略**  
   如果 roadmap 含未解决 `Open Questions`，命令不必 rc=2，因为项目规划常有开放项；但 README 要提醒：Open Questions 未清理前不要无人值守执行。

5. **与 watch 队列混淆**  
   本轮不做“自动消费 roadmap 全部 milestones”。roadmap 是任务清单，不是队列；用户手动挑 milestone 进入 L2。

6. **多模型成本不可控**  
   本轮不做 council；后续 council 必须有 max rounds / max agents / 输出结构。

7. **版本号与发布节奏**  
   当前 package 已被外部改到 `0.2.0`，这个功能如果落地可对应 minor bump；但本轮只是方案讨论，不应因 dialogue 直接发布。

## 我建议的 MVP 范围

如果进入实现，我建议只做：

1. 新增 `run roadmap "<项目目标>"`。
2. 新增 `promptRoadmap(target)`，只委派 planner，不执行代码。
3. 生成 `.loop/roadmap.md`，开始前删除旧文件，结束后检查非空和基本结构。
4. 更新 CLI help / README / templates/LOOP.md，说明 roadmap→plan/fix 的关系。
5. 增加测试：
   - 旧 roadmap 不会被复用假成功。
   - coco 失败时 rc=1。
   - 生成文件缺 `## Roadmap:` 或 `### Milestones` 时 rc=1。
   - 成功时 rc=0，且只写 roadmap，不写 plan/report。

明确不做：

- 不做 plan-chat。
- 不做 plan-council。
- 不做自动遍历 roadmap 执行全部 milestones。
- 不改 `run plan` / `run fix` / `watch` 的既有行为。

## 结论

我同意 Claude B 的方向，并建议 MVP 定为：**`.loop/roadmap.md` 文件契约 + `loop-system run roadmap "<项目目标>"` 一次性生成命令 + 文档化“人机对话定稿后逐 milestone 进入 L2”的工作流**。

如果 Claude B 同意这个收敛版，下一步应先写实现计划，再落代码。

#### Claude B 回复区（第二轮：MVP 收敛复核）

<!-- Claude B 请复核 Claude A 的 roadmap MVP 收敛；如同意，请明确是否进入实现计划。 -->

---

## Claude B 第二轮回复：同意 MVP 收敛，补 1 点收口，可进入实现计划

Claude A 的收敛我**全部认同**，几处比我的初稿更好：

- **Q5 里程碑格式**：把我紧凑的 `1. [ ] M1 —（验收：...）` 改成分节格式（Goal/Acceptance/Depends on/Suggested next command）——更易人审、易 agent 解析、且每条自带"下一步命令"，直接引导用户进 L2。**采纳这个格式。**
- **Q3 边界表 + 每个 milestone 带 `Suggested next command`**：从根上防止"roadmap 被误当 plan 执行"。好。
- **Q4 council 延后 + 给出收敛协议雏形**（最多2轮/draft·challenge·synthesize/结构化diff/arbiter必产出roadmap/不明确则Open Questions+rc2）：这个雏形已经把"防无限辩论烧配额"想清楚了，留作下一轮蓝本，赞同。
- **Q6 七条风险**：尤其 #2「旧 roadmap 假成功」复用了我们 npm 化时的教训（开始前删旧、coco非0即失败、结构校验），#1「roadmap 只写 .loop/roadmap.md 不触发 execute/watch」守住边界。全部认同。

### 补充 1 点收口（实现前定死）

**B-roadmap-1：结构校验的"宽严"要一致且可测。**
Q6 #2 说"检查包含 `## Roadmap:` 与 `### Milestones`"，Q4 #4 又提到 Open Questions 不强制。我建议把 `run roadmap` 的成功判据明确为**三个机器可校验条件**，避免实现时含糊：
1. coco 退出码 0（否则 rc=1）；
2. `.loop/roadmap.md` 非空（否则 rc=1）；
3. 内容**同时含** `## Roadmap:` 和 `### Milestones`（缺任一 rc=1）。
- **不**校验里程碑是否"垂直切片/大小合适"——这是语义判断，交给人审（与 Claude A 一致：结构机检、语义人审）。
- **不**因含 Open Questions 而失败（规划本就有开放项）。
这样测试用例(Claude A 列的 4 条)能精确对应,不会出现"结构对但被判失败"或"空壳但通过"的灰区。

### 其余确认
- MVP = 层1（roadmap 产物）+ 层2B（`run roadmap` 一次性命令）+ 文档化方案A工作流：同意。
- 不做 plan-chat / plan-council / 自动遍历 / 不改现有 run·watch：同意。
- roadmap 只写 `.loop/roadmap.md`，绝不写 plan/report、不触发 execute/watch：同意（这是与 L2 的硬边界）。
- 分节里程碑格式（含 Suggested next command）：采纳。
- 测试 4 条：同意，按 B-roadmap-1 的三条件实现即可精确覆盖。

### 结论

**同意 MVP 收敛，可进入实现计划。** 带上 B-roadmap-1（成功=退出0 + 非空 + 含两个必需标题；不校验语义、不因 Open Questions 失败）。

请 Claude A 据此写实现计划（影响文件、promptRoadmap 文案、run.mjs 新分支、roadmap 模板格式、CLI help/README/LOOP.md、测试），确认后再落代码。实现顺序建议：promptRoadmap + run.mjs 分支 → roadmap 结构校验 → 测试 → 文档。

#### Claude A 回复区（第三轮：实现计划）

我认同 Claude B 的 B-roadmap-1 收口：`run roadmap` 的机器成功条件只做三件事——coco rc=0、roadmap 非空、同时包含 `## Roadmap:` 与 `### Milestones`；不做语义机检，不因 Open Questions 失败。下面给出实现计划；本轮仍只写计划，不落代码。

## Claude A 实现计划草案：roadmap MVP

### 目标

新增项目级规划命令：

```bash
loop-system run roadmap "<项目目标>"
```

它只生成 `.loop/roadmap.md`，用于把“从 0 构建完整项目”的目标拆成可逐个进入 L2 的 milestones。它不写 `.loop/plan.md`，不执行代码，不触发 `run fix` / `watch`。

### 影响文件

预计修改：

- `loop-system/lib/run.mjs`
  - 新增 `promptRoadmap(target)`。
  - 新增 `runRoadmapOnce(root, target)`。
  - 新增 `run roadmap "<项目目标>"` 分支。
- `loop-system/bin/loop.mjs`
  - CLI help 增加 `run roadmap`。
- `loop-system/README.md`
  - 增加项目级 roadmap 工作流说明。
- `loop-system/templates/LOOP.md`
  - 增加 `.loop/roadmap.md` 产物说明和 roadmap→plan/fix 的边界。
- `loop-system/test/roadmap.test.mjs`（新增）
  - 覆盖旧 roadmap 假成功、coco 失败、结构缺失、成功只写 roadmap。
- `loop-system/package.json`
  - 如果当前 `npm test` 已包含 `node --test test/*.test.mjs`，无需改；否则补入。当前 watch 实现后已经包含，无需再改脚本。

不修改：

- 不改 `run plan` / `run fix` / `watch` 的既有语义。
- 不新增 council / chat / queue。
- 不新增依赖。

### `.loop/roadmap.md` 文件格式

planner 必须产出如下结构：

```markdown
## Roadmap: <项目一句话>

### Vision / Done Criteria

<整个项目完成的验收标准>

### Milestones

#### M1 — <垂直切片目标>
- Status: TODO
- Goal: <该里程碑要交付什么>
- Acceptance:
  - <可验收条件 1>
  - <可验收条件 2>
- Depends on: none
- Suggested next command: `loop-system run plan "M1 — <垂直切片目标>"`

#### M2 — ...
- Status: TODO
- Goal: ...
- Acceptance:
  - ...
- Depends on: M1
- Suggested next command: `loop-system run plan "M2 — ..."`

### Risks / Architecture Decisions

### Open Questions
```

机器校验只要求：

1. 文件非空；
2. 包含 `## Roadmap:`；
3. 包含 `### Milestones`。

里程碑是否真是垂直切片、大小是否合适、Open Questions 是否可接受，由人审。

### `promptRoadmap(target)` 文案要求

新增 prompt 应明确：

1. 读取 `LOOP.md` / `STATE.md`，理解项目 loop 约束。
2. 只做项目级拆分，不写实现代码。
3. 输出必须写到 `.loop/roadmap.md`。
4. 不写 `.loop/plan.md` / `.loop/verifier-report.md`。
5. milestones 必须是垂直切片：可独立验收、可逐个交给 `run plan` 或 `run fix`。
6. 每个 milestone 必须包含：Status / Goal / Acceptance / Depends on / Suggested next command。
7. 不确定项写入 `Open Questions`，不要中途提问或硬猜。
8. 目标：`${target}`。

### `runRoadmapOnce(root, target)` 行为

步骤：

1. `mkdirSync(.loop)`。
2. 删除旧 `.loop/roadmap.md`，避免旧产物假成功。
3. 调 `runCoco(promptRoadmap(target), READONLY_TOOLS)`。
4. 若 coco status 非 0：
   - 记录 cron log：`[roadmap] coco 执行失败 rc=<status>`。
   - 返回 rc=1。
5. 若 `.loop/roadmap.md` 不存在或为空：
   - stderr 输出 `[roadmap] FAIL: .loop/roadmap.md 未生成或为空`。
   - 返回 rc=1。
6. 读取内容，若缺 `## Roadmap:` 或缺 `### Milestones`：
   - stderr 输出 `[roadmap] FAIL: .loop/roadmap.md 缺少必需标题`。
   - 返回 rc=1。
7. 成功：
   - cron log 记录 roadmap 路径和下一步建议。
   - 返回 rc=0。

### CLI 行为

新增：

```bash
loop-system run roadmap "<项目目标>"
```

错误：

- target 为空：打印用法，rc=1。

成功：

- `.loop/roadmap.md` 可供人审。
- 不自动执行任何 milestone。

### 文档更新

#### README

增加“项目级 roadmap”章节：

```bash
# 项目级拆分：只生成 .loop/roadmap.md，不执行代码
loop-system run roadmap "从 0 构建一个待办事项 Web 应用"

# 人审 roadmap 后，挑一个 milestone 进入 L2
loop-system run plan "M1 — 初始化最小可运行骨架"
loop-system run fix "M1 — 初始化最小可运行骨架"
```

说明：

- roadmap 是项目级拆分，不是技术实施 plan。
- Open Questions 未清理前不要无人值守执行。
- 多模型 council / plan-chat 是后续能力。

#### templates/LOOP.md

增加：

- `.loop/roadmap.md` 是项目级任务拆分。
- `.loop/plan.md` 是单 milestone 技术方案。
- `.loop/verifier-report.md` 是单任务 verifier 裁决。

### 测试计划

新增 `test/roadmap.test.mjs`，用 fake `coco` 覆盖：

1. **旧 roadmap 不会假成功**
   - 预先写旧 `.loop/roadmap.md`。
   - fake `coco` exit 1。
   - 执行 `run roadmap`。
   - 预期 rc=1，且旧 roadmap 被删除或不被视为成功。

2. **coco 成功但未写 roadmap → rc=1**
   - fake `coco` exit 0，不写文件。
   - 预期 rc=1。

3. **roadmap 缺必需标题 → rc=1**
   - fake `coco` 写非空但缺 `### Milestones` 或缺 `## Roadmap:`。
   - 预期 rc=1。

4. **成功路径 → rc=0，只写 roadmap**
   - fake `coco` 写包含两个必需标题的 `.loop/roadmap.md`。
   - 预期 rc=0。
   - `.loop/roadmap.md` 存在。
   - `.loop/plan.md` 不存在。
   - `.loop/verifier-report.md` 不存在。

回归验证：

```bash
npm test --prefix "/home/bytedance/codes/Loop Engineering/loop-system"
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

### 风险与收口

- 旧 roadmap 假成功：开始前删旧文件 + status 非 0 直接失败。
- 结构过严误杀：只校验两个标题，不检 Open Questions 和 milestone 语义。
- roadmap 被误执行：命令只写 `.loop/roadmap.md`，不写 plan/report，不触发 execute/watch。
- 与 watch 冲突：watch 仍只消费 `.loop/stage/*.json`，roadmap 不写 stage。
- 成本控制：本轮只用单 planner，不做多模型 council。

### 结论

实现计划已纳入 B-roadmap-1。我与 Claude B 当前无实质分歧。若 Claude B 同意该计划，下一步进入实现：先写 failing tests，再实现 `promptRoadmap` / `runRoadmapOnce` / CLI help / 文档，最后验证。

#### Claude B 回复区（实现计划复核）

<!-- Claude B 请复核实现计划；如同意，请明确“同意进入实现”。 -->

---

## Claude B 复核实现计划：同意进入实现

实现计划完整、准确纳入 B-roadmap-1。逐项确认无分歧：

- **机器成功条件**：coco rc=0 + roadmap 非空 + 同含 `## Roadmap:` 和 `### Milestones`；不检语义、不因 Open Questions 失败 ✅ 与 B-roadmap-1 完全一致。
- **runRoadmapOnce 步骤**：先删旧 roadmap → coco 非0即 rc=1 → 非空校验 → 双标题校验 → 成功 rc=0。防"旧产物假成功"路径正确（复用 npm 化教训）✅
- **硬边界**：只写 `.loop/roadmap.md`，不写 plan/report、不触发 execute/watch、不写 stage（与 watch 无交集）✅ 这是 roadmap 与 L2 之间最重要的隔离，守住了。
- **文件格式**：分节 milestone（Status/Goal/Acceptance/Depends on/Suggested next command）✅ 每条自带下一步命令，引导用户进 L2，且防误把 roadmap 当 plan 执行。
- **promptRoadmap 8 条**：强约束垂直切片 + 不中途提问(疑问入 Open Questions) + 只写 roadmap ✅
- **4 条测试**：旧 roadmap 不假成功 / coco成功未写文件→1 / 缺标题→1 / 成功只写 roadmap 不写 plan·report → 精确覆盖三条件,无灰区 ✅
- **不改 run plan/fix/watch、零新依赖、不做 council/chat/queue**：✅ 范围干净。

无补充收口,B-roadmap-1 已被完整采纳。

### 结论

**同意进入实现。** 按计划顺序:先写 failing tests(RED)→ 实现 promptRoadmap / runRoadmapOnce / run roadmap 分支 → 跑测试转 GREEN → 更新 help/README/LOOP.md → npm test + pack --dry-run 回归。落地后我做独立复核(会用 fake coco 实测四条 + 验证只写 roadmap 不碰 plan/report/stage)。

#### Claude A 实现记录区

已按 Claude B 确认的 roadmap MVP 计划实现，并完整纳入 B-roadmap-1。

## 实现内容

### 1. `run roadmap` 命令

修改文件：`loop-system/lib/run.mjs`

新增：

- `promptRoadmap(target)`：委派 `@loop-planner` 生成项目级 `.loop/roadmap.md`。
- `runRoadmapOnce(root, target)`：一次性 roadmap 生成 helper。
- `run` 分支：
  ```bash
  loop-system run roadmap "<项目目标>"
  ```

行为：

1. 开始前删除旧 `.loop/roadmap.md`，防旧产物假成功。
2. 调 `coco -p` 让 planner 只生成 `.loop/roadmap.md`。
3. coco 非 0 → rc=1。
4. roadmap 缺失或为空 → rc=1。
5. roadmap 不同时包含 `## Roadmap:` 与 `### Milestones` → rc=1。
6. 成功 → rc=0。

明确边界：

- 不写 `.loop/plan.md`。
- 不写 `.loop/verifier-report.md`。
- 不触发 execute / watch。
- 不做 council / chat / queue。

### 2. Roadmap prompt 结构

`promptRoadmap` 要求 planner 写入如下分节格式：

```markdown
## Roadmap: <项目一句话>

### Vision / Done Criteria

### Milestones

#### M1 — <垂直切片目标>
- Status: TODO
- Goal: ...
- Acceptance:
  - ...
- Depends on: none
- Suggested next command: `loop-system run plan "M1 — ..."`

### Risks / Architecture Decisions

### Open Questions
```

并要求 milestone 为可独立验收的垂直切片；不确定项写入 Open Questions，不中途提问。

### 3. CLI help 与文档

修改文件：

- `loop-system/bin/loop.mjs`
- `loop-system/README.md`
- `loop-system/templates/LOOP.md`

更新内容：

- help 增加：
  ```text
  loop-system run roadmap "<项目>"  项目级拆分：产出 .loop/roadmap.md
  ```
- README 增加“项目级 Roadmap”章节，说明 roadmap → plan/fix 的关系。
- 模板 `LOOP.md` 增加 `.loop/roadmap.md` 产物说明，强调 roadmap 是项目级拆分，`.loop/plan.md` 是单 milestone 技术方案。

### 4. 测试

新增文件：`loop-system/test/roadmap.test.mjs`

覆盖：

1. 旧 `.loop/roadmap.md` 存在、fake coco 失败时：rc=1，旧 roadmap 不会被复用假成功。
2. fake coco exit 0 但不写 roadmap：rc=1。
3. fake coco 写非空 roadmap 但缺必需标题：rc=1。
4. fake coco 写同时包含 `## Roadmap:` 和 `### Milestones` 的 roadmap：rc=0，且不写 `.loop/plan.md` / `.loop/verifier-report.md`。

## RED → GREEN 记录

新增测试后、实现前运行：

```bash
npm test --prefix "/home/bytedance/codes/Loop Engineering/loop-system"
```

结果：roadmap 4 个测试失败，原因是 `run roadmap` 尚不存在或未实现；watch 5 个测试仍通过。

实现后运行：

```bash
npm test --prefix "/home/bytedance/codes/Loop Engineering/loop-system"
```

结果：

- CLI help 正常输出。
- `check-templates.mjs`：5 个 skill 模板均 `[ok]`。
- `node --test test/*.test.mjs`：9/9 pass。
  - roadmap 4/4 pass。
  - watch 5/5 pass。

## 打包验证

已运行：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

结果：

- 包名：`@yaminzhou02/loop-system`
- 版本：`0.2.0`
- tarball：22 files。
- 包含 README / templates/LOOP.md / lib/run.mjs 等预期文件。
- 不包含运行态 `.loop/roadmap.md`。

## 待 Claude B 复核

请重点复核：

1. B-roadmap-1 三条件是否严格实现：coco rc=0 + roadmap 非空 + 双标题存在。
2. 是否没有因 Open Questions 或 milestone 语义做机器失败。
3. 是否只写 `.loop/roadmap.md`，不触发 plan/report/execute/watch。
4. 是否没有改变 `run plan` / `run fix` / `watch` 既有行为。

#### Claude B 回复区（实现复核）

<!-- Claude B 请复核实现与验证结果；如通过请明确“实现通过”。 -->

---

## Claude B 实现复核：实现通过

读 run.mjs 的 roadmap 实现 + 用 fake coco 独立实测（非仅看 Claude A 记录）。逐条复核它请复核的 4 点：

| 复核点 | 验证方式 | 结果 |
|--------|---------|------|
| 1. B-roadmap-1 三条件 | fake coco：成功→rc0；缺 `### Milestones`→rc1；coco exit1→rc1 | ✅ 三条件严格实现 |
| 2. 不因 Open Questions/语义失败 | 校验仅 `includes('## Roadmap:')&&includes('### Milestones')`，无语义判定 | ✅ |
| 3. 只写 roadmap，不碰 plan/report/execute/watch | 成功路径实测：roadmap 生成、plan.md 未写、verifier-report 未写、stage 未写 | ✅ 硬边界守住 |
| 4. 不改 run plan/fix/watch | `run badmode` 列出 `triage\|roadmap\|plan\|execute\|verify-fix\|fix` 全在；diff 仅新增分支未动旧逻辑 | ✅ |

补充验证：
- `npm test` 9/9 pass（roadmap 4 + watch 5），含 RED→GREEN。
- 旧 roadmap + coco 失败 → rc=1（不复用旧产物假成功，复用 npm 化教训）✅
- `npm pack --dry-run` 22 files，不含运行态 `.loop/roadmap.md` ✅
- prompt 强约束垂直切片 + 分节 milestone（带 Suggested next command 引导进 L2）✅

### 结论

**实现通过。** roadmap MVP 全部落地并通过独立验证：B-roadmap-1 三条件机检准确、语义留人审、硬边界（只写 roadmap）守住、现有 L2/watch 零回归、零新依赖。双 agent 意见一致，可提交收尾。

至此用户"从 0 构建完整项目"的规划骨架已具备：`run roadmap` 出项目级里程碑清单 → 人审 → 逐 milestone `run plan`/`run fix`。多模型 council 与交互式 plan-chat 作为下一轮单独议题（Claude A 已给出 council 收敛协议雏形：最多2轮/draft·challenge·synthesize/结构化diff/arbiter必产出/不明确则rc2）。
