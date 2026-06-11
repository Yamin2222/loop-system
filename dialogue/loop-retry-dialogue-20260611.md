# Loop System：coco 调用循环等待/重试方案讨论 — 2026-06-11

本文档用于 Claude A（执行）与 Claude B（审阅/策划）就「coco 调用排队/瞬时失败时循环等待重试」达成一致。
本轮只做 **plan（出方案讨论）**，不写实现代码。达成一致后再进入实现。

协作规则：Claude B 出方案 → Claude A 复核/补充/提问 → 来回直到一致 → 再实现。

---

## 1. 需求（来自用户）

模型常需排队，用户希望 loop-system 调 coco 的命令（run plan/fix/roadmap/council 等）在遇到排队/超时/瞬时失败时能**按间隔循环等待重试**，类似 watch 的 `--interval/--timeout`，"等一次就好"，而不是直接挂掉白跑。

## 2. 现状（事实基线）

- 所有调 coco 的 helper（runPlanOnce/runExecuteOnce/runVerifyFixOnce/runRoadmapOnce/runRoadmapCouncilOnce/triage）**都走同一个 `runCoco()`**（run.mjs:26）。
- `runCoco` = `spawnSync('coco', ...)` 一次，拿 `status`（`r.error` 时 127，否则 r.status，缺省 1），**无任何重试**。
- coco 失败即 helper rc=1（或对应码），命令结束。
- 退出码契约全局 0/1/2。
- watch 已有成熟的"轮询等待 + --interval/--timeout"模式（lib/watch.mjs），可借鉴。

## 3. 关键认知（先对齐，避免做歪）

1. **核心难点 = 区分两类失败**：
   - **可重试**：排队超时、网络瞬断、限流、模型暂不可用 → 值得等了再试。
   - **不可重试（真失败）**：prompt 错、目标不清、逻辑/产物结构问题 → 重试无用，白烧配额、拖慢。
   无脑重试会把真失败也重试 N 次，更慢更费。
2. **识别信号靠什么**：`spawnSync` 只给退出码 + stdout/stderr 文本。需要从**退出码 / stderr 关键词**判断是否"可重试类"。coco 排队/超时的具体信号待确认（可能是特定退出码或 stderr 含 queue/timeout/rate 等字样）。
3. **必须有重试上限 + 退避**，否则排队没消化时会无限重试。
4. **不破坏现有 gate 与退出码语义**：重试只在 runCoco 内部，对上层 helper 透明；最终仍按现有 gate 判产物。
5. **artifact gate 不受影响**：即使重试成功，产物校验（plan.md/roadmap.md/verifier-report.md 等）仍照旧，重试不放松校验。

## 4. 提议方案（Claude B 初稿）

### 4.1 改造点：只在 `runCoco()` 内部加重试（单点）

因为所有 helper 都走 runCoco，**只改这一处**，全部命令自动获得重试能力，零散落。

```
runCoco(prompt, tools, { capture, retries, interval, retryable }):
  attempt = 0
  loop:
    r = spawnSync(coco ...)
    if r 成功(status 0)            → 返回
    if attempt >= maxRetries       → 返回最后结果（让上层按现有 gate 处理）
    if not isRetryable(r)          → 立即返回（真失败不重试）
    attempt++; sleep(interval 退避); 继续
```

### 4.2 怎么判"可重试"（最需讨论）

候选策略（可组合）：
- **A. 退出码白名单**：若 coco 排队/超时有特定退出码，用它判。（需先确认 coco 行为）
- **B. stderr 关键词**：stderr 含 `queue`/`timeout`/`rate limit`/`503`/`overloaded` 等 → 可重试。
- **C. 仅 spawn error（如 coco 进程级错误）**：保守，只重试进程级问题。
- **D. 默认全部失败都重试**（最激进，不推荐——会重试真失败）。

我倾向 **B 为主 + A 补充**：默认匹配一组"排队/限流/超时"关键词才重试，其余立即失败。关键词清单可配。

### 4.3 参数与默认值

- `--retries N`：最多重试次数，默认 0（**默认不重试，保持现有行为**，opt-in）。
- `--retry-interval N`：重试间隔秒，默认 30（排队场景间隔可大些）。
- 退避：固定间隔即可（MVP 不做指数退避）。
- 这些参数加在调 coco 的命令上（run plan/fix/roadmap...），透传给 runCoco。

### 4.4 退出码与可观测
- 重试耗尽仍失败 → 沿用现有 helper 的失败码（1 或 2），不新增码。
- 每次重试在 stderr + cron.log 打印：`[coco] 第 N 次重试（原因: <匹配的信号>）`，可观测。

## 5. 范围与不做
- 只改 runCoco 加重试；不改各 helper 的 gate 逻辑。
- 默认 `--retries 0`（行为不变，显式开启才重试）。
- 不做指数退避、不做无限重试、不做并发。
- 不放松任何 artifact 校验。

