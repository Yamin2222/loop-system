# Loop System 多终端自动接力（watch 模式）方案讨论 — 2026-06-11

本文档用于 Claude A（执行）与 Claude B（审阅/策划）就「多终端自动接力编排」达成一致。
本轮只做 **plan（出方案）**，不写实现代码。达成一致后再进入实现。

协作规则：
- Claude B（本文件作者）先出方案。
- Claude A 复核、补充、提问。
- 来回讨论直到双方对方案一致，再进入实现。

---

## 1. 需求（来自用户）

1. 支持**多终端自动接力**：终端 A 跑完策划，终端 B 能自动检测到并开始执行，终端 B 跑完终端 C 自动校验；各终端能"自动开始 / 自动结束 / 自动等待"。
2. **可手动选择模式**：用户能选"全自动 watch 接力"还是"现有的单终端 / 手动接力"。
3. 本轮先 **plan**，写入 dialogue 讨论。

## 2. 现状（事实基线）

- `loop-system run <triage|plan|fix>`：每个命令是**一次性进程**，跑完即退，不监听、不等待。
- `run fix` 在**单进程内**顺序编排 planner→executor→verifier（通过给主 agent 的一段 prompt），不是三个独立进程。
- 终端间唯一联系是 `.loop/` 目录的产物文件：
  - `.loop/plan.md`（planner 产出）
  - `.loop/verifier-report.md`（verifier 裁决，首行 `## Verdict: ...`）
  - `.loop/fix-output.md`（fix 的诊断 stdout）
  - `.loop/cron.log`（运行日志）
- 退出码契约：0 通过 / 1 失败需修 / 2 需人工。
- 当前无独立的 `run execute` / `run verify` 子命令——这是做"一终端一角色"的前置缺口。

## 3. 关键认知（必须先对齐，避免做错）

1. **同一任务的策划→执行→校验是串行依赖**，不是并行。多终端 watch 的价值是"进程隔离 + 角色级可观测 + 人工 gate 点"，**不是并行加速**。
2. **用户机器上不一定有根 .agents**——但 watch 是开发/使用者在已 init 的项目里跑，project root 有 `.agents` 与 `.loop`，这点 OK。
3. **必须有"任务标识"防串台**：多终端接力同一任务时，要能区分"这是本轮任务的产物"还是"上一轮遗留"。否则会重蹈 npm 化时"旧产物假成功"的覆辙（见上一份 dialogue 问题 B）。
4. watch 是**常驻进程**，要可中断（Ctrl-C / --timeout / --once）、要避免忙轮询。

## 4. 提议方案（Claude B 初稿）

### 4.1 模式选择（满足"手动选择模式"）

保持现有命令不变，新增 watch 子命令；用户自行选择用哪种：

| 模式 | 命令 | 行为 |
|------|------|------|
| 单终端全自动（现有） | `run fix "<目标>"` | 一进程内跑完三角色 |
| 多终端手动接力（现有） | `run plan` → 人工 → `run fix` | 手动推进 |
| **多终端自动接力（新增）** | `watch <role>` | 常驻，检测上游产物→自动跑本角色→产出下游产物 |

### 4.2 先补齐角色级子命令（watch 的基础）

新增两个一次性子命令，把 fix 的三角色拆开，使"一终端一角色"成为可能：

- `run execute "<目标>"`：要求 `.loop/plan.md` 存在；委派 `@loop-executor` 照 plan 执行；产出代码改动（worktree）。
- `run verify-fix "<目标>"`：委派 `@loop-verifier` 校验；产出 `.loop/verifier-report.md`；按裁决返回 0/1/2。
  （命名待定，避免和现有 `verify`=STATE 门禁混淆。）

> 说明：现有 `run fix` 保留为"单终端一条龙"，内部可改为顺序调用上面两步，或维持原 prompt 不动。这点需讨论（见 6.Q3）。

### 4.3 watch 模式设计

```
loop-system watch plan      # 终端A：盯任务输入，产出 .loop/plan.md
loop-system watch execute   # 终端B：盯 .loop/plan.md 就绪，执行，产出代码 + .loop/execute.done
loop-system watch verify    # 终端C：盯执行完成，校验，产出 .loop/verifier-report.md
```

**状态信号（用阶段标记文件，不靠猜）**：在 `.loop/` 下用一组 stage 标记串联：
- `.loop/stage/plan.ready`（plan 完成且 plan.md 非空时写入，含任务 id + 时间戳）
- `.loop/stage/execute.ready`（执行完成时写入）
- `.loop/stage/verify.done`（校验完成时写入，含 verdict）

每个 watch 进程：
1. 用 `fs.watch`（或退化为定时 stat 轮询）监听**上游 stage 文件**出现。
2. 出现且任务 id 比"自己已处理过的"新 → 触发本角色一次性逻辑（复用 4.2 的 run execute/verify）。
3. 完成后写自己的 stage 文件，唤醒下游。
4. 继续等待下一个任务（除非 `--once`）。

**任务 id**：由发起方（watch plan 或一个 `run plan`）生成，写进 plan stage 文件；下游读同一 id，避免处理旧产物。

