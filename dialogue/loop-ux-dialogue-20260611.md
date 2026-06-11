# Loop System：使用体验重设计（统一入口 + 交互式规划 + 进度可见 + 反馈汇总）方案讨论 — 2026-06-11

本文档用于 Claude A（执行）与 Claude B（审阅/策划）就「使用体验重设计」达成一致。
本轮只做 **plan（出重设计方案）**，不写实现代码。达成一致后再决定实现范围。

协作规则：Claude B 出方案 → Claude A 复核/补充/提问 → 来回直到一致 → 再实现。

---

## 1. 用户反馈（原话提炼）

用户实际使用后觉得"没特别好用"，具体 4 点：

1. **入口太碎**：6+ 个子命令（run triage/plan/execute/verify-fix/fix/roadmap[--council]、watch plan/execute/verify、sync/verify/check），要记要选，"修个 bug 还得先想用哪个命令"。
2. **多终端联动不明显**：watch 三终端靠 `.loop/stage/*.json` 接力，但用户**看不到**"它们在互相传递、现在到哪一步、卡在哪"。
3. **大项目沟通不够**：复杂需求只能在命令行一句话 `"目标"` 里说，说不清；没有多轮对话把需求讲透的通道。
4. **反馈不直接**：结果散在 `.loop/plan.md` / `git diff` / `.loop/verifier-report.md`，没有"这次干了啥/行不行/下一步"的统一汇总。

用户明确诉求：
- 4 点**都要解决**。
- **保留现有入口但精简**，再**新增一个统一入口**。
- 本轮**先出重设计方案**，不急实现。

## 2. 现状（事实基线）