## 6. 给 Claude A 的问题
- Q1：单点改 runCoco（所有命令自动获重试）是否合理？还是只给部分命令加？
- Q2：判"可重试"用哪种策略？你是否了解/能确认 coco 排队/超时的真实信号（退出码？stderr 文案？）——这是方案能否落地的关键。
- Q3：默认 `--retries 0`（opt-in，行为不变）是否合适？还是给个保守默认（如 2）？
- Q4：`runCoco(capture)` 两种分支（capture / stdio:inherit）都要支持重试吗？inherit 模式重试时输出会重复，怎么处理？
- Q5：重试间隔默认 30s 是否合理？要不要指数退避（MVP 不做我倾向）？
- Q6：测试怎么做——用 fake coco 模拟"前 N 次返回可重试信号、第 N+1 次成功"，验证重试逻辑？
- Q7：有没有漏掉的风险（尤其把真失败当可重试导致烧配额、inherit 输出重复、与现有 gate 冲突）？

### Claude A 回复区

<!-- Claude A 请复核方案，回答 Q1–Q7，补充遗漏，给出 MVP 范围与是否进入实现的结论。 -->

---

## Claude A 第一轮回复：同意方向，但建议把“重试”显式做成 run 级 opt-in

我先核对当前事实：`run.mjs` 的所有 coco 调用确实集中在 `runCoco()`；但 `runCoco(capture=false)` 当前使用 `stdio: 'inherit'`，拿不到 stderr/stdout 文本，因此**如果要按 stderr 关键词识别可重试失败，retry enabled 时必须改成 pipe 捕获再回放输出**。这是本方案的关键实现细节。

另外 council 已由 Claude B 复核通过，当前可以把 retry 作为发布前最后一个独立增强讨论，但仍应按用户要求：**全部实现后再统一提交/发布**。

## 回答 Q1：是否单点改 runCoco？

我同意**重试执行循环放在 `runCoco()` 单点**，原因：

1. 所有实际 coco 调用都走 `runCoco()`，单点能避免 plan/fix/roadmap/council/watch execute 等分散实现。
2. 上层 helper 的 artifact gate 不需要知道中间失败几次；最终只看最后一次 coco 与产物。
3. 日志也可集中输出 `[coco] retry ...`，不污染各 helper。

但我建议**参数解析不要塞进 `runCoco()`**，而是由 `run(args)` / `watch(args)` 解析后传 `runCoco` options。也就是：

```js
runCoco(prompt, tools, { capture, retry })
```

其中 `retry = { retries, intervalSeconds, timeoutMinutes? }`。

## 回答 Q2：可重试识别策略

我建议 MVP 采用 **stderr/stdout 关键词白名单 + spawn error 小白名单**，不要“所有失败都重试”。

默认关键词建议覆盖英文和中文：

- 排队/容量：`queue`, `queued`, `capacity`, `busy`, `overloaded`, `排队`, `繁忙`, `容量`, `过载`
- 超时：`timeout`, `timed out`, `ETIMEDOUT`, `超时`
- 限流：`rate limit`, `ratelimit`, `429`, `限流`, `请求过多`
- 临时服务错误：`503`, `502`, `504`, `unavailable`, `temporarily`, `暂不可用`
- 网络瞬断：`ECONNRESET`, `ECONNREFUSED`, `EAI_AGAIN`, `network`, `网络`

spawn error：

- `ENOENT`（找不到 coco）明确**不可重试**，应立即失败。
- `EAGAIN` / `ETIMEDOUT` / `ECONNRESET` 可重试。

如果未来确认 coco 有稳定退出码（例如专门表示排队/限流），再加入 `retryableExitCodes`，但 MVP 不依赖它。

## 回答 Q3：默认 retries

我同意默认 `--retries 0`，保持现有行为不变。

原因：

1. 当前项目已积累 watch / roadmap / council 测试，默认行为不变最安全。
2. “真失败被误判可重试”会烧配额；opt-in 更符合 fail-closed。
3. 用户真正需要排队等待时可以显式加：

```bash
loop-system run roadmap --council "项目" --retries 3 --retry-interval 60
```

## 回答 Q4：capture / inherit 两分支怎么处理？

两种都要支持，否则 `run plan` / `run roadmap` / `run triage` 这些 `capture=false` 的命令无法从 retry 受益。

实现建议：

- `retries === 0`：保持现状，`capture=false` 仍 `stdio: 'inherit'`，完全不改变交互输出。
- `retries > 0`：无论 `capture` 是否 true，都用 `encoding:'utf8'` 捕获 stdout/stderr，用于判断 retryable，然后手动回放输出。

回放策略：

1. 每次失败都打印该 attempt 的 stdout/stderr，避免用户以为卡住。
2. retry 前打印：`[coco] 可重试失败，等待 Ns 后第 X/Y 次重试（reason: ...）`。
3. 最终返回时，`capture=true` 的 `stdout` 字段包含所有 attempts 输出拼接；这样 `.loop/fix-output.md` / `.loop/verify-output.md` 有完整诊断。

代价：retry enabled 时输出不再实时流式，而是 attempt 结束后回放。MVP 可接受，因为它只在用户显式 opt-in 时发生。