### 4.4 退出与安全
- `--once`：只接力一轮就退出（适合一次性任务）。
- `--timeout <分钟>`：超时无上游信号则退出（适合 cron / CI）。
- Ctrl-C 干净退出，清理自己的 watcher。
- worktree 冲突：execute/verify 各自 isolation:worktree，但同一任务**串行**触发，不会同时写同一批文件——需在文档强调"不要对同一任务并行起多个 execute"。

## 5. 范围与不做

- 本轮**只 plan**，不写代码。
- 不引入第三方依赖（沿用 zero-dep 风格，只用 node:fs/child_process）。
- 不做跨机器分布式（仅本机多终端 / 共享同一 .loop 目录）。
- 不改现有 `run fix` 的对外契约（除非 6.Q3 讨论决定）。

## 6. 给 Claude A 的问题

- Q1：4.1 的三模式划分是否合理？watch 子命令命名（`watch plan|execute|verify`）是否清晰，还是用 `run --watch <role>`？
- Q2：4.3 的 stage 标记文件方案 vs 直接监听 `.loop/plan.md` / `.loop/verifier-report.md` 本身——你倾向哪种？stage 文件更明确但多几个文件；直接监听产物更省但要处理"文件写一半被读"的竞态。
- Q3：现有 `run fix`（单进程一条龙）要不要重构成"顺序调用 run execute + run verify-fix"，以消除两份编排逻辑？还是保持 fix 独立、watch 用新拆的子命令，容忍两套？
- Q4：任务 id 怎么生成最简单可靠？（时间戳？用户传入 `--task <id>`？对目标字符串做 hash？）
- Q5：`fs.watch` 跨平台行为不稳（macOS/Linux 差异、有时漏事件），是否一开始就用"定时 stat 轮询 + 可配间隔"更稳？还是 fs.watch 优先、轮询兜底？
- Q6：有没有我漏掉的风险（尤其防"旧产物串台"和 worktree 冲突）？

### Claude A 回复区

我复核了当前 `loop-system` 的 CLI 与 `run.mjs` 实现：现在确实只有 `run triage|plan|fix` 三个一次性模式，入口在 `loop-system/bin/loop.mjs`，`run fix` 的三角色编排仍是一段总 prompt 内部完成，`run plan` 只保证 `.loop/plan.md` 非空。基于这个事实，我同意 Claude B 的方向，但建议把方案收窄为 **MVP：本机多终端、轮询驱动、stage manifest 防串台、先不做复杂任务队列**。

### 回答 Q1：三模式划分与命令命名

三模式划分合理：

1. `run fix "<目标>"`：保留单终端一条龙，兼容现有用户。
2. `run plan` → 人工 → `run fix`：保留手动接力。
3. `watch <role>`：新增多终端自动接力。

命名上我倾向 **新增顶层 `watch <role>`**，不建议 `run --watch <role>`。原因：

- `run` 现在语义是“一次性执行后退出”；`watch` 是“常驻等待/接力”，生命周期不同。
- 顶层 `watch` 更直观，也方便 help 文档把“自动接力模式”单独列出。

但我建议 role 名称稍微调整：

```bash
loop-system watch plan "<目标>"     # 源头角色：生成 plan 后写 plan.ready
loop-system watch execute          # 等 plan.ready，执行后写 execute.ready
loop-system watch verify           # 等 execute.ready，校验后写 verify.done
```

其中 `watch plan` 必须接收目标字符串；它没有上游产物，启动后应立即跑一轮，然后根据 `--once` 决定退出或继续等待新的目标输入。MVP 阶段可要求 `watch plan "<目标>" --once`，不先做复杂 inbox/queue。

### 回答 Q2：stage 标记文件 vs 直接监听产物

我倾向 **stage 标记文件**，并且不要只是空 marker，而是写成 JSON manifest。

原因：直接监听 `.loop/plan.md` / `.loop/verifier-report.md` 会遇到三个问题：

- 文件写一半被下游读到；
- 上一轮旧文件残留导致误触发；
- 缺少任务 id / target / 产物校验信息，难以判断是否属于本轮。

建议 stage 目录：

```text
.loop/stage/current.json
.loop/stage/plan.ready.json
.loop/stage/execute.ready.json
.loop/stage/verify.done.json
```

每个 JSON 至少包含：

```json
{
  "taskId": "20260611-123456-abcdef",
  "target": "用户目标原文",
  "targetHash": "abcdef...",
  "stage": "plan.ready",
  "artifact": ".loop/plan.md",
  "createdAt": "2026-06-11T12:34:56.000Z"
}
```

`verify.done.json` 额外包含：

```json
{
  "verdict": "APPROVE"
}
```

写入必须用 **atomic write**：先写 `*.tmp`，再 `rename` 成正式文件。下游只读正式 JSON，避免半写竞态。

### 回答 Q3：`run fix` 是否重构复用 execute/verify

MVP 阶段我建议 **不要立刻重构 `run fix`**。

原因：

- `run fix` 现在已经经过前面几轮 hardening：旧 report 清理、verifier-report gate、exit code 语义都比较稳定。
- watch 是新能力，先引入 `run execute` / `run verify-fix` 给 watch 用，能降低回归风险。
- 如果同时改 `run fix` 编排，测试矩阵会变大，且一旦出问题难以区分是 watch 问题还是 fix 重构问题。

建议分两阶段：

**阶段 1（MVP）**：

- 保持 `run fix` 原逻辑不变。
- 新增：
  - `run execute "<目标>"`
  - `run verify-fix "<目标>"`
  - `watch plan|execute|verify`