现有入口（lib/run.mjs / watch.mjs / bin/loop.mjs）：
- `run triage|plan|execute|verify-fix|fix`、`run roadmap [--council]`（带 `--retries/--retry-interval`）
- `watch plan|execute|verify`（`--once/--interval/--timeout`）
- `sync [--check]` / `verify [N]` / `check [--state N]`
- 产物散落 `.loop/`：plan.md / roadmap.md / council.md / verifier-report.md / execute-output.md / fix-output.md / stage/*.json / cron.log
- 退出码 0/1/2 全局统一。
- 已发布 0.2.0，本地待发 0.3.0（roadmap/council/retry）。

## 3. 核心矛盾（设计判断）

当前是"**命令行工具**思维（一条命令干一件事，用户选命令）"，用户要的是"**协作伙伴**体验（讲需求 → 自动判断该干啥 → 看得见进度 → 拿到汇总）"。重设计要弥合这个落差，但**不推翻已验证的底层能力**（triage/plan/fix/roadmap/council/watch/retry 都保留为底层，只是上面包一层好用的壳）。

## 4. 提议方案（Claude B 初稿，4 块对应 4 痛点）

### 4.1 统一入口（痛点1）—— `loop "<我想做什么>"`

新增一个顶层智能入口（不带子命令）：
```bash
loop-system "修复 login 空指针"
loop-system "从 0 做一个待办 Web 应用"
loop-system            # 无参数 → 进入交互式会话（见 4.2）
```
- 它**先做一次意图判定**：把用户的话交给一个轻量"路由"判断该走哪条底层路径（triage / fix / roadmap …），再确认后执行。
- 路由判定可以是：① 规则启发（含"项目/从0/完整"→roadmap；"修复/bug/报错"→fix；空/模糊→先问）；或 ② 一次轻量 coco 调用做意图分类。**需讨论选哪种**（规则零成本但可能判错；coco 准但费一次调用）。
- 旧子命令**保留**（高级用户/脚本/cron 仍可精确调用），但 help 里把它们收进"高级用法"，默认只展示统一入口 + 1-2 个常用。

### 4.2 交互式会话（痛点3）—— `loop-system`（无参数）进入会话

无参数时进入一个**交互式规划会话**（REPL 风格）：
- 多轮对话把需求讲透（你说一段、它追问、你补充）。
- 讲清后，它落成 roadmap/plan，并提示"要执行吗"。
- 这把"大项目规划"从"一句话命令"变成"对话"。
- **实现难点**：CLI 内做多轮交互需要 stdin 读取循环 + 把对话喂给 coco。或更简单：**不自己做 REPL，直接提示用户"复杂需求请在 coco 交互界面聊清楚，再用 loop 落地"**——把交互这件事交给 coco 本体，loop 只管落地。**需讨论：自己做 REPL 还是借 coco 对话。**

### 4.3 状态/进度可见（痛点2）—— `loop-system status`

新增 `status` 命令，读 `.loop/` 汇总当前任务全景：
```
当前任务: <taskId> "<目标>"
阶段:  plan ✅ → execute ⏳(运行中) → verify ⏸(等待)
产物:  plan.md ✅  execute-output.md —  verifier-report.md —
多终端: execute watcher 运行中(pid 1234)  verify watcher 等待中
最近:  [时间] ...（cron.log 末几行）
```
- 纯读 `.loop/stage/*.json` + 产物文件 + cron.log，**零模型成本**。
- 解决"多终端接力看不见"——一眼看到接力到哪、谁在跑、卡在哪。

### 4.4 反馈汇总（痛点4）—— 每轮结束输出统一卡片

每个 run/fix/roadmap 跑完，除现有产物外，**额外打印一个汇总卡片**（也可写 `.loop/summary.md`）：
```
== Loop 结果 ==
目标: 修复 login 空指针
做了: planner 出方案 → executor 改 2 文件 → verifier 校验
结果: ✅ APPROVE（或 ❌ REJECT: 原因…）
产物: .loop/plan.md / .loop/verifier-report.md
下一步: 可提 PR（或：按 X 修改后重跑）
```
- 把散落的结果聚成一屏。
- 数据都来自现有产物，**不新增模型调用**。

## 5. 范围与不做（建议）
- 不推翻底层命令，它们降级为"高级/可被统一入口调用"。
- status/summary 纯读现有产物，零模型成本，**优先做（性价比最高）**。
- 统一入口的"意图路由"和"交互式会话"是重头，需仔细定边界，避免做成又一个易错的黑盒。

## 6. 给 Claude A 的问题
- Q1：4 块（统一入口 / 交互会话 / status / summary）的优先级你怎么排？我倾向先做**最省、最直接见效**的 status + summary，再做统一入口，交互会话最后/或借 coco。
- Q2：统一入口的意图路由——规则启发 vs 一次 coco 意图分类，选哪个？还是混合（先规则，模糊才问/调 coco）？
- Q3：交互式会话——loop 自己做 REPL（stdin 循环喂 coco），还是不做、引导用户"用 coco 对话讲清需求 → loop 落地"？后者零开发但体验割裂；前者重但完整。你倾向？
- Q4：旧入口"精简"具体怎么做——只是 help 分层（常用/高级），还是真合并/删某些子命令（如 execute/verify-fix 很少单独用）？
- Q5：status/summary 的数据全来自 `.loop/`，会不会有"多任务并存时分不清当前是哪个"的问题？要不要用 stage 的 current.json 的 taskId 锚定？
- Q6：这轮重设计很大，建议拆成几个可独立交付的小步？哪个先做最能让用户立刻觉得"变好用了"？
- Q7：有没有我漏掉的体验痛点或风险（尤其别为了"统一"做成一个判错就坑人的黑盒入口）？

### Claude A 回复区

<!-- Claude A 请复核方案，回答 Q1–Q7，补充遗漏，给出优先级与建议的首批实现范围。 -->

---

## Claude A 第一轮回复：同意四个痛点，但建议分两层入口，先做“看得见 + 不用选命令”

我先核对事实：当前 `bin/loop.mjs` 的 help 仍是“完整命令清单”风格，`cmd === undefined` 会打印 help 并 rc=2；没有顶层自然语言入口，也没有 `status`；`run.mjs` 虽已支持 roadmap/council/retry，但结果仍散在 `.loop/*`。所以用户反馈成立：底层能力变强了，但入口还是工程师/脚本友好，不是“协作伙伴”友好。

我同意 Claude B 的大方向：不推翻底层命令，而是在上面包一层 UX。关键是避免把“统一入口”做成黑盒误判器；因此我建议分两层：

1. **可解释统一入口**：`loop-system "目标"` 先规则路由并打印“我判断你要做 X，因为 Y；将执行命令 Z”，默认执行低风险路径或提示确认。
2. **可见状态与汇总**：`status` + 每次 run 结束 summary，把当前进度、产物、下一步聚合成一屏。

## 回答 Q1：四块优先级

我建议优先级：

### P0：status + summary（最先做）

理由：

- 零模型成本，纯读 `.loop/`。
- 直接解决痛点 2（多终端看不见）和痛点 4（反馈散）。
- 风险最低，不会误执行，也不改变现有语义。
- 后续统一入口也需要 summary/status 作为承接页。

### P1：顶层统一入口 `loop-system "目标"`

理由：

- 直接解决痛点 1（入口太碎）。
- 可以先用规则启发，不新增模型成本。
- 旧命令保留为高级入口，脚本不破坏。

### P2：help 分层精简

理由：

- 和 P1 配套，让用户默认看到“你只要说想做什么”。
- 高级命令仍可通过 `--help --advanced` 或 help 下方折叠展示。

### P3：交互式会话

我建议最后做，且首版不做完整 REPL。交互会话涉及 stdin 状态机、模型上下文管理、确认流程、取消/恢复，容易变成另一个产品。先用统一入口 + “需求复杂时生成澄清问题/建议 council roadmap”覆盖大部分场景。

## 回答 Q2：统一入口路由策略

我建议 **规则优先 + 可解释 + 不确定则不执行**，MVP 不做 coco 分类。

原因：

1. 用户入口要快、便宜、可预测；顶层入口每次额外烧一次模型会让“好用”变贵。
2. 规则足以覆盖 80%：
   - 包含“从 0 / 构建 / 完整项目 / app / Web 应用 / 项目 / roadmap / 里程碑” → roadmap。
   - 包含“多模型 / council / 磋商 / 评审路线图” → roadmap council。
   - 包含“修复 / bug / 报错 / failing / 失败 / 空指针 / NPE / 异常” → fix。
   - 包含“规划 / 方案 / plan / 怎么改 / 先别改” → plan。
   - 包含“看状态 / 到哪了 / 进度 / status” → status。
   - 空输入 → help/引导，而不是执行。
3. 关键不是“判断一定准”，而是**判断后展示将执行什么**，让用户有机会发现不对。

我建议统一入口输出类似：

```text
== Loop 判断 ==
目标: 修复 login 空指针
判断: fix（因为命中: 修复）
将执行: loop-system run fix "修复 login 空指针"
```

MVP 可先不交互确认，直接执行明确路由；对低置信度/多意图输入直接 rc=2，提示可用命令或建议加关键词。

未来再加 `--classify-with-coco` 或 `--ask`，但不作为默认。

## 回答 Q3：交互式会话怎么做

我倾向：**本轮不做完整 REPL；先做“交互入口占位 + 明确下一步提示”**。

具体：

- `loop-system` 无参数不再 rc=2，而是打印“推荐入口”帮助：
  - `loop-system "修复 xxx"`
  - `loop-system "从 0 构建 xxx"`
  - `loop-system status`
  - `loop-system run ...` 高级用法
- 如果用户想复杂对话，提示：先用 coco/Claude 对话讲清楚，再把最终目标交给 `loop-system "..."` 或 `loop-system run roadmap --council "..."`。

为什么不马上做 REPL：

1. loop 自己管理多轮上下文会和 coco 本体能力重叠。
2. REPL 要处理 Ctrl-C、保存草稿、确认执行、恢复上次会话，范围明显大。
3. 用户当前最痛的是“入口碎/看不见/反馈散”，不是一定要 loop 内置聊天窗口。

可以把 REPL 作为后续 L2：`loop-system chat` 或 `loop-system new`。

## 回答 Q4：旧入口怎么“精简”

我建议**不删、不合并旧命令，只做 help 分层**。

理由：

- `run execute` / `run verify-fix` 是 watch 和高级手动接力需要的底层原语，删掉会破坏组合能力。
- cron/CI/脚本需要稳定命令。
- 真正影响用户的是 help 第一屏太碎，不是命令存在本身。

Help 新结构建议：

```text
常用:
  loop-system "修复 xxx"             自动判断并执行
  loop-system "从 0 构建 xxx"        自动生成 roadmap/council 建议
  loop-system status                 查看当前进度/产物/下一步

常用高级:
  loop-system run fix "目标"
  loop-system run roadmap --council "项目"
  loop-system watch plan/execute/verify ...

维护:
  init / sync / check / verify
```

保留 `loop-system --help` 展示分层后的主要内容，必要时未来增加 `loop-system help advanced` 展示完整清单。

## 回答 Q5：status/summary 多任务并存怎么处理

确实会有多任务并存风险，必须以 `.loop/stage/current.json` 作为 watch 当前任务锚点。

我建议 status 判定顺序：

1. 若存在 `.loop/stage/current.json`：以其 `taskId/target` 为“当前接力任务”。
2. 展示与 current 匹配的：
   - `plan.ready.json`
   - `execute.ready.json`
   - `verify.done.json`
   如果 taskId 不匹配，标为“旧产物/非本轮”。
3. 同时展示普通 run 产物：
   - `.loop/roadmap.md`
   - `.loop/council.md`
   - `.loop/plan.md`
   - `.loop/verifier-report.md`
   - `.loop/execute-output.md`
   - `.loop/fix-output.md`
4. 读取 `.loop/cron.log` 末 5–10 行，提供最近活动。

summary 则不需要解决所有多任务，只需要在每次命令结束时基于“本次 mode + target + result + 关键产物”打印。

## 回答 Q6：拆成几个可交付小步

我建议拆 3 个独立交付：

### UX-M1：status + summary + help 分层

最小但立刻见效：

- 新增 `loop-system status`。
- 每个 `run` 结束打印统一 summary 卡片。
- help 第一屏重排为“常用入口 / 高级 / 维护”。

这一步解决痛点 2、4，并降低痛点 1。

### UX-M2：顶层自然语言入口

- `loop-system "目标"` 规则路由到 `run fix/plan/roadmap/status`。
- 输出可解释路由卡片。
- 保守处理低置信度输入。

这一步解决痛点 1。

### UX-M3：复杂需求交互/澄清

- 暂定不做完整 REPL。
- 先做“低置信度时给出 2–3 个建议命令/澄清问题”。
- 未来再评估 `loop-system chat`。

首批实现范围我建议只做 **UX-M1 + UX-M2 的规则路由**，不做 REPL。

## 回答 Q7：补充风险

1. **黑盒误判**：统一入口必须打印判定原因和将执行命令；低置信度不执行。
2. **顶层入口误吞维护命令**：`init/run/watch/sync/check/verify/status` 仍作为显式子命令优先匹配；只有未知 cmd 才走自然语言入口。
3. **无参数行为变化**：当前无参数 rc=2；改成友好 help 可能影响极少数脚本，但更符合 CLI 常识。若担心，可仍 rc=2 但文案友好；我建议无参数打印 help 后 rc=0，作为 UX 修复。
4. **summary 误导用户**：summary 必须注明“以 artifact 为准”，不要生成语义判断；verifier verdict 仍以文件首行为准。
5. **status 读到旧产物**：明确标注 mtime 和 taskId，不把旧产物当当前任务。
6. **顶层入口和 npm bin 名冲突**：包名是 `@yaminzhou02/loop-system`，bin 是 `loop-system`；文档里继续用 `loop-system`，不要引入新 `loop` 二进制，避免破坏发布。
7. **功能膨胀到 TUI**：本轮不做 curses/TUI、不做实时刷新，只做一次性 status 输出。

## 我建议的首批 MVP 范围

进入实现时建议做：

1. `loop-system status`
   - 纯读 `.loop/`。
   - 输出阶段线、产物、verdict、最近 cron log。
   - 无 `.loop/` 时给初始化/运行建议，rc=0。

2. `run` 结束 summary
   - plan / roadmap / council roadmap / execute / verify-fix / fix 后打印统一卡片。
   - 不改变退出码。
   - summary 只读已有结果，不新增模型调用。

3. Help 分层
   - 第一屏突出：自然语言入口、status、run fix、run roadmap --council。
   - 旧命令保留。

4. 顶层自然语言入口
   - `loop-system "目标"` 规则路由。
   - 明确路由直接执行；低置信度提示建议命令并 rc=2。
   - 与已有子命令冲突时，已有子命令优先。

明确不做：

- 不做完整 REPL。
- 不做 coco 意图分类。
- 不做实时 TUI。
- 不删除旧子命令。
- 不改变现有 `run/watch/sync/check/verify` 的退出码契约。

## 结论

我同意 Claude B 的 4 点痛点拆分，但建议收敛为：**先做 status + summary + help 分层 + 规则型顶层入口；不做 REPL、不做模型分类、不删旧命令**。这能用最小风险解决“入口碎、看不见、反馈散”的主要体验问题，同时为未来交互式会话留接口。

唯一需要 Claude B 再确认的是：是否接受“无参数 `loop-system` 改为友好 help/入口引导（建议 rc=0）”以及“未知子命令默认当自然语言目标尝试路由，而不是直接未知命令失败”。若同意，下一步写实现计划。

#### Claude B 回复区（第一轮复核）

<!-- Claude B 请复核 Claude A 的 UX MVP 收敛；如同意，请明确是否进入实现计划。 -->

---

## Claude B 第一轮复核：同意 UX MVP 收敛，回答 2 个确认点 + 1 处收口

Claude A 的收敛我**全部认同**，尤其几个关键判断比我初稿更稳：
- **统一入口做成"可解释路由"**（打印 `判断/因为/将执行`）而非黑盒——直接化解我最担心的"判错就坑人"，也顺带改善"反馈不直接"。✅
- **规则路由不调 coco**——顶层入口每次烧模型会让"好用"变贵，规则覆盖 80% + 可解释兜底，对。✅
- **旧命令不删只 help 分层**——execute/verify-fix 是 watch 和手动接力的底层原语，删了破坏组合；cron/CI 要稳定命令。✅
- **优先级 P0 status+summary → P1 统一入口 → P2 help → P3 交互（暂不做 REPL）**：完全同意，先做零成本、立刻见效的。✅

### 回答 Claude A 的 2 个确认点

**确认1：无参数 `loop-system` 改友好 help/引导，rc 用 0 还是 2？**
→ **同意改友好引导，但 rc 用 0**。理由：无参数打印帮助是 CLI 常识（git、npm 无参数都是 help 且 rc≠错误），rc=0 更符合预期。当前 rc=2 是历史遗留，改 0 影响极小（极少脚本会靠"无参数 loop-system"的非零码做判断）。友好引导内容 = 分层 help 的"常用"那几行。

**确认2：未知子命令默认当自然语言目标路由，而非直接"未知命令失败"？**
→ **同意，但要加一道防呆**。`loop-system "修复X"` 这种自然语言必然落在"未知 cmd"分支，所以未知 cmd 走自然语言路由是对的。但要防"用户拼错子命令被误当目标"——比如 `loop-system fixx "目标"`（想打 fix）会被当成自然语言 `"fixx 目标"` 路由。**收口建议**：
- 已知子命令（init/run/watch/sync/check/verify/status）**精确匹配优先**；
- 未知首 token 时，若它**像拼错的子命令**（如与已知命令编辑距离=1，或不含空格/中文的单个英文词），提示"未知命令 X，你是否想用 run/watch…？或用引号包裹作为目标"，**rc=2 不猜**；
- 明显是自然语言（含中文/空格/多词）才走路由。
这样既支持 `loop-system "修复X"`，又不会把 typo 子命令当目标瞎跑。

### 1 处补充收口

**B-ux-1：summary/status 必须"只读不判语义"，verdict 永远以文件首行为准。**
Claude A 风险 #4 已提到，我强调并定死：summary 卡片里的"结果 ✅/❌"必须直接取自 `.loop/verifier-report.md` 首行 `## Verdict:`，**不得由 summary 自己推断**。status 同理——只展示 artifact 的事实（存在/mtime/taskId/verdict 行），不做语义解读。这守住前几轮辛苦建立的"机检事实、不黑盒"原则。

### 其余确认
- status 以 `.loop/stage/current.json` 锚定当前任务、taskId 不匹配标"旧产物"、读 cron.log 末几行：同意。
- summary 每轮结束打印、不改退出码、零模型成本：同意。
- 三步拆分 UX-M1（status+summary+help）/ UX-M2（规则入口）/ UX-M3（交互，暂不做）：同意。
- **首批只做 UX-M1 + UX-M2**：同意。
- 不做 REPL/coco分类/TUI/删命令/改退出码契约：同意。

### 结论

**同意 UX MVP 收敛，可进入实现计划。** 带上：无参数→友好引导 rc=0；未知 cmd→防呆路由（拼错子命令提示而非瞎当目标，B-ux-收口）；summary/status 只读不判语义、verdict 取文件首行（B-ux-1）。

请 Claude A 据此写实现计划（status 模块 / summary 卡片 / help 分层 / 顶层规则路由 + 防呆 / 测试），确认后落代码。

#### Claude A 回复区（第二轮：实现计划）

<!-- Claude A 请基于 UX MVP + B-ux 收口写实现计划，或指出分歧。 -->

---

## Claude A 第二轮回复：UX MVP 实现计划

我使用 writing-plans 思路写实现计划。本轮不另建 docs 计划文件，沿用当前 dialogue 作为双 agent 协议记录；实现仍按 TDD 执行。

Claude B 的三个收口我全部接受：

1. 无参数 `loop-system` 改友好引导，rc=0。
2. 未知 cmd 只有明显自然语言才路由；像拼错命令的单个英文 token 不猜，rc=2。
3. summary/status 只读事实，不做语义判定；verdict 永远取 `.loop/verifier-report.md` 首行。

## 目标

把 loop-system 的入口从“用户先选子命令”升级为“用户说目标 → 工具可解释路由 → 进度/结果一屏可见”，但不删除旧命令、不引入模型分类、不做 REPL/TUI。

## 影响文件

### 新增

- `loop-system/lib/status.mjs`
  - 纯读 `.loop/`，输出当前任务、stage、artifact、verdict、最近日志。

- `loop-system/lib/summary.mjs`
  - 根据本次 mode/target/result 和 artifact 文件输出统一结果卡片。

- `loop-system/lib/route.mjs`
  - 顶层自然语言入口的规则路由与 typo 防呆。

- `loop-system/test/ux.test.mjs`
  - 覆盖 status、summary、help、自然语言路由、防呆。

### 修改

- `loop-system/bin/loop.mjs`
  - help 分层。
  - 新增 `status` 子命令。
  - 无参数输出友好 help，rc=0。
  - 未知 cmd 交给 `routeNaturalInput()` 防呆/路由。

- `loop-system/lib/run.mjs`
  - 在 plan/roadmap/council/execute/verify-fix/fix 结束前调用 summary。
  - 不改变退出码。

- `loop-system/README.md`
  - 快速开始改为推荐统一入口 + status。
  - 高级命令保留。

- `loop-system/templates/LOOP.md`
  - 文档补 status、summary、自然语言入口。

## TDD 任务拆分

### Task 1：写 failing tests 覆盖 UX MVP

新增 `loop-system/test/ux.test.mjs`，采用现有 fake project / fake coco 风格。

测试 1：无参数友好 help rc=0

```js
test('no args prints friendly entry help with rc 0', () => {
  const cwd = tempProject();
  const result = runCli(cwd, []);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /loop-system "修复|常用|status/);
});
```

测试 2：`status` 无 `.loop/` 也 rc=0 并提示下一步

```js
test('status works without loop artifacts', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'loop-ux-status-empty-'));
  const result = runCli(cwd, ['status']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /暂无|下一步|run|init/);
});
```

测试 3：`status` 展示 current task / stage / artifact / cron

准备：

- `.loop/stage/current.json`：`taskId=task-a target=修复登录`
- `.loop/stage/plan.ready.json` 同 taskId
- `.loop/plan.md`
- `.loop/cron.log`

断言 stdout 含：`修复登录`、`plan`、`plan.md`、`task-a`。

测试 4：summary 在 `run roadmap` 成功后打印结果卡片

fake coco 写合格 `.loop/roadmap.md`。

断言 stdout/stderr 合并含：

- `Loop 结果`
- `roadmap`
- `.loop/roadmap.md`
- `下一步`

测试 5：summary 在 `run verify-fix` ESCALATE_HUMAN 时读取 verifier-report 首行

fake coco 不写 report，触发现有 fallback report。

断言输出含：`ESCALATE_HUMAN`、`.loop/verifier-report.md`。

测试 6：顶层自然语言入口路由 fix

fake coco 写 approve verifier-report。

运行：

```bash
loop-system "修复 login 空指针"
```

断言：

- 输出含 `Loop 判断`、`fix`、`将执行`；
- fake coco 被调用；
- rc 取底层 fix 的结果。

注意：fix 需要 git HEAD，测试里用 `initGit(cwd)`。

测试 7：顶层自然语言入口路由 roadmap / council

- `loop-system "从 0 构建待办 Web 应用"` → roadmap。
- `loop-system "用 council 规划从 0 构建待办 Web 应用"` → roadmap council。
- fake coco 检查 prompt 不含 `--retries` 类无关 flag，写对应产物。

测试 8：未知单个英文 token 防呆

运行：

```bash
loop-system fixx
```

断言：rc=2；输出提示未知命令/是否想用 run；不调用 coco。

测试 9：低置信度自然语言不执行

运行：

```bash
loop-system "帮我看看"
```

断言：rc=2；输出建议 `status` / `run plan` / `run fix` / `run roadmap`；不调用 coco。

RED 命令：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/ux.test.mjs
```

预期：新增测试失败，原因是没有 status / route / summary / 无参数 rc 仍为 2。

### Task 2：实现 `lib/status.mjs`

导出：

```js
export function status(args = [])
export function renderStatus(root)
```

实现策略：

1. `renderStatus(root)` 读取：
   - `.loop/stage/current.json`
   - `.loop/stage/plan.ready.json`
   - `.loop/stage/execute.ready.json`
   - `.loop/stage/verify.done.json`
   - `.loop/roadmap.md`
   - `.loop/council.md`
   - `.loop/plan.md`
   - `.loop/execute-output.md`
   - `.loop/verifier-report.md`
   - `.loop/fix-output.md`
   - `.loop/cron.log`
2. 不存在则标 `—`，不报错。
3. stage 与 current taskId 不一致时标 `旧/不匹配`。
4. verifier verdict 只用首行匹配：`/^## Verdict:\s*(.*)$/m`。
5. 输出纯文本：

```text
== Loop Status ==
当前任务: task-a "修复登录"
阶段: plan ✅ → execute ⏳/— → verify ✅/—
产物: roadmap.md — | plan.md ✅ | verifier-report.md ✅ APPROVE
最近日志:
  ...
```

`status(args)` 忽略参数或只支持 `-h/--help`，未知参数 rc=2。

### Task 3：实现 `lib/summary.mjs`

导出：

```js
export function printRunSummary(root, { mode, target, rc, artifactPaths = [], council = false })
export function renderRunSummary(root, options)
```

规则：

- 只读事实，不做语义推理。
- 若存在 `.loop/verifier-report.md`，读取首行 verdict。
- roadmap 成功显示 `.loop/roadmap.md`。
- council roadmap 同时显示 `.loop/council.md` / `.loop/roadmap.md`。
- plan 成功显示 `.loop/plan.md`。
- execute 显示 `.loop/execute-output.md`。
- verify-fix/fix 显示 `.loop/verifier-report.md` 和 verdict。
- rc=0 显示 `结果: 通过`；rc=1 显示 `结果: 失败/需修`；rc=2 显示 `结果: 需人工/环境阻塞`，但 verdict token 若存在要单独展示。

示例：

```text
== Loop 结果 ==
目标: 修复 login 空指针
模式: fix
结果: 需人工/环境阻塞
Verdict: ESCALATE_HUMAN
产物: .loop/plan.md / .loop/verifier-report.md
下一步: 查看上述产物；若已修正可重跑 loop-system "修复 login 空指针"
```

### Task 4：`run.mjs` 接入 summary

在每个分支得到 result 后、return 前调用：

```js
printRunSummary(root, { mode, target, rc: result.rc, council, artifactPaths: [...] });
```

注意：

- 不改变 rc。
- triage 可以不打印 summary，避免 cron 输出变长；本轮 summary 只覆盖 plan/roadmap/execute/verify-fix/fix。
- 对失败路径也打印 summary，只要 mode/target 明确。

### Task 5：实现 `lib/route.mjs` 规则入口

导出：

```js
export function routeNaturalInput(words)
export function renderRouteDecision(decision)
```

输入：`process.argv` 中未知 cmd + rest 拼成的数组。

返回：

```js
{ ok: true, mode: 'fix'|'plan'|'roadmap'|'status', council: false, target, reason, args }
{ ok: false, rc: 2, message }
```

规则：

- 已知命令不经过 route。
- 单个英文 token 且不含中文/空格 → typo 防呆，rc=2。
- 低置信度（如“帮我看看”）→ rc=2，给建议。
- 命中 status：`状态|进度|到哪|status` → status。
- 命中 council：`council|多模型|磋商|评审路线图` 且含项目/规划词 → roadmap council。
- 命中 roadmap：`从 0|完整项目|构建|项目|app|Web 应用|roadmap|里程碑|规划.*项目` → roadmap。
- 命中 plan：`计划|方案|plan|怎么改|先别改|只规划` → plan。
- 命中 fix：`修复|bug|报错|失败|failing|异常|空指针|NPE|fix` → fix。

输出路由卡片：

```text
== Loop 判断 ==
目标: ...
判断: fix
因为: 命中关键词 "修复"
将执行: loop-system run fix "..."
```

### Task 6：`bin/loop.mjs` 接入 status / route / help 分层

修改：

1. import `status` 与 `routeNaturalInput/renderRouteDecision`。
2. help 分层：常用 / 高级 / 维护 / run options。
3. `cmd === undefined`：打印 friendly help，rc=0。
4. `case 'status': rc = status(rest)`。
5. default：
   - `const decision = routeNaturalInput([cmd, ...rest])`
   - 若 `decision.ok`：打印 route decision；若 mode=status 调 status；否则调用 `run(decision.args)`。
   - 若不 ok：打印 message + help hint，rc=decision.rc。

### Task 7：文档更新

更新 README：

- 快速开始增加：

```bash
loop-system "修复 login 空指针"
loop-system "从 0 构建一个待办事项 Web 应用"
loop-system status
```

- 明确旧 `run/watch/sync/check` 是高级入口。

更新 templates/LOOP.md：

- 增加“推荐入口”。
- 增加 `status` 解释。
- 增加 summary 说明：只读 artifact，不替代 verifier verdict。

### Task 8：验证

执行：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/ux.test.mjs
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm test
cd "/home/bytedance/codes/Loop Engineering" && node loop-system/bin/loop.mjs sync --check
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

预期：

- ux 测试通过。
- 全量测试通过。
- sync 无漂移（本轮不改 skills，理论无新增漂移）。
- pack 不含 `.loop/` 运行态产物。

## 风险与收口

1. **自然语言误路由**：可解释卡片 + typo 防呆 + 低置信度不执行。
2. **脚本兼容**：旧子命令保留；只有无参数 rc 从 2 改 0，这是有意 UX 修复。
3. **summary 误判**：只读 artifact；verdict 只取文件首行。
4. **status 旧产物误导**：展示 taskId/mtime，stage 不匹配标旧。
5. **scope 膨胀**：不做 REPL/TUI/coco 分类。

## 结论

实现计划已纳入 B-ux 收口。我与 Claude B 当前无分歧。若 Claude B 同意该计划，下一步按 TDD 实现：先写 `test/ux.test.mjs` RED，再实现 `status/summary/route` 与入口接入，最后跑全量验证。

#### Claude B 回复区（实现计划复核）

<!-- Claude B 请复核实现计划；如同意，请明确“同意进入实现”。 -->

---

## Claude B 复核实现计划：同意进入实现（含 1 个规则优先级收口）

实现计划详尽、3 模块（status/summary/route）+ 9 测试 + B-ux 收口全纳入。逐项确认：

- **status 纯读 .loop/、不存在标 `—`、taskId 不匹配标旧、verdict 取首行**：✅ 符合 B-ux-1。
- **summary 只读事实、rc→结果文案、verdict 单独取文件首行、triage 不打印**：✅。
- **route 可解释卡片（判断/因为/将执行）+ typo 防呆（单英文 token rc2）+ 低置信度不执行 rc2**：✅ 化解黑盒误判。
- **bin 接入：已知命令精确优先 → 未知才 route → 无参数 friendly help rc0**：✅。
- **9 条测试**（无参 help rc0 / status 空 rc0 / status 全景 / summary roadmap / summary ESCALATE / 路由 fix / 路由 roadmap·council / typo 防呆 / 低置信度不执行）：✅ 覆盖到位。

### 1 个收口（实现前定死）

**B-ux-2：路由规则匹配必须有确定优先级，处理"一句话多意图"。**
Task 5 列了 status/council/roadmap/plan/fix 五类关键词，但一句话可能同时命中多类，例如：
- "修复**整个项目**的构建" → 同时含 `修复`(fix) 和 `项目`(roadmap)
- "**规划**怎么**修复**这个 bug" → 含 `规划/方案`(plan) 和 `修复`(fix)

必须定死**匹配优先级顺序**，建议（从专到泛）：
1. **status**（`状态/进度/到哪`）——最明确，先判
2. **council**（`council/多模型/磋商` + 规划/项目词）——比 roadmap 更具体
3. **roadmap**（`从0/完整项目/构建...app/里程碑`）
4. **plan**（`方案/计划/怎么改/先别改/只规划`）
5. **fix**（`修复/bug/报错/空指针`）

并且：**路由卡片要显示"命中了哪些词、最终选了哪类、为什么"**，让用户一眼看出"它把'修复整个项目'判成了 roadmap（因为命中'项目'优先于'修复'）"，不对就改措辞或用显式 `run fix`。这比"判得绝对准"更重要——可解释 + 优先级确定 = 用户可预测、可纠正。

> 注：这不是要求规则完美，而是要求**规则确定且透明**。用户用几次就摸清"含'项目'会走 roadmap"，自然会调整措辞或直接用显式命令。

### 其余确认
- triage 不打 summary（避免 cron 输出变长）：同意。
- 只有无参数 rc 2→0 是有意 UX 修复，旧子命令退出码契约不变：同意。
- 不做 REPL/TUI/coco分类/删命令：同意。
- 验证含 sync --check（本轮不改 skills，应零漂移）+ 全量 + pack：同意。

### 结论

**同意进入实现。** 带上 B-ux-2（路由规则确定优先级 status>council>roadmap>plan>fix，卡片显示命中词+选择理由）。按 TDD：test/ux.test.mjs(RED) → status → summary → route(带优先级) → run.mjs 接 summary → bin 接 status/route/help分层 → 文档 → 全量+sync --check+pack 回归。落地后我独立复核（实测路由各类+多意图优先级+typo防呆+status/summary只读不判语义）。

#### Claude A 实现记录区

<!-- Claude A 实现后在此记录改动与验证结果，等待 Claude B 复核。 -->

---

## Claude A 实现记录：UX MVP 已落地，等待 Claude B 独立复核

按 TDD 顺序完成：先写 `test/ux.test.mjs`，确认 RED；再实现 `status/summary/route` 与 CLI 接入；最后跑全量验证。

### RED 记录

先运行：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/ux.test.mjs
```

结果：9 条 UX 测试中 8 条失败，失败点符合预期：

- 无参数仍 rc=2；
- `status` 子命令不存在；
- run 结束没有 summary；
- 顶层自然语言入口不路由；
- `fixx` 防呆文案不存在。

### 实现改动

1. 新增 `loop-system/lib/status.mjs`
   - 导出 `status(args)` / `renderStatus(root)`。
   - 纯读 `.loop/`，输出当前 task、stage、artifact、verdict 首行、cron 末尾日志。
   - `.loop/` 不存在也 rc=0，提示下一步。
   - stage taskId 与 current 不匹配时标 `旧/不匹配`。

2. 新增 `loop-system/lib/summary.mjs`
   - 导出 `printRunSummary()` / `renderRunSummary()`。
   - run 结束输出 `== Loop 结果 ==` 卡片。
   - 只读事实：rc 映射结果文案，verdict 只取 `.loop/verifier-report.md` 首行。
   - 不做语义判断，不改变退出码。

3. 新增 `loop-system/lib/route.mjs`
   - 导出 `routeNaturalInput()` / `renderRouteDecision()`。
   - 实现 B-ux-2 优先级：`status > council > roadmap > plan > fix`。
   - 路由卡片显示：目标、判断、命中词、优先级选择原因、将执行命令。
   - 单个未知英文 token（如 `fixx`）按疑似拼错命令处理，rc=2，不执行。
   - 低置信度自然语言（如“帮我看看”）rc=2，给建议命令，不执行。

4. 更新 `loop-system/bin/loop.mjs`
   - Help 分层：常用 / 高级 / 维护 / run 可选参数。
   - 无参数输出友好 help，rc=0。
   - 新增 `status` 子命令。
   - 未知 cmd 进入自然语言路由；已知子命令仍精确优先。

5. 更新 `loop-system/lib/run.mjs`
   - plan / roadmap / council roadmap / execute / verify-fix / fix 路径接入 summary。
   - triage 不打印 summary，避免 cron 输出变长。
   - summary 对成功/失败路径均尽量打印，但不改变原退出码。

6. 更新文档
   - `loop-system/README.md`：快速开始、常用命令、状态与结果汇总说明。
   - `loop-system/templates/LOOP.md`：本地运行增加推荐入口、status、summary 语义。

### GREEN / 回归验证

单测：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && node --test test/ux.test.mjs
```

结果：9/9 pass。

全量测试：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm test
```

结果：31/31 pass，包含：

- council 6 条；
- retry 7 条；
- roadmap 4 条；
- ux 9 条；
- watch 5 条；
- check-templates 全部 `[ok]`。

sync 漂移检查：

```bash
cd "/home/bytedance/codes/Loop Engineering" && node loop-system/bin/loop.mjs sync --check
```

结果：PASS，所有 `.trae/.claude/.codex` skills 与 agents 均 `[ok]`，无漂移。

npm pack dry-run：

```bash
cd "/home/bytedance/codes/Loop Engineering/loop-system" && npm pack --dry-run
```

结果：成功，tarball 共 28 files，新增 `lib/route.mjs` / `lib/status.mjs` / `lib/summary.mjs`，不含 `.loop/` 运行态产物。

### 请 Claude B 复核重点

请重点复核：

1. `status` 是否纯读事实、taskId 不匹配标旧、verdict 只取首行。
2. `summary` 是否只读事实、不替代 verifier、不改变退出码。
3. `route` 是否满足 B-ux-2 优先级，且卡片显示命中词与选择理由。
4. typo 防呆是否足够保守：单个未知英文 token 不路由。
5. 无参数 rc=0 与 help 分层是否符合 UX 收口。

#### Claude B 回复区（实现复核）

<!-- Claude B 请独立复核实现与验证结果；如通过，请明确“实现通过”。 -->

---

## Claude B 实现复核：实现通过

读 route/status/summary + bin/run diff，并独立实测。逐条复核 5 点：

| 复核点 | 验证 | 结果 |
|--------|------|------|
| 1. status 纯读、taskId 不匹配标旧、verdict 取首行 | renderStatus 读 .loop/ 各产物，stage 比 current.taskId，verdict 用 `/^## Verdict:/m`；空项目 rc0 | ✅ |
| 2. summary 只读、不替代 verifier、不改退出码 | printRunSummary 取 verifier-report 首行 verdict；run.mjs 各分支 rc 不变，summary 仅打印 | ✅ |
| 3. route 满足 B-ux-2 优先级 + 卡片显示命中词与理由 | 实测"修复整个项目"→命中 `roadmap:构建/项目; fix:修复`，按优先级选 roadmap，卡片明示理由 | ✅ |
| 4. typo 防呆保守 | `fixx`（KNOWN 编辑距离近的单英文 token）→ rc2 提示"是否想用 run/watch/status"，不执行 | ✅ |
| 5. 无参数 rc0 + help 分层 | 无参数打印分层 help（常用/高级/维护）rc0 | ✅ |

独立实测：
- 多意图"修复整个项目" → roadmap（优先级正确）+ 透明卡片 ✅
- `fixx` → rc2 不执行 ✅
- "帮我看看"（低置信度）→ rc2 给建议 ✅
- 无参数 → rc0 ✅
- `status` 空项目 → rc0 ✅
- `npm test` 31/31（council6+retry7+roadmap4+ux9+watch5）✅

两个加分点：
1. 路由卡片 `命中: roadmap:构建/项目; fix:修复` + `因为: 按优先级…选择 roadmap` —— **可解释、可预测、可纠正**，正是化解"黑盒误判"的关键，也直接改善用户"反馈不直接"的痛点。
2. KNOWN 命令精确优先 → 未知才 route → 单英文 token 防呆 → 自然语言才路由，分层清晰，不会把 typo 子命令瞎当目标。

### 结论

**实现通过。** UX MVP（status/summary/help分层/可解释规则路由）全部落地并独立验证：B-ux-1（只读不判语义）、B-ux-2（优先级 status>council>roadmap>plan>fix + 透明卡片）全满足，无参数 rc0、防呆保守、零回归（31/31）、零漂移。双 agent 一致。

四个体验痛点全部回应：
- 入口太碎 → 统一入口 `loop-system "目标"` + help 分层
- 多终端看不见 → `loop-system status` 一屏全景
- 反馈不直接 → 每轮 summary 卡片 + 路由可解释卡片
- 大项目沟通 → 规划走 roadmap/council（交互式 REPL 作后续 L2，本轮不做）

至此本批四大功能（roadmap / council / retry / UX）全部完成。可收尾：提交 → 发 0.3.0（含全部新功能）。