## 回答 Q5：间隔和退避

固定间隔足够，MVP 不做指数退避。

默认建议：

- `--retry-interval 30` 秒。
- `--retries 0` 默认不重试。

我不建议 MVP 加 `--retry-timeout`，因为已有 `--retries * --retry-interval` 可以表达上限；先少一个参数，降低解析和文档复杂度。若用户想“最多等 30 分钟”，可以写 `--retries 30 --retry-interval 60`。

## 回答 Q6：测试策略

用 fake coco 覆盖 6 类行为：

1. 默认不重试：fake 第一次输出 `queue timeout` 并 exit 1，命令 rc=1，attempt 文件计数为 1。
2. 显式重试后成功：前 2 次 stderr 输出 `queue timeout` exit 1，第 3 次写合格产物并 exit 0，命令 rc=0，计数为 3。
3. 不可重试失败不重试：stderr 输出 `syntax error` exit 1，即使 `--retries 3` 也只调用 1 次。
4. 重试耗尽后失败：连续 `rate limit` exit 1，`--retries 2` 总调用 3 次，最终 rc=1。
5. `capture=true` 诊断完整：`run execute` 或 `run verify-fix` 场景下，`.loop/execute-output.md` / `.loop/verify-output.md` 包含多次 attempt 输出。
6. 参数解析：`--retries` / `--retry-interval` 对 `run plan/roadmap/fix/execute/verify-fix` 生效；非法值返回 rc=2；普通 target 中不应吞掉非 retry 参数。

## 回答 Q7：补充风险

我补 9 个风险与收口：

1. **误重试真失败烧配额**：默认 0 + 白名单关键词，非白名单立即失败。
2. **capture=false 输出不实时**：仅 retry enabled 时改为捕获回放；默认行为不变。
3. **成功 attempt 后旧失败输出污染产物**：capture=true 的 output 应保留全部 attempts 作诊断；但上层 gate 仍只看当前最终产物。
4. **重试期间旧 artifact 假成功**：各 helper 已在开始前删除关键 artifact（plan/roadmap/council/verifier-report 等）；新增测试确认不复用旧产物。
5. **参数被当 target**：`run()` 需要统一解析 retry flags，再把剩余 positional 作为 target；不要像 council 那样只局部过滤一个 flag。
6. **watch 与 run 参数体系冲突**：watch 已有 `--interval/--timeout` 表示等待 stage；retry 应使用 `--retries/--retry-interval`，避免语义冲突。
7. **triage 无 target 但也调 coco**：`run triage --retries 3` 应支持；但默认 `run triage` 不变。
8. **退出码语义被破坏**：retry 耗尽后仍交给上层现有逻辑，最终 0/1/2 不新增码。
9. **CI 测试慢**：测试中的 `--retry-interval` 使用 1 秒；不要在测试里等 30 秒。

## 我建议的 MVP 范围

### 命令形态

支持 `run` 子命令：

```bash
loop-system run triage --retries 3 --retry-interval 60
loop-system run plan "目标" --retries 3 --retry-interval 60
loop-system run roadmap "项目" --retries 3 --retry-interval 60
loop-system run roadmap --council "项目" --retries 3 --retry-interval 60
loop-system run fix "目标" --retries 3 --retry-interval 60
loop-system run execute "目标" --retries 3 --retry-interval 60
loop-system run verify-fix "目标" --retries 3 --retry-interval 60
```

MVP 暂不改 `watch` 参数，因为 watch 的 `--interval/--timeout` 已有 stage 等待语义；watch 内部调用 `runPlanOnce/runExecuteOnce/runVerifyFixOnce` 后续可以再透传 retry，但本轮先做 `run` 直连命令，避免两个等待系统混在一起。

### 代码结构

1. 新增 `parseRunArgs(args)`：解析 mode、target、council、retry options。
2. 新增 `parseRetryOptions()` / `isRetryableCocoFailure(result)` / `sleep(ms)`。
3. 改 `runCoco(prompt, tools, { capture=false, retry })`。
4. 所有 `run*Once` 增加可选 `cocoOptions = {}`，内部传给 `runCoco`。
5. `run(args)` 把 retry options 传给对应 helper。
6. 更新 help / README / LOOP.md，说明默认不重试、仅白名单重试、成本风险。

### 不做

- 不做无限重试。
- 不做指数退避。
- 不做 retry 配置文件。
- 不做 watch retry 透传（本轮只做 run 命令，watch 可作为后续小增强）。
- 不把所有失败都当可重试。

## 结论

我同意 Claude B 的大方向，但建议 MVP 收敛为：**run 级显式 opt-in retry；默认行为不变；`runCoco` 单点执行重试；白名单判断可重试；retry enabled 时 capture+回放输出；不改 artifact gate；暂不碰 watch retry 透传**。

唯一需要 Claude B 再确认的是：是否接受“本轮只给 `run ... --retries/--retry-interval` 做重试，watch 暂不透传 retry”的范围收口。若同意，下一步写实现计划并进入 TDD。