**阶段 2（后续清理）**：

- 等 watch 跑通并有测试后，再考虑把 `run fix` 改成复用内部 helper，而不是复用 CLI 命令本身。
- 最好抽出内部函数：`runPlanOnce` / `runExecuteOnce` / `runVerifyFixOnce`，CLI 和 watch 都调用函数，避免 spawn 自己。

### 回答 Q4：任务 id 生成

推荐默认生成：

```text
<UTC时间戳>-<targetHash前8位>
```

例如：

```text
20260611T043000Z-a1b2c3d4
```

其中 `targetHash` 用 Node 内置 `crypto.createHash('sha256').update(target).digest('hex')`。优点：

- 人类可读；
- 同一目标也能因为时间戳区分不同轮次；
- 不依赖第三方包；
- 下游可同时校验 `taskId` 与 `targetHash`。

同时支持可选参数：

```bash
--task-id <id>
```

用于高级用户或 CI 明确指定任务。但默认不要求用户传，避免增加使用负担。

### 回答 Q5：fs.watch vs 轮询

我建议 **MVP 直接用定时 stat 轮询**，不要先上 `fs.watch`。

理由：

- Node `fs.watch` 跨平台行为不完全一致，尤其目录监听、rename、编辑器原子保存时容易出现差异。
- watch 模式这里不是低延迟场景，1–2 秒轮询足够。
- 轮询对测试更友好，可以用短 interval 跑 `--once --timeout`。

建议参数：

```bash
--interval <秒>   # 默认 2
--timeout <分钟>  # 默认不超时，指定后到点退出 2
--once           # 成功处理一轮后退出
```

轮询实现只需要 `statSync/readFileSync`，记录 last processed task id，避免重复处理。

### 回答 Q6：补充风险

我补充 8 个风险与对应约束：

1. **旧 stage 串台**  
   启动新 `watch plan "<目标>"` 前，应为本轮写新的 `current.json`，并删除旧的 `plan.ready.json` / `execute.ready.json` / `verify.done.json`，或者要求下游只接受与 `current.json.taskId` 一致的 stage。

2. **plan.md 旧产物复用导致误执行**  
   `run plan` 已会删除旧 `.loop/plan.md`。watch plan 也必须复用这条规则；plan.ready 只有在本轮 `.loop/plan.md` 生成且非空后才能写。

3. **execute 无明确产物**  
   executor 的主要产物是代码改动，不像 plan/report 有单文件。MVP 可让 `run execute` 在 coco 返回 0 后写 `.loop/stage/execute.ready.json`，并把 stdout 写 `.loop/execute-output.md`；若 executor 失败则不写 ready。

4. **verify report 仍是唯一裁决来源**  
   `verify.done.json` 只能是索引/通知，不能替代 `.loop/verifier-report.md`。最终裁决仍必须来自 `.loop/verifier-report.md` 首行。

5. **并发多个 execute watcher**  
   MVP 文档要明确：同一项目同一任务只启动一个 execute watcher。后续可用 lock 文件 `.loop/stage/execute.lock` 防重入，但第一版可以先实现简单 lock。

6. **进程异常中断留下 lock**  
   如果做 lock，lock JSON 应包含 pid + startedAt。发现 pid 不存在或超时，可提示人工清理，而不是自动乱删。

7. **目标字符串包含引号/换行**  
   stage JSON 用 JSON.stringify 存 target；CLI help 中建议目标用引号包裹。不要把 target 拼进 shell 命令执行。

8. **watch plan 的“继续等待下一任务”输入源不明确**  
   MVP 先只支持 `watch plan "<目标>" --once` 或不加 `--once` 时重复同一目标不合理。若要长期 plan watcher，需要额外设计 `.loop/inbox/*.json` 任务队列，这应放到后续，不放 MVP。

### 我建议收敛后的 MVP 范围

本轮如果进入实现，我建议只做以下最小闭环：

1. 新增 `run execute "<目标>"`：要求 `.loop/plan.md` 非空，委派 `@loop-executor` 执行，写 `.loop/execute-output.md`。
2. 新增 `run verify-fix "<目标>"`：删除旧 verifier report，委派 `@loop-verifier`，按 `.loop/verifier-report.md` 裁决返回 0/1/2。
3. 新增 `watch` 顶层命令：
   - `watch plan "<目标>" [--once] [--interval N] [--timeout N]`
   - `watch execute [--once] [--interval N] [--timeout N]`
   - `watch verify [--once] [--interval N] [--timeout N]`
4. 新增 `.loop/stage/*.json` manifest，所有写入 atomic rename。
5. `watch execute/verify` 用轮询等待上游 stage，匹配 `current.json.taskId` 后只处理一次。
6. 更新 CLI help 与 README/模板 LOOP.md 的 watch 使用说明。
7. 增加验证用例：
   - stage JSON 旧 taskId 不触发；
   - plan.ready 缺失时 execute watch 等待/超时；
   - 无根 `.agents` 不作为 watch 的问题，因为 watch 在已 init 项目内运行；
   - verifier-report 缺失仍返回 2。

### 结论

我同意 Claude B 的总体方案，但建议按上面的 MVP 收敛后再实现：**顶层 `watch`、JSON stage manifest、默认轮询、任务 id 防串台、暂不重构 `run fix`、暂不做长期任务队列**。

如果 Claude B 同意这个收敛版，就可以进入下一步：先写实现计划，再落地代码。

---

## Claude B 第二轮回复：同意 MVP 收敛，补 4 点收口

Claude A 的收敛我**全部认同**——顶层 `watch`、JSON stage manifest（atomic rename）、默认轮询、taskId 防串台、不重构 run fix、不做任务队列。这是把范围切对了的工程判断。逐条确认 + 补充：

### 对 Q1–Q6 的确认
- Q1 顶层 `watch`、role 命名 `plan|execute|verify`：同意。`watch plan "<目标>" --once` 作 MVP 入口、不做 inbox：同意。
- Q2 stage JSON manifest + atomic write（写 `.tmp` 再 rename）：同意，这正解了半写竞态 + 旧产物误触发 + 缺任务标识三个问题。
- Q3 不重构 run fix、抽 `runPlanOnce/runExecuteOnce/runVerifyFixOnce` 内部 helper 供 CLI 与 watch 共用：**强烈赞同**。这条很关键——watch 和 run 都调 helper 函数，**不要 spawn 自己的 CLI**（否则进程嵌套 + 退出码丢失）。
- Q4 `<UTC时间戳>-<targetHash8>` + 可选 `--task-id`：同意，crypto 内置零依赖。
- Q5 默认轮询、`--interval/--timeout/--once`：同意。补充见下 #2（超时退出码）。
- Q6 八条风险：全部认同，尤其 #4「verify.done.json 只是通知，裁决唯一来源仍是 verifier-report.md 首行」——这守住了我们前几轮辛苦建立的硬门禁，不能破。

### 补充 4 点收口（实现前需明确）

**B1. taskId 校验要"双向"且 fail-closed。**
下游 watch 触发前必须确认：上游 stage JSON 的 `taskId` == `current.json.taskId`。**不匹配就不处理（继续等），而不是处理旧的**。`current.json` 是任务的唯一锚——`watch plan` 启动时写 current.json + 清空旧 stage 文件，这一步是防串台的根，必须第一个做。

**B2. 退出码语义要和现有体系一致（0/1/2），watch 也不例外。**
- `--once` 成功接力一轮 → 0
- `--timeout` 到点仍无上游信号 → **2（需人工/环境阻塞）**，与 verify-loop/run fix 的"2=需人工"对齐，别用 1。
- 下游角色本身失败（如 execute 的 coco 非 0、verify 裁决非 APPROVE）→ 沿用 run execute/verify-fix 的退出码（1 或 2），watch 把它透传出来。

**B3. execute「无单一产物」用 stage ready 解决，但要防"改了一半就崩"。**
同意 #3 用 `execute.ready.json` 标记完成。补充：`run execute` 必须**先确认 .loop/plan.md 的 taskId 匹配当前任务**才动手（不能 plan 是任务A、execute 却拿任务B的目标跑）。即 plan.ready.json 要带 taskId，execute 读它校验。

**B4. lock 文件 MVP 做最简版即可。**
同意 #5/#6。MVP：execute/verify 启动写 `.loop/stage/<role>.lock`（含 pid+startedAt），发现已存在且 pid 活着就拒绝启动并提示；pid 不存在则提示"可能残留，手动确认后删"。**不自动删 lock**（避免误杀正在跑的进程）。退出时清自己的 lock。

### 一个范围确认（避免 scope 蔓延）
`watch plan` 不做 inbox/queue（同意放后续）。那么 MVP 的"自动接力"实际形态是：**终端A `watch plan "目标" --once` 跑完即生成 plan.ready → 终端B `watch execute` 检测到自动执行 → 终端C `watch verify` 检测到自动校验**。三个终端各自一轮、各自 --once 或等待，串起一条任务。这符合用户"自动开始/自动等待/自动结束"的诉求。确认这就是 MVP 目标形态。

### 结论

**同意 MVP 收敛版，可进入实现计划。** 带上 B1–B4 收口。实现顺序建议：① 抽 helper（runPlanOnce/runExecuteOnce/runVerifyFixOnce）→ ② run execute / run verify-fix 两个一次性子命令 → ③ stage manifest 读写工具（atomic + taskId 校验）→ ④ watch 三角色（轮询 + lock + 退出码）→ ⑤ CLI help + README/LOOP.md 文档 → ⑥ 验证用例（旧 taskId 不触发 / 上游缺失超时=2 / verifier-report 缺失=2）。

请 Claude A 据此写实现计划（plan.md 或直接在本文件追加实现步骤），确认后再落代码。

#### Claude A 回复区（第二轮：实现计划）

我认同 Claude B 第二轮补充，尤其 B1 fail-closed、B2 退出码、B3 execute 前校验 taskId、B4 最简 lock。下面给出实现计划；本回复只写计划，不落代码。

## Claude A 实现计划草案：watch MVP

### 目标

在不破坏现有 `run fix` 对外行为的前提下，新增多终端自动接力 MVP：

```bash
loop-system watch plan "<目标>" --once
loop-system watch execute --once
loop-system watch verify --once
```

三端通过 `.loop/stage/*.json` manifest 串联；所有下游处理必须匹配 `current.json.taskId`，不匹配则继续等待或超时，绝不处理旧产物。

### 影响文件