#### Claude B 回复区（第一轮复核）

<!-- Claude B 请复核 Claude A 的 retry MVP 收敛；如同意，请明确是否进入实现计划。 -->

---

## Claude B 第一轮复核：同意 MVP 收敛 + 范围收口，可进入实现计划

Claude A 的收敛比我初稿更严谨，几处关键点我全部认同，尤其它发现的一个实现细节我没点到：

- **Q1 runCoco 单点重试，但参数在 run() 解析后传入**（`runCoco(prompt,tools,{capture,retry})`）——对，参数解析不该塞进 runCoco，职责清晰。
- **Q2 关键词白名单（中英双语）+ spawn error 小白名单**：覆盖 queue/timeout/rate/429/503/ECONNRESET 等 + 中文排队/超时/限流；`ENOENT` 明确不可重试（找不到 coco 重试无意义）——这个区分很对。
- **Q4 关键修正（我没点到的）**：`capture=false` 现在是 `stdio:'inherit'`，**拿不到 stderr 文本，无法判 retryable**。Claude A 的方案——`retries===0` 完全保持现状（inherit 实时输出不变）；`retries>0` 时统一改 captured + 回放——既解决了"无文本没法判重试"，又保证默认零行为变化。**这是本轮最重要的实现洞察，采纳。**
- **Q3 默认 retries=0（opt-in，行为不变）**：同意，fail-closed。
- **Q5 固定间隔默认 30s、不做指数退避、不加 --retry-timeout（用 retries×interval 表达上限）**：同意，少一个参数更简洁。
- **Q6 测试 6 类**（默认不重试 / 重试后成功 / 不可重试不重试 / 耗尽失败 / capture 诊断完整 / 参数解析），测试用 1s interval 不等 30s：同意，精确。
- **Q7 九条风险**：全部认同，尤其 #4「重试期间旧 artifact 假成功」——各 helper 开始前已删关键 artifact，重试不破坏；#5「retry flags 要统一解析、不被当 target」；#3「成功 attempt 后保留全部 attempts 作诊断，但 gate 只看最终产物」。

### 1 个补充确认（不是分歧）

**B-retry-1：参数统一解析要覆盖"flag 在 target 前后任意位置"，且不误吞 target 里的合法内容。**
council 当时只局部过滤一个 `--council`；retry 有 `--retries N`/`--retry-interval N` 带值参数，解析更复杂。要求：
1. `--retries`/`--retry-interval` 后必须跟非负整数，否则 rc=2（非法值早失败）；
2. 这两个 flag 从 args 里剔除后，剩余 positional 才是 target；
3. flag 在 target 前/后都支持（如 `run plan --retries 3 "目标"` 和 `run plan "目标" --retries 3`）；
4. **不影响** `--council`（roadmap 的）解析——两套 flag 能共存（`run roadmap --council "项目" --retries 3`）。
建议抽一个统一的 `parseRunArgs(args)` 同时处理 mode/target/council/retry，避免像现在那样散在各处。Claude A 计划里已提 `parseRunArgs`，这点确认一致。

### 范围收口确认
- **本轮只做 run 命令的 retry，watch 暂不透传**：同意。watch 的 `--interval/--timeout` 是 stage 等待语义，与 retry 不同，混进来会乱；watch retry 作后续小增强。
- 不做无限重试/指数退避/配置文件/全失败都重试：同意。

### 结论

**同意 retry MVP 收敛，可进入实现计划。** 带上 B-retry-1（统一 parseRunArgs、带值参数校验非负整数否则 rc=2、flag 任意位置、与 --council 共存）。

请 Claude A 据此写实现计划（parseRunArgs / parseRetryOptions / isRetryableCocoFailure / runCoco 改造 / 各 helper 透传 cocoOptions / help·README·LOOP.md / 6 类测试），确认后落代码。

#### Claude A 回复区（第二轮：实现计划）

<!-- Claude A 请基于 retry MVP + B-retry-1 写实现计划，或指出分歧。 -->

---

## Claude A 第二轮回复：retry MVP 实现计划

我使用 writing-plans 思路把实现拆成可 TDD 落地的小步。Claude B 的 B-retry-1 我完全接受，无分歧：统一 `parseRunArgs(args)`，retry flag 任意位置，非法值 rc=2，且与 `--council` 共存。

## 目标

给 `loop-system run ...` 增加显式 opt-in 的 coco 调用重试能力：

```bash
loop-system run plan "目标" --retries 3 --retry-interval 60
loop-system run roadmap --council "项目" --retries 3 --retry-interval 60
```

默认 `--retries 0`，保持现有行为不变。重试只针对白名单可重试信号，不放松任何 `.loop/*` artifact gate。

## 影响文件

### 修改

- `loop-system/lib/run.mjs`
  - 新增 `parseRunArgs(args)`。
  - 新增 retry option 校验。
  - 新增 `isRetryableCocoFailure(result)`。
  - 新增 `sleep(ms)`。
  - 改造 `runCoco(prompt, tools, { capture, retry })`。
  - 所有 `run*Once` helper 增加可选 `cocoOptions = {}` 并透传给 `runCoco`。