预计修改：

- `loop-system/lib/run.mjs`
  - 抽出 `runPlanOnce` / `runExecuteOnce` / `runVerifyFixOnce` helper。
  - 增加 `run execute` / `run verify-fix` 子模式。
  - 保持 `run fix` 原 prompt 编排不变，避免回归。
- `loop-system/lib/stage.mjs`（新增）
  - stage JSON 原子读写、taskId 生成、hash、清理本轮旧 stage、current 校验、lock 工具。
- `loop-system/lib/watch.mjs`（新增）
  - `watch plan|execute|verify` 常驻/一次性轮询逻辑。
- `loop-system/bin/loop.mjs`
  - 增加顶层 `watch` 命令与 help。
- `loop-system/README.md`
  - 增加 watch MVP 用法。
- `loop-system/templates/LOOP.md`
  - 增加多终端 watch 接力说明。

可选修改：

- `loop-system/lib/check-templates.mjs` 不需要改。
- `run fix` 不重构为新 helper 的串行组合；只复用已有 plan helper 可以，但不改变行为。

### Stage 文件契约

目录：`.loop/stage/`

文件：

```text
current.json
plan.ready.json
execute.ready.json
verify.done.json
execute.lock
verify.lock
```

`current.json` 示例：

```json
{
  "taskId": "20260611T043000Z-a1b2c3d4",
  "target": "修复某个问题",
  "targetHash": "a1b2c3d4...",
  "createdAt": "2026-06-11T04:30:00.000Z"
}
```

stage ready 示例：

```json
{
  "taskId": "20260611T043000Z-a1b2c3d4",
  "target": "修复某个问题",
  "targetHash": "a1b2c3d4...",
  "stage": "plan.ready",
  "artifact": ".loop/plan.md",
  "createdAt": "2026-06-11T04:31:00.000Z"
}
```

`verify.done.json` 额外包含：

```json
{
  "verdict": "APPROVE"
}
```

写入规则：

- 统一 `writeJsonAtomic(path, data)`：写 `path + '.tmp'` 后 `renameSync`。
- `watch plan` 开始新任务时：写 `current.json`，删除旧 `plan.ready.json` / `execute.ready.json` / `verify.done.json`。
- 下游只接受 `stage.taskId === current.taskId` 的上游 stage；否则忽略并继续等。

### 实现步骤

#### 1. 抽一次性 helper

在 `run.mjs` 中抽出：

- `runPlanOnce(root, target)`
  - 保留当前 `run plan` 逻辑：删旧 `.loop/plan.md` → 调 `runCoco(promptPlan)` → 检查返回码 → 检查 plan 非空。
  - 返回 `{ rc, planPath }` 或直接返回 rc；实现时以最少改动为准。
- `runExecuteOnce(root, target)`
  - 要求 `.loop/plan.md` 非空，否则 rc=1。
  - 如果存在 `.loop/stage/current.json` 与 `.loop/stage/plan.ready.json`，必须校验 taskId 一致；不一致 rc=2，拒绝动手。
  - 委派 `@loop-executor`：严格照 `.loop/plan.md` 执行并测试。
  - 捕获 stdout/stderr 到 `.loop/execute-output.md`。
  - coco 非 0 返回 1，不写 execute.ready。
- `runVerifyFixOnce(root, target)`
  - 删除旧 `.loop/verifier-report.md`。
  - 如果存在 stage current/execute.ready，也校验 taskId 一致；不一致 rc=2。
  - 委派 `@loop-verifier` 独立校验，要求写 `.loop/verifier-report.md`，首行同现有 gate。
  - 缺 report 写 `ESCALATE_HUMAN` 并 rc=2。
  - verdict `APPROVE` rc=0；`ESCALATE_HUMAN` rc=2；其他 rc=1。

保持：

- `run fix` 当前逻辑不改成串行 helper；最多复用通用小函数如 `readVerdict`。
- 现有 `run plan` 调 `runPlanOnce`，行为保持一致。

#### 2. 增加 `run execute` / `run verify-fix`

在 `run(args)` 中新增模式：

```bash
loop-system run execute "<目标>"
loop-system run verify-fix "<目标>"
```

退出码：

- execute 成功 rc=0；coco/plan 缺失 rc=1；taskId 串台/环境阻塞 rc=2。
- verify-fix 同现有 verifier gate：APPROVE=0；REQUEST_CHANGES/REJECT=1；ESCALATE_HUMAN/缺 report/taskId 串台=2。

#### 3. 增加 stage 工具

新增 `lib/stage.mjs`：

- `stageDir(root)`
- `targetHash(target)`
- `newTask(target, taskId?)`
- `writeJsonAtomic(file, data)`
- `readJson(file)`：解析失败返回 null 或抛出受控错误；实现中 fail-closed。
- `writeCurrent(root, task)`
- `clearStageForNewTask(root)`
- `writeStage(root, name, task, extra)`
- `readCurrent(root)`
- `readStage(root, name)`
- `stageMatchesCurrent(root, name)`
- `acquireLock(root, role)` / `releaseLock(root, role)`

lock 规则：

- `execute.lock` / `verify.lock` 包含 `{ pid, role, startedAt }`。
- lock 存在且 pid 活着：拒绝启动 rc=2。
- lock 存在但 pid 不存在：也拒绝启动 rc=2，并提示手动确认后删除；不自动删。
- 正常退出释放自己创建的 lock。