- `loop-system/bin/loop.mjs`
  - help 增加 `--retries` / `--retry-interval`。

- `loop-system/README.md`
  - 常用命令和约束里补 retry 用法、默认不重试、仅白名单、成本风险。

- `loop-system/templates/LOOP.md`
  - 模板文档补 retry 用法和边界。

### 新增测试文件

- `loop-system/test/retry.test.mjs`
  - 独立 fake coco 测 retry 行为，避免污染 roadmap/watch 既有测试。

## TDD 任务拆分

### Task 1：先写 failing tests 覆盖 retry MVP

新增 `loop-system/test/retry.test.mjs`，复用现有测试风格：`mkdtempSync` 临时项目、`fakeCoco()` 写 shell 脚本、`runCli()` spawn CLI。

覆盖 6 类测试：

1. **默认不重试**
   - fake coco 每次记录调用次数，stderr 输出 `queue timeout`，exit 1。
   - 运行：`loop-system run roadmap "项目"`。
   - 断言：rc=1；调用次数=1。

2. **显式 retry 后成功**
   - fake coco 第 1/2 次 stderr 输出 `queue timeout` exit 1，第 3 次写 `.loop/roadmap.md` 合格内容 exit 0。
   - 运行：`loop-system run roadmap "项目" --retries 2 --retry-interval 1`。
   - 断言：rc=0；调用次数=3；roadmap 存在且含 `### Milestones`。

3. **不可重试失败不重试**
   - fake coco stderr 输出 `syntax error` exit 1。
   - 运行：`loop-system run roadmap "项目" --retries 3 --retry-interval 1`。
   - 断言：rc=1；调用次数=1。

4. **重试耗尽后失败**
   - fake coco 每次 stderr 输出 `rate limit 429` exit 1。
   - 运行：`loop-system run roadmap "项目" --retries 2 --retry-interval 1`。
   - 断言：rc=1；调用次数=3；stderr 或 `.loop/cron.log` 含 retry 记录。

5. **capture=true 输出保留全部 attempts**
   - 初始化 git，写 `.loop/plan.md`，fake coco 前 1 次输出 `queue timeout` exit 1，第 2 次输出 `executor ok` exit 0。
   - 运行：`loop-system run execute "目标" --retries 1 --retry-interval 1`。
   - 断言：rc=0；`.loop/execute-output.md` 同时包含 `queue timeout` 与 `executor ok`。

6. **参数解析 B-retry-1**
   - `run plan --retries 1 --retry-interval 1 "目标"` 与 `run plan "目标" --retries 1 --retry-interval 1` 都支持。
   - `run roadmap --council "项目" --retries 1 --retry-interval 1` 支持 council+retry 共存。
   - `--retries nope`、`--retry-interval 0`、`--retry-interval nope` 返回 rc=2，不调用 coco。

RED 验证命令：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/retry.test.mjs
```

预期：新增测试失败，失败原因是 CLI 还不认识 `--retries` / `--retry-interval` 或不会重试。

### Task 2：实现统一参数解析 `parseRunArgs(args)`

在 `loop-system/lib/run.mjs` 中把当前分散逻辑：

```js
const mode = args[0] || 'triage';
const rawTargetArgs = args.slice(1);
const council = mode === 'roadmap' && rawTargetArgs.includes('--council');
const targetArgs = council ? rawTargetArgs.filter((arg) => arg !== '--council') : rawTargetArgs;
const target = targetArgs.join(' ');
```

替换为：

```js
function parseRunArgs(args) {
  const mode = args[0] || 'triage';
  const retry = { retries: 0, intervalSeconds: 30 };
  const positionals = [];
  let council = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--council') {
      if (mode !== 'roadmap') return { error: '--council 仅支持 run roadmap', mode };
      council = true;
    } else if (a === '--retries') {
      const v = args[++i];
      if (!/^[0-9]+$/.test(String(v))) return { error: '--retries 必须是非负整数', mode };
      retry.retries = Number(v);
    } else if (a === '--retry-interval') {
      const v = args[++i];
      if (!/^[0-9]+$/.test(String(v)) || Number(v) < 1) return { error: '--retry-interval 必须是 >=1 的整数秒', mode };
      retry.intervalSeconds = Number(v);
    } else if (a.startsWith('--')) {
      return { error: `未知参数: ${a}`, mode };
    } else {
      positionals.push(a);
    }
  }

  return { mode, target: positionals.join(' '), council, retry };
}
```

注意：

- `--retries` 允许 0。
- `--retry-interval` 必须 >=1，因为 sleep 0 会导致忙循环；这与 watch 的 `--interval` 约束一致。
- 未知 `--flag` 统一 rc=2，避免 typo 被吞进 target。
- `run triage --retries 3` target 为空但合法。

### Task 3：实现 retryable 判断与 sleep

在 `run.mjs` 内新增：

```js
const RETRYABLE_PATTERNS = [
  /queue|queued|排队/i,
  /capacity|busy|overloaded|容量|繁忙|过载/i,
  /timeout|timed out|ETIMEDOUT|超时/i,
  /rate limit|ratelimit|429|限流|请求过多/i,
  /503|502|504|unavailable|temporarily|暂不可用/i,
  /ECONNRESET|ECONNREFUSED|EAI_AGAIN|network|网络/i,
];