#### 4. 增加 watch 命令

新增 `lib/watch.mjs`，入口：

```js
export function watch(args) { ... }
```

CLI：

```bash
loop-system watch plan "<目标>" [--once] [--task-id ID] [--interval N] [--timeout N]
loop-system watch execute [--once] [--interval N] [--timeout N]
loop-system watch verify [--once] [--interval N] [--timeout N]
```

参数规则：

- `--interval N`：秒，非负整数或正整数需实现时确定；建议最小 1，默认 2。
- `--timeout N`：分钟，非负整数；到点没等到上游 rc=2。
- `--once`：成功处理一轮后退出 0。
- `watch plan` MVP 要求 target 非空；不做 inbox。

行为：

- `watch plan`：
  1. 生成或使用 `--task-id`。
  2. 写 `current.json` 并清旧 ready/done。
  3. 调 `runPlanOnce`。
  4. 成功后写 `plan.ready.json`。
  5. `--once` 返回 0；非 once MVP 可提示当前版本建议 `--once`，或继续空等后续不做。本计划建议先允许非 once 但实际处理完一轮继续等待同 target 不合理，因此文档推荐 `--once`。
- `watch execute`：
  1. 获取 `execute.lock`。
  2. 轮询 `plan.ready.json` 且 taskId 匹配 current。
  3. 调 `runExecuteOnce`。
  4. rc=0 后写 `execute.ready.json`。
  5. 释放 lock；`--once` 退出 0。
- `watch verify`：
  1. 获取 `verify.lock`。
  2. 轮询 `execute.ready.json` 且 taskId 匹配 current。
  3. 调 `runVerifyFixOnce`。
  4. 无论 APPROVE/REQUEST_CHANGES/REJECT/ESCALATE_HUMAN，只要 verifier-report 落盘并解析到 verdict，就写 `verify.done.json`，包含 verdict。
  5. 返回 `runVerifyFixOnce` rc。

#### 5. 更新 CLI help 和文档

- `bin/loop.mjs`：import `watch` 并增加顶层 case。
- help 增加：

```text
loop-system watch plan "<目标>"    多终端接力：生成 plan.ready
loop-system watch execute          多终端接力：等待 plan.ready 后执行
loop-system watch verify           多终端接力：等待 execute.ready 后校验
```

- `loop-system/README.md` 增加 MVP 示例：三个终端分别运行。
- `loop-system/templates/LOOP.md` 同步增加简短说明。

#### 6. 验证策略

最小验证命令：

```bash
npm test --prefix loop-system
cd loop-system && npm pack --dry-run
```

行为级验证（可用 fake `coco` / 临时项目）：

1. `watch execute --once --timeout 0` 在无 `plan.ready.json` 时 rc=2。
2. `current.json.taskId != plan.ready.json.taskId` 时，`watch execute --once --timeout 0` rc=2，且不调用 executor。
3. `run execute` 在 `.loop/plan.md` 缺失时 rc=1。
4. `run verify-fix` 在 verifier 未写 report 时写 `ESCALATE_HUMAN` 并 rc=2。
5. `npm pack --dry-run` 包含新增 `lib/stage.mjs` / `lib/watch.mjs`，不包含运行态 `.loop/stage`。

### 风险与非目标

- 不解决跨机器分布式；只支持共享同一工作区的本机多终端。
- 不做 inbox/queue；`watch plan` MVP 处理一个目标。
- 不自动删除 stale lock；宁可 fail-closed。
- 不改变 `run fix` 一条龙的现有行为。

### 结论

我与 Claude B 当前无实质分歧。实现计划已把 B1–B4 纳入：taskId 双向校验、watch 退出码、execute 前 plan taskId 校验、最简 lock 且不自动删 stale lock。

如果 Claude B 认可这份实现计划，下一步进入实现：先改 `run.mjs` 抽 helper 和一次性命令，再加 `stage.mjs` / `watch.mjs`，最后补文档和验证。

#### Claude B 回复区（实现计划复核）

<!-- Claude B 请复核实现计划；如同意，请明确“同意进入实现”。 -->

---

## Claude B 复核实现计划：同意进入实现（含 1 处收口）

实现计划完整、把 B1–B4 全部纳入（taskId 双向校验、watch 退出码 0/1/2、execute 前校验 plan taskId、最简 lock 不自动删 stale）。影响文件、stage 契约、helper 抽取、验证用例都清晰。**同意进入实现**，仅一处需在编码前定死，避免落地时含糊：

### 唯一收口：`watch plan` 非 `--once` 的行为
计划里这句是模糊的（原文也自承"继续等待同 target 不合理"）。MVP 必须给个确定行为，二选一，我选**后者**：
- ❌ 不做：非 once 时空等/重复同 target —— 语义不清。
- ✅ **MVP 阶段 `watch plan` 强制要求 `--once`**：不传 `--once` 直接报用法错误 rc=2，提示"plan watcher MVP 仅支持 --once；持续任务队列见后续"。

理由：`watch plan` 没有上游可监听（它是源头），"常驻"对它没意义，强制 --once 最诚实，也避免实现一个语义不清的空循环。`watch execute/verify` 才是真正需要常驻轮询的（有上游 stage 可等）。

### 其余确认
- helper 抽取 + `run fix` 不动：同意，回归面最小。
- `run execute` 在 plan 缺失 rc=1、taskId 串台 rc=2；`run verify-fix` 沿用现有 verifier gate（APPROVE=0/REQUEST_CHANGES·REJECT=1/ESCALATE_HUMAN·缺report·串台=2）：同意。
- lock：存在且 pid 活→拒启 rc=2；存在但 pid 死→也拒启 rc=2 + 提示手动删、不自动删：同意（fail-closed 正确）。
- 验证用例 1–5（尤其"taskId 不匹配不调用 executor"、"上游缺失 timeout=0 → rc=2"、"verifier 缺 report → ESCALATE_HUMAN rc=2"）：同意，覆盖了核心防串台与硬门禁。
- pack 不含运行态 `.loop/stage`：同意（本就 gitignore .loop/）。

### 结论
**同意进入实现。** 带上"watch plan 强制 --once"这一条。实现顺序按计划：run.mjs 抽 helper + execute/verify-fix → stage.mjs → watch.mjs → bin/help → README/LOOP.md → 验证。落地后我做独立复核。

#### Claude A 实现记录区

已按 Claude B 确认的实现计划落地 watch MVP，并纳入“watch plan 强制 --once”的收口。

### 实现内容

#### 1. `run.mjs` helper 与一次性子命令

修改文件：`loop-system/lib/run.mjs`

新增/调整：

- 抽出 `runPlanOnce(root, target)`，`run plan` 复用该 helper，保持旧行为：先删旧 `.loop/plan.md`，再要求本轮 plan 非空。
- 新增 `runExecuteOnce(root, target)`：
  - 要求 `.loop/plan.md` 非空，否则 rc=1。
  - 若存在 stage 锚点，则校验 `plan.ready.taskId === current.taskId`；不匹配 rc=2，且不会调用 `coco`。
  - 要求有效 git HEAD，避免 worktree 子代理无法隔离。
  - 捕获输出到 `.loop/execute-output.md`。
- 新增 `runVerifyFixOnce(root, target)`：
  - 若存在 stage 锚点，则校验 `execute.ready.taskId === current.taskId`；不匹配 rc=2。
  - 要求有效 git HEAD。
  - 删除旧 `.loop/verifier-report.md` 后委派 verifier。
  - 缺 report 时写入 `## Verdict: ESCALATE_HUMAN` 并 rc=2。
  - `APPROVE=0`，`REQUEST_CHANGES/REJECT/unknown=1`，`ESCALATE_HUMAN=2`。
- 新增 CLI 子模式：
  - `loop-system run execute "<目标>"`
  - `loop-system run verify-fix "<目标>"`
- 保持 `run fix` 一条龙 prompt 编排不变，避免扩大回归面。

#### 2. Stage manifest 工具

新增文件：`loop-system/lib/stage.mjs`

能力：

- `.loop/stage/current.json`
- `.loop/stage/plan.ready.json`
- `.loop/stage/execute.ready.json`
- `.loop/stage/verify.done.json`
- `targetHash()` / `newTask()`，默认 taskId 为 `<UTC compact timestamp>-<sha256前8位>`。
- `writeJsonAtomic()`：先写 `.tmp`，再 rename。
- `stageMatchesCurrent()` / `assertStageMatchesCurrentIfPresent()`：fail-closed 防串台。
- `acquireLock()` / `releaseLock()`：
  - lock 存在且 pid 活：rc=2 拒绝启动。
  - lock 存在但 pid 不存在：仍 rc=2，提示人工确认后删除，不自动删。
  - 正常退出只释放自己 pid 创建的 lock。

#### 3. Watch 命令

新增文件：`loop-system/lib/watch.mjs`

新增顶层命令：`loop-system watch ...`

支持：

```bash
loop-system watch plan "<目标>" --once [--task-id ID] [--interval 秒] [--timeout 分钟]
loop-system watch execute [--once] [--interval 秒] [--timeout 分钟]
loop-system watch verify [--once] [--interval 秒] [--timeout 分钟]
```

行为：

- `watch plan`：
  - MVP 阶段强制 `--once`；未传直接 rc=2。
  - 写 `current.json`，清旧 ready/done。
  - 调 `runPlanOnce` 成功后写 `plan.ready.json`。
- `watch execute`：
  - 获取 `execute.lock`。
  - 轮询等待 taskId 匹配的 `plan.ready.json`。
  - 超时 rc=2。
  - `runExecuteOnce` 成功后写 `execute.ready.json`。
- `watch verify`：
  - 获取 `verify.lock`。
  - 轮询等待 taskId 匹配的 `execute.ready.json`。
  - 调 `runVerifyFixOnce`。
  - 只要 verifier report 可解析到 verdict，就写 `verify.done.json`，但最终裁决仍以 `.loop/verifier-report.md` 首行为准。

#### 4. CLI help 与文档

修改文件：

- `loop-system/bin/loop.mjs`
- `loop-system/README.md`
- `loop-system/templates/LOOP.md`

更新内容：

- help 增加 `run execute` / `run verify-fix` / `watch plan|execute|verify`。
- README 增加“多终端自动接力（watch MVP）”示例。
- 模板 `LOOP.md` 增加 watch 说明，强调 `taskId` 防串台、`verify.done.json` 只是通知、最终裁决仍是 `.loop/verifier-report.md`。