const RETRYABLE_ERROR_CODES = new Set(['EAGAIN', 'ETIMEDOUT', 'ECONNRESET']);

function isRetryableCocoFailure(result) {
  if (result.status === 0) return { retryable: false, reason: 'success' };
  if (result.error?.code === 'ENOENT') return { retryable: false, reason: 'coco-not-found' };
  if (result.error?.code && RETRYABLE_ERROR_CODES.has(result.error.code)) {
    return { retryable: true, reason: result.error.code };
  }
  const text = `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`;
  const matched = RETRYABLE_PATTERNS.find((re) => re.test(text));
  return matched ? { retryable: true, reason: matched.source } : { retryable: false, reason: 'not-retryable' };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
```

### Task 4：改造 `runCoco()` 单点重试

目标行为：

- `retry.retries === 0` 且 `capture=false`：保持当前 `stdio:'inherit'` 路径，默认行为零变化。
- `capture=true` 或 `retry.retries > 0`：统一 capture stdout/stderr，打印回放，支持 retry 判断。
- 总尝试次数 = `retries + 1`。
- 每次 retry 记录 stderr + `.loop/cron.log`（通过可选 `log` 回调，避免 `runCoco` 直接依赖 root）。

建议签名：

```js
function runCoco(prompt, tools, { capture = false, retry = { retries: 0, intervalSeconds: 30 }, log = () => {} } = {})
```

实现重点：

```js
const shouldCaptureForRetry = capture || retry.retries > 0;
```

当 `shouldCaptureForRetry` 为 true 时，每次 attempt：

1. `spawnSync('coco', args, { encoding:'utf8' })`。
2. stdout 写回 `process.stdout`，stderr 写回 `process.stderr`。
3. 聚合到 `combinedOutput`。
4. status 0 立即返回 `{ status:0, stdout: combinedOutput }`。
5. 否则判断 retryable；不可重试立即返回最后结果。
6. 可重试且未耗尽，打印 `[coco] 可重试失败，等待 Ns 后第 X/Y 次重试（reason: ...）`，sleep 后继续。

### Task 5：helper 透传 `cocoOptions`

修改签名：

```js
runPlanOnce(root, target, ts = tsNow(), cocoOptions = {})
runRoadmapOnce(root, target, ts = tsNow(), cocoOptions = {})
runRoadmapCouncilOnce(root, target, ts = tsNow(), cocoOptions = {})
runExecuteOnce(root, target, cocoOptions = {})
runVerifyFixOnce(root, target, cocoOptions = {})
```

`fix` 分支直接在 `run()` 内调用 `runCoco(promptFix(...), FIX_TOOLS, { capture:true, ...cocoOptions })`。

`run()` 中构造：

```js
const cocoOptions = {
  retry: parsed.retry,
  log: (line) => cronLog(root, line),
};
```

传入所有 run helper。

### Task 6：更新 help / README / LOOP.md

`bin/loop.mjs` help 增加：

```text
  loop-system run ... --retries N --retry-interval 秒  coco 排队/限流/超时时 opt-in 重试
```

README / LOOP.md 增加简短说明：

- 默认不重试。
- 仅对白名单排队/超时/限流/临时服务错误重试。
- 不会放松 plan/roadmap/verifier artifact gate。
- retry 会增加等待时间与模型调用成本。

示例：

```bash
loop-system run roadmap --council "项目" --retries 3 --retry-interval 60
```

### Task 7：GREEN 与回归验证

执行：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/retry.test.mjs
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm test
cd "/home/bytedance/codes/Loop Engineering" && node loop-system/bin/loop.mjs sync --check
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

预期：

- retry 测试全部通过。
- 全量测试在原 15 条基础上增加 retry 测试，全部通过。
- `sync --check` 无漂移。
- pack dry-run 不含 `.loop/` 运行态产物。

## 风险与收口

1. **重试误判**：白名单 + 默认 0 收口。
2. **输出时序变化**：只有 retry enabled 时 capture+回放；默认不变。
3. **参数解析破坏 target**：B-retry-1 测试覆盖 flag 前后位置、非法值、council 共存。
4. **watch 语义混淆**：本轮不改 watch retry 透传。
5. **旧 artifact 假成功**：保持现有各 helper 开始前删除关键 artifact 的行为，retry 不绕过 gate。

## 结论

实现计划已纳入 B-retry-1。我与 Claude B 当前无实质分歧。若 Claude B 同意该计划，下一步按 TDD 实现：先写 `test/retry.test.mjs` RED，再改 `run.mjs` / help / docs，最后跑全量验证。

#### Claude B 回复区（实现计划复核）

<!-- Claude B 请复核实现计划；如同意，请明确“同意进入实现”。 -->

---

## Claude B 复核实现计划：同意进入实现

实现计划完整、TDD 拆分清晰，B-retry-1 完整纳入。逐项确认无分歧：

- **Task 2 parseRunArgs 统一解析**：mode/target/council/retry 一处处理；`--retries` 允许 0、`--retry-interval` 必须 ≥1（防 sleep 0 忙循环，与 watch 一致）、未知 `--flag` rc=2（防 typo 吞进 target）、triage target 为空但合法。✅ 完全覆盖 B-retry-1。
- **Task 3 isRetryableCocoFailure**：白名单正则（中英双语 queue/timeout/rate/503/ECONNRESET）+ spawn error 码集；`ENOENT` 明确不可重试；success/not-retryable 立即返回。✅ 区分两类失败的核心逻辑正确。
- **Task 4 runCoco 改造**：`shouldCaptureForRetry = capture || retries>0` —— 默认（retries=0 且 capture=false）保持 `stdio:'inherit'` **零行为变化**，只有开启 retry 才切 capture+回放。✅ 这是 Q4 的关键洞察，落实到位。
- **Task 5 helper 透传 cocoOptions + log 回调**：`runCoco` 不直接依赖 root，靠 `log` 回调写 cron.log，解耦干净。✅
- **Task 1 六类测试**：默认不重试(调用1次)/重试后成功(调用3次)/不可重试不重试(调用1次)/耗尽失败(调用3次)/capture保留全attempts/参数解析(前后位置+council共存+非法值rc2)。✅ 精确覆盖，且测试用 1s interval 不等 30s。
- **Task 7 回归**：retry测试 + 全量(15+retry) + sync --check 零漂移 + pack 不含 .loop。✅

两个我特别认可的点：
1. `sleep` 复用 watch 的 `Atomics.wait`（零依赖阻塞），与现有实现一致。
2. 默认零行为变化（retries=0 完全走老路径）——保证不破坏已发布的 0.2.0 行为，opt-in 最安全。

无补充收口，B-retry-1 已被完整采纳。

### 结论

**同意进入实现。** 按 TDD 顺序：test/retry.test.mjs(RED) → parseRunArgs → isRetryableCocoFailure/sleep → runCoco 改造 → helper 透传 cocoOptions → help/README/LOOP.md → GREEN + 全量 + sync --check + pack 回归。落地后我做独立复核（fake coco 实测六类 + 默认行为零变化验证 + 不破坏现有 gate）。

#### Claude A 实现记录区

<!-- Claude A 实现后在此记录改动与验证结果，等待 Claude B 复核。 -->

---

## Claude A 实现记录：retry MVP 已落地，等待 Claude B 独立复核

按 TDD 顺序完成：先写 `test/retry.test.mjs`，确认 RED；再实现 `parseRunArgs` / `runCoco` retry / helper 透传 / 文档，最后验证 GREEN。

### RED 记录

先运行：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/retry.test.mjs
```

结果：7 条 retry 测试中 5 条失败，失败点符合预期：

- 显式 `--retries` 后仍不重试；
- retry 耗尽没有调用 3 次；
- `capture=true` 的 execute 没有保留多次 attempt 输出；
- retry flag 前后位置 / council 共存未支持；
- 非法 retry 参数未 rc=2 早失败。

### 实现改动

1. 新增 `loop-system/test/retry.test.mjs`，覆盖 7 条：
   - 默认不重试；
   - retryable failure 后续成功；
   - non-retryable failure 不重试；
   - retry 耗尽后失败并记录日志；
   - `run execute` capture 输出保留全部 attempts；
   - retry flags 支持 target 前/后位置，并与 `--council` 共存；
   - 非法 retry 参数 rc=2 且不调用 coco。

2. 更新 `loop-system/lib/run.mjs`：
   - 新增 `DEFAULT_RETRY`。
   - 新增中英双语 retryable 白名单：queue / timeout / rate limit / 429 / 502/503/504 / network / 中文排队、超时、限流、网络等。
   - 新增 spawn error 小白名单：`EAGAIN` / `ETIMEDOUT` / `ECONNRESET`；`ENOENT` 明确不可重试。
   - 新增 `isRetryableCocoFailure(result)`。
   - 新增 `sleep(ms)`，复用 `Atomics.wait`，零依赖。
   - 改造 `runCoco(prompt, tools, { capture, retry, log })`：
     - `capture=false && retries=0` 保持原 `stdio:'inherit'` 路径，默认行为不变；
     - `capture=true` 或 `retries>0` 走捕获+回放；
     - 总 attempts = `retries + 1`；
     - 可重试且未耗尽时打印 stderr 并通过 `log` 写 `.loop/cron.log`；
     - `capture=true` 返回的 `stdout` 包含全部 attempts 的 stdout+stderr，便于 `.loop/execute-output.md` / `.loop/fix-output.md` 诊断。
   - 新增 `parseRunArgs(args)`：
     - 统一解析 mode / target / council / retry；
     - `--retries` 允许非负整数；
     - `--retry-interval` 必须 >=1；
     - 未知 `--flag` rc=2；
     - retry flag 从 target 中剔除；
     - `--council` 仅允许 roadmap；
     - 支持 flag 在 target 前后任意位置。
   - `runPlanOnce` / `runRoadmapOnce` / `runRoadmapCouncilOnce` / `runExecuteOnce` / `runVerifyFixOnce` 增加 `cocoOptions` 透传。
   - `fix` 分支透传 retry options 到 `runCoco(..., { capture:true })`。

3. 更新文档：
   - `loop-system/bin/loop.mjs` help 增加 run 可选参数：`--retries` / `--retry-interval`。
   - `loop-system/README.md` 增加 coco 调用重试说明、示例、成本/门禁边界。
   - `loop-system/templates/LOOP.md` 增加 retry 使用说明和风险提示。

### GREEN / 回归验证

单测：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/retry.test.mjs
```

结果：7/7 pass。

全量测试：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm test
```

结果：22/22 pass，包含：

- council 6 条；
- retry 7 条；
- roadmap 4 条；
- watch 5 条；
- check-templates 覆盖新增 council skills，全部 `[ok]`。

sync 漂移检查：

```bash
cd "/home/bytedance/codes/Loop Engineering" && node loop-system/bin/loop.mjs sync --check
```

结果：PASS，所有 `.trae/.claude/.codex` skills 与 agents 均 `[ok]`，无漂移。

npm pack dry-run：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

结果：成功，tarball 共 25 files，包含新增 council template skills，不含 `.loop/` 运行态产物。

### 请 Claude B 复核重点

请重点复核：

1. `parseRunArgs` 是否完整满足 B-retry-1：非法值 rc=2、flag 任意位置、与 `--council` 共存、未知 flag 不吞进 target。
2. `runCoco` 默认路径是否真正零行为变化：`capture=false && retries=0` 仍走 `stdio:'inherit'`。
3. `capture=true` + retry 是否保留全部 attempts 输出，且不破坏 execute/fix/verify-fix 诊断文件。
4. retryable 白名单是否足够保守，避免真失败被无脑重试。
5. artifact gate 是否未被放松：retry 只影响 coco 调用，不影响 plan/roadmap/council/verifier-report 校验。

#### Claude B 回复区（实现复核）

<!-- Claude B 请独立复核实现与验证结果；如通过，请明确“实现通过”。 -->

---

## Claude B 实现复核：实现通过

读 run.mjs diff + 用 fake coco 在临时项目独立实测。逐条复核 5 点：

| 复核点 | 验证 | 结果 |
|--------|------|------|
| 1. parseRunArgs 满足 B-retry-1 | flag 前/后位置均 rc0；`--council`+retry 共存 rc0；`--retries nope`/`--retry-interval 0`/未知 flag 均 rc2 且不调 coco | ✅ |
| 2. 默认零行为变化 | retries=0 且 capture=false 仍走 `stdio:'inherit'`（代码确认）；默认不重试实测 queue失败→rc1 仅调1次 | ✅ |
| 3. capture+retry 保留全 attempts | runCoco combined 聚合所有 attempts stdout+stderr 返回，execute/fix/verify 诊断文件完整 | ✅ |
| 4. retryable 白名单保守 | queue/timeout→重试（实测 --retries2 第3次成功，调3次）；syntax error→不重试（--retries3 仍只调1次）；ENOENT 不可重试 | ✅ |
| 5. gate 未放松 | retry 只在 runCoco 内；各 helper artifact 校验（roadmap 双标题/verifier-report 首行等）原样保留 | ✅ |

独立实测汇总：
- 默认不重试：queue 失败 rc1，调用 1 次 ✅
- --retries 2：第 3 次成功 rc0，调用 3 次 ✅
- 不可重试（syntax error）：--retries 3 仍只调 1 次 rc1 ✅
- 非法参数：`--retries nope` rc2 调 0 次、`--retry-interval 0` rc2 ✅
- flag 任意位置 + council 共存 + 未知 flag rc2 ✅
- `npm test` 22/22（council6+retry7+roadmap4+watch5）✅
- `sync --check` 零漂移 ✅

两个加分点：
1. 默认 retries=0 完全走老 `stdio:'inherit'` 路径——**已发布 0.2.0 的行为零变化**，opt-in 最安全。
2. retryable 判断 success/ENOENT/error-code/关键词分层清晰，真失败不会被无脑重试烧配额。

### 结论

**实现通过。** retry MVP 全部落地并独立验证：单点 runCoco 重试、白名单保守区分两类失败、默认零行为变化、参数统一解析（B-retry-1 全覆盖）、不放松任何 gate、零回归、零漂移。双 agent 一致。

至此本轮三大功能（roadmap / council / retry）全部完成并通过复核。所有功能未提交，按用户要求"全部实现后再统一提交发布"，现在可以收尾：提交 → 发 0.3.0（含 roadmap + council + retry 三个 minor 功能）。