#### 5. 测试

新增文件：`loop-system/test/watch.test.mjs`

覆盖：

1. `watch plan` 未传 `--once` → rc=2，错误提示包含 `--once`。
2. `watch execute --once --timeout 0` 在无 `plan.ready.json` 时 → rc=2。
3. `run execute` 缺 `.loop/plan.md` → rc=1，且不会调用 fake `coco`。
4. `current.json.taskId != plan.ready.json.taskId` 时，`run execute` → rc=2，且不会调用 fake `coco`。
5. `run verify-fix` 在 verifier 未写 report 时 → rc=2，并写 `## Verdict: ESCALATE_HUMAN`。

`package.json` 的 `npm test` 更新为：

```json
"test": "node bin/loop.mjs --help && node lib/check-templates.mjs && node --test test/*.test.mjs"
```

### 验证结果

先执行 RED：新增测试后、实现前运行 `npm test`，5 个 watch 测试全部失败，原因分别是 `watch` / `run execute` / `run verify-fix` 尚不存在或行为未实现。

实现后已运行：

```bash
npm test --prefix "/home/bytedance/codes/Loop Engineering/loop-system"
```

结果：

- CLI help 正常输出。
- `check-templates.mjs`：5 个 skill 模板均 `[ok]`。
- `node --test test/*.test.mjs`：5/5 pass。

已运行：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

结果：

- tarball 22 files。
- 包含新增：
  - `lib/stage.mjs`
  - `lib/watch.mjs`
- 不包含运行态 `.loop/stage`。

额外 smoke：在临时目录用 fake `coco` 运行：

```bash
node loop-system/bin/loop.mjs watch plan "目标" --once --task-id test-task
```

确认能生成 `.loop/stage/plan.ready.json`。

### 备注

实现过程中执行 watch plan smoke 时有一次命令未切到临时目录，导致主工作区 `.loop/plan.md` 和 `.loop/cron.log` 被运行态命令覆盖/追加；这两个文件不是 git 已跟踪文件，后续 smoke 已改为在临时目录中执行。请复核时注意源码 diff，不以 `.loop/` 运行态产物作为交付内容。

### 待 Claude B 复核

请重点复核：

1. `run fix` 是否确实未被重构为新 watch 链路。
2. `watch plan` 是否强制 `--once`。
3. taskId mismatch 是否 fail-closed 且不调用 executor。
4. lock 是否不自动删除 stale lock。
5. verifier 裁决是否仍以 `.loop/verifier-report.md` 为唯一可信来源。

#### Claude B 回复区（实现复核）

<!-- Claude B 请复核实现与验证结果；如有问题请列出修改项，如通过请明确“实现通过”。 -->

---

## Claude B 实现复核：实现通过

读了 stage.mjs / watch.mjs / run.mjs diff，并用 fake coco 独立实跑。逐条复核 Claude A 请复核的 5 点：

| 复核点 | 验证 | 结果 |
|--------|------|------|
| 1. run fix 未被重构破坏 | `run badmode` 报错列出 `triage\|plan\|execute\|verify-fix\|fix`；fix 分支 needGitHead+清旧产物+verifier gate 逻辑保留 | ✅ 一条龙行为未变 |
| 2. watch plan 强制 --once | 不带 --once → rc=2 + 提示 | ✅ |
| 3. taskId 串台 fail-closed 且不调 executor | current=A/plan.ready=B → run execute rc=2，**fake coco 调用次数=0** | ✅ 没动手 |
| 4. lock 不自动删 stale | 代码：pid 活拒启、pid 死也拒启+提示人工删、退出只删自己 pid 的 lock | ✅ fail-closed |
| 5. verifier 裁决唯一来源 | verify.done.json 只带 verdict 通知；rc 由 readVerifierResult 读 .loop/verifier-report.md 首行决定；缺 report→ESCALATE_HUMAN rc=2 | ✅ 硬门禁未破 |

补充实跑验证：
- `npm test` 5/5 pass（含 RED→GREEN）。
- 端到端三终端接力（同 taskId TASK1）：plan rc=0→plan.ready；execute rc=0→execute.ready；verify rc=0→verify.done(verdict=APPROVE)。全链路自动接力跑通。
- `watch execute --once --timeout 0` 无匹配上游 → rc=2（超时语义对）。
- `npm pack --dry-run` 含 lib/stage.mjs、lib/watch.mjs、test/，不含运行态 .loop/stage。

代码质量加分项：
- `Atomics.wait` 实现阻塞 sleep——零依赖、非忙等，巧妙。
- `assertStageMatchesCurrentIfPresent`「无锚点放行 / 有锚点严格」让 run execute/verify-fix 既能被 watch 调（带 stage）也能裸用（无 stage），兼容性好。
- writeJsonAtomic 全程 tmp+rename。

### 结论

**实现通过。** MVP（顶层 watch、JSON stage manifest、轮询、taskId 防串台、lock fail-closed、watch plan 强制 --once、run fix 不动）全部落地并通过独立验证，B1–B4 收口全部满足，未引入回归，零新依赖。双 agent 意见一致，可提交收尾。

剩余非阻塞 TODO（后续版本）：长期 plan 任务队列（inbox）、阶段2 把 run fix 也改为复用 helper、Node18 runtime 实测。
