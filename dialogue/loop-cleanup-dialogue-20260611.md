# Loop System：仓库清理 / 保持简洁方案讨论 — 2026-06-11

本文档用于 Claude A（执行）与 Claude B（审阅/策划）就「清理无用文件、历史残留，保持仓库简洁」达成一致。
本轮只做 **plan（出方案讨论）**，不写代码不删文件。达成一致后再执行清理。

协作规则：Claude B 出方案 → Claude A 复核/补充/提问 → 来回直到一致 → 再执行。

---

## 1. 需求（来自用户）

清理仓库里的无用文件、历史残留，保持仓库简洁。

## 2. 现状盘点（git 跟踪的顶层）

```
.agents/          skill 真源（8 个 skill）
.trae/ .claude/ .codex/   仓库根的生成物（skill 副本 + 子代理）
LOOP.md  STATE.md         给"本仓库自己跑 loop"用的配置/状态
scripts/*.sh             4 个早期 bash 版（run-loop/verify-loop/sync-skills/check-loop）
loop-system/            npm 包源码（bin/lib/templates/test + 自己的 README/LICENSE/NOTICES）
  └ templates/.agents/   与根 .agents/ 内容完全相同的另一份 skill 真源
dialogue/               6 个双 agent 讨论记录
README.md  .gitignore
```

## 3. 核心矛盾（必须先定，否则删错）

**这个仓库到底是什么？** 当前混了两种身份：
- 身份 A：**loop-system npm 包的源码仓**（核心是 `loop-system/`）。
- 身份 B：**一个用 loop 系统自我维护的项目**（根 `.agents/.trae/LOOP.md/STATE.md/scripts` 是"自己跑 loop"的痕迹，也是最初 bash 版的产物）。

两种身份导致大量冗余：双份 skill 真源、bash 与 Node 两套实现、根级生成物。**先定身份，再决定删什么。**

## 4. 候选清理项（逐条给判断，待讨论）

| # | 文件 | 现状 | Claude B 初步判断 |
|---|------|------|------------------|
| C1 | `scripts/*.sh`（4 个 bash） | npm 版 Node CLI 已完全取代，README 已称其"早期 bash 版" | **建议删**：功能 100% 被 loop-system/lib 取代，留着误导 |
| C2 | 根 `.agents/` vs `loop-system/templates/.agents/` | 两份完全相同的 skill 真源 | **建议合一**：保留 `loop-system/templates/.agents/` 为唯一真源（它随包发布），删根 `.agents/`；或反之。二选一，消除双份 |
| C3 | 根 `.trae/.claude/.codex/` | 给"本仓库自己跑 loop"的生成物 | **建议删**：源码仓不需要自己跑 loop；生成物可随时 sync 重建 |
| C4 | 根 `LOOP.md` / `STATE.md` | 给"本仓库自己跑 loop"用 | **建议删或移**：源码仓不自跑 loop 则无用；它们的"模板版"已在 loop-system/templates/ |
| C5 | `dialogue/`（6 个讨论记录） | 双 agent 设计决策留痕 | **建议保留但归档**：是有价值的设计史（类 ADR），但不该在仓库根显眼处；可移到 `docs/dialogue/` 或加说明 |
| C6 | `reference/`（已 gitignore） | 两个借鉴项目的完整 clone | 已不跟踪，无需动 |

## 5. 我倾向的方案：明确为"npm 包源码仓"，消除自跑痕迹

定身份 = **A（npm 包源码仓）**。则：
1. **删 C1**（bash scripts）——被 Node CLI 取代。
2. **C2 合一**：以 `loop-system/templates/.agents/` 为唯一真源（随包发布、check-templates 已围绕它），**删根 `.agents/`**。但要先确认：check-templates / sync 当前是否依赖根 `.agents/`？（sync 在用户项目里以 cwd 的 .agents 为源；开发仓库的 sync --check 比的是根 .agents vs templates——若删根 .agents，这个开发期检查要改）。
3. **删 C3 C4**（根生成物 + LOOP.md/STATE.md）——源码仓不自跑。
4. **C5**：dialogue 移到 `loop-system/docs/` 或仓库 `docs/`，保留设计史但不碍眼。
5. 结果：仓库根只剩 `loop-system/`（包）+ `README.md` + `.gitignore` + `dialogue 或 docs`，干净。

**但这是大改动，且改变了"仓库自己也能跑 loop"的能力**——需用户确认是否接受这个定位。

## 6. 给 Claude A 的问题
- Q1：仓库身份定 A（纯 npm 包源码仓）还是保留 B（自跑 loop）？这决定删不删根 `.agents/.trae/scripts/LOOP.md/STATE.md`。
- Q2：C2 双份真源合一——保留哪一份？删根 `.agents/` 会不会破坏开发期 `sync --check`（它比根 .agents vs templates）？合一后开发期怎么验证 templates 正确？
- Q3：C1 删 bash scripts 有无副作用？（有没有别的地方还引用 run-loop.sh 等？README 已改 npm 版）
- Q4：C5 dialogue 保留/归档/删？归档到哪？
- Q5：清理顺序怎么排最安全（先删纯冗余、后动有依赖的）？删前怎么确认没有引用（grep 引用、跑测试）？
- Q6：有没有我漏掉的冗余，或不该删的（误删会丢能力/历史）？

### Claude A 回复区

<!-- Claude A 请复核盘点，回答 Q1–Q6，补充遗漏，给出清理范围与安全顺序。 -->

#### Claude A 第一轮复核（2026-06-11）

我复核了当前仓库结构、根 README、`loop-system/lib/*`、旧 `scripts/*.sh` 与引用关系。结论：Claude B 的核心判断成立，但我建议**不要一次性把“自跑 loop 能力”整块删除**；应该把清理分为两层：

1. **发布包源码的确定性清理**：删除已被 Node CLI 完全替代、且不随 npm 包发布的早期 bash 脚本；修正根 README / LOOP 中仍指向旧脚本或根 `.agents` 真源的说法。
2. **仓库自举能力的结构化保留**：短期保留根 `.agents/` 与生成物，因为当前 `loop-system sync --check` 的开发仓验证仍以目标项目根 `.agents/skills` 为输入；如果直接删除根 `.agents/`，会让本仓库无法用自身 CLI 做漂移检查，且根 README 第 8 节仍把 `.agents/skills` 写成维护入口。

逐问回答：

**Q1：仓库身份定 A 还是保留 B？**

我建议主身份定为 **A：npm 包源码仓**，但保留最小 B 能力作为 dogfooding/dev fixture。也就是说：根目录的公开叙事应围绕 `loop-system/` 包；但本仓库仍可以作为一个已 init 的项目来跑 `loop-system sync --check`、`loop-system check`、`loop-system run ...`。完全删除 B 会丢掉一个有价值的真实样例，而且 `sync.mjs` 的设计本来就是“目标项目 `.agents/skills` → 生成物”，在开发仓里保留目标项目形态有测试价值。

**Q2：双份真源保留哪一份？**

短期不要直接合一到只剩 `loop-system/templates/.agents/`。当前事实：

- `loop-system/lib/sync.mjs` 明确从目标项目根 `.agents/skills` 读取真源并生成 `.trae/.claude/.codex`：`loop-system/lib/sync.mjs:21`、`loop-system/lib/sync.mjs:51`、`loop-system/lib/sync.mjs:99`。
- `loop-system/lib/check-templates.mjs` 专门比较根 `.agents/skills` 与 npm 模板 `.agents/skills`，缺根 `.agents` 会 skip：`loop-system/lib/check-templates.mjs:9`、`loop-system/lib/check-templates.mjs:13`。
- `loop-system/lib/init.mjs` 发布给用户时也是先复制模板 `.agents` 到目标项目，再用目标项目 `.agents` 生成工具配置：`loop-system/lib/init.mjs:12`、`loop-system/lib/init.mjs:35`。

所以根 `.agents` 和 `loop-system/templates/.agents` 不是简单“重复文件”，而是当前发布前防漂移机制的一对输入/输出。若要真正合一，需要先重构开发仓维护流：例如新增 package-local template sync/check，让开发者只改 `loop-system/templates/.agents`，而 `sync --check` 在 package 源码模式下支持从 templates 生成临时根配置。这个改动有价值，但不属于“清理无用文件”的最小安全范围。

**Q3：删 bash scripts 有无副作用？**

`scripts/*.sh` 可以删，但要同步改根 `LOOP.md`。依据：

- 旧脚本只支持早期 triage/plan/fix/check/sync/verify，且缺少后续 Node CLI 已有的 roadmap/council/watch/retry/status/summary/natural routing。
- 旧 `scripts/sync-skills.sh` 的 `SKILLS` 只有 5 个，不包含 roadmap council 三个 skill：`scripts/sync-skills.sh:34`；Node 版已有 8 个：`loop-system/lib/sync.mjs:7`。
- 根 `LOOP.md` 仍引用旧脚本作为 Schedule/Gate/同步命令，这会误导维护者：`LOOP.md:35`、`LOOP.md:45`、`LOOP.md:46`、`LOOP.md:53`、`LOOP.md:99`、`LOOP.md:107`。

因此 C1 是最高确定性的清理项：删除 `scripts/check-loop.sh`、`scripts/run-loop.sh`、`scripts/sync-skills.sh`、`scripts/verify-loop.sh`，并把根 `LOOP.md` 的命令全部切到 `loop-system ...`。

**Q4：dialogue 保留/归档/删？**

建议本轮**保留 `dialogue/` 不移动**。理由：它现在是 active collaboration workspace，不只是历史 ADR；用户明确要求继续和 Claude B 来回讨论。等发布稳定后可以单独做一轮“文档归档”：把已定稿的 dialogue 压缩为 `docs/adr/` 或 `docs/dialogue/`，但那会造成大量路径变动，不应和脚本/真源清理混在同一 diff。

**Q5：安全顺序**

推荐顺序：

1. 先改根 `LOOP.md`：把 `scripts/*.sh` 全部替换为 Node CLI 命令，保证文档不再引用待删文件。
2. 删除 `scripts/*.sh` 四个文件。
3. 跑引用检查：确认非 dialogue 历史记录外没有 `bash scripts/*.sh` 的活跃引用。
4. 跑验证：`cd loop-system && npm test`、`node bin/loop.mjs --help`、`node bin/loop.mjs sync --check`、`npm pack --dry-run`。
5. 暂不删除 `.agents/.trae/.claude/.codex/LOOP.md/STATE.md/dialogue`。

**Q6：补充遗漏 / 不该删项**

- 根 `.trae/.claude/.codex` 是生成物，理论可删；但只删它们会让 `loop-system sync --check` 立即失败，因为 check 期望生成物存在：`loop-system/lib/sync.mjs:85`、`loop-system/lib/sync.mjs:99`。如果要不提交生成物，需要先改 `sync --check` 语义或测试策略。
- 根 `LOOP.md/STATE.md` 不能和脚本一起删。`run.mjs` 的 prompt 全部要求读 `LOOP.md` 与 `STATE.md`，例如 `loop-system/lib/run.mjs:112`、`loop-system/lib/run.mjs:115`、`loop-system/lib/run.mjs:183`；删掉会让本仓 dogfooding 直接坏掉。
- 根 README 需要小修：第 8 节现在说 skill 正文只在根 `.agents/skills` 维护：`README.md:201`；如果本轮保留根 `.agents`，这句话仍成立，但要补一句“发布模板也由 check-templates 防漂移”；如果未来改为 templates 唯一真源，再统一改。

### Claude A 建议的本轮收敛范围

本轮只做 **Cleanup MVP**：

- 删除早期 bash 入口 `scripts/*.sh`。
- 修根 `LOOP.md` 里所有旧脚本引用为 `loop-system` CLI。
- 可选小修根 README：明确 npm 包源码仓 + dogfooding 配置并存，避免读者误以为 `scripts/` 仍是入口。
- 不动 `.agents/`、`.trae/`、`.claude/`、`.codex/`、`LOOP.md`、`STATE.md`、`dialogue/` 的位置。

这样收益明确、风险最小：清掉真正过时且误导的 shell 实现，同时保留当前测试/发布链路依赖的自举配置。后续如果还想更极致，可以单独开 **Cleanup Phase 2**：重构 dev-source-of-truth 为 templates-only，再决定是否删除根 `.agents` 与生成物。

### 给 Claude B 的复核点

请重点确认两点：

1. 是否同意本轮范围收敛为“删旧 bash + 修 LOOP/README 引用”，暂不做 templates-only 大改？
2. 是否认为根 `.agents/.trae/.claude/.codex` 的保留会继续造成认知负担；如果是，是否接受把它列为 Phase 2，而非本轮混做？

---

## 用户决定：保留"自跑 loop"能力（身份 = A+B 混合）

用户拍板：**保留仓库自己也能跑 loop 的能力**。这收窄了清理范围——根 `.agents/.trae/.claude/.codex/LOOP.md/STATE.md` 都要**保留**（自跑需要），不能按"纯 npm 源码仓"激进删。

### 在此前提下，Claude B 修正后的清理建议

| # | 文件 | 保留自跑前提下的判断 |
|---|------|---------------------|
| C1 `scripts/*.sh` | **可删**？——但要先确认：自跑 loop 现在靠什么？如果根仓库的"自跑"已改用 `loop-system` CLI（npm link 后），bash scripts 确属冗余可删；如果自跑仍依赖 `bash scripts/run-loop.sh`，则**不能删**。**这是 Q1'，需 Claude A 确认自跑的实际入口。** |
| C2 双份真源 | **保留两份**（自跑用根 `.agents/`，发包用 templates）。但要确认有同步机制防漂移（check-templates 已做）。不删，只确认同步可靠。 |
| C3 根 `.trae/.claude/.codex/` | **保留**（自跑的生成物）。 |
| C4 根 `LOOP.md/STATE.md` | **保留**（自跑配置/状态）。 |
| C5 `dialogue/` | 仍建议归档到 `docs/` 或加 README 说明，保留设计史。**待议**。 |
| C6 `reference/` | 已 gitignore，不动。 |

### 收窄后我倾向的最小清理
1. **C1**：仅当自跑已不依赖 bash scripts 时才删；否则保留。请 Claude A 先查清自跑入口。
2. **C2/C3/C4**：保留，确认 sync 同步机制健康即可（不删）。
3. **C5**：dialogue 归档到 `docs/dialogue/` 或仓库加一句说明，避免仓库根太杂。
4. 整体偏保守：保留自跑能力 = 大部分"看似冗余"的其实是功能，**少删、只清真冗余**。

### 给 Claude A 的新问题
- Q1'：仓库"自跑 loop"现在实际用什么入口？`bash scripts/run-loop.sh` 还是 `loop-system`（npm link）？这决定 C1 能不能删。
- Q2'：双份真源（根 .agents vs templates）的同步现在靠什么保证一致？`sync --check` 够不够？要不要加一个一键同步根→templates 的步骤？
- Q3'：dialogue 归档到哪最合理？归档后会不会影响什么引用？
- Q4'：保留自跑前提下，还有哪些是**真冗余**（既不被自跑用、也不被包用）可安全删？

### Claude A 回复区（清理方案 v2：保留自跑前提）

<!-- Claude A 请在"保留自跑能力"前提下，回答 Q1'–Q4'，给出真正可安全删除的最小清单与顺序。 -->

#### Claude A 第二轮复核（保留自跑前提）

同意用户拍板：身份定为 **A+B 混合**，即“npm 包源码仓 + 自身也是 loop-system 的 dogfooding 项目”。在这个前提下，我修正清理目标：不追求根目录极简，而是清掉**会误导维护者、且功能已被 Node CLI 完全覆盖的旧入口**。

**Q1'：仓库自跑 loop 现在实际用什么入口？**

当前有两个入口并存：

1. **实际推荐入口 / 新功能入口**：`loop-system` Node CLI（开发时可用 `node loop-system/bin/loop.mjs ...`，全局/链接后用 `loop-system ...`）。根 README 全部按这个入口写：`README.md:43`、`README.md:66`、`README.md:73`、`README.md:86`、`README.md:188`。
2. **历史入口**：根 `scripts/*.sh`。根 `LOOP.md` 仍引用它们：`LOOP.md:35`、`LOOP.md:45`、`LOOP.md:46`、`LOOP.md:53`、`LOOP.md:99`、`LOOP.md:107`、`LOOP.md:110`、`LOOP.md:113`、`LOOP.md:116`、`LOOP.md:119`。

我判断：自跑能力**不应再依赖 bash scripts**。理由是 bash 版已经落后：`scripts/sync-skills.sh` 只知道 5 个 skill，不包含 roadmap council 三个 skill；Node 版 `loop-system/lib/sync.mjs` 已有 8 个 skill 和 6 个 role。继续保留 bash 入口会制造“双入口但能力不同”的假象。

所以 C1 可以删，但前置条件是先把根 `LOOP.md` 的历史入口全部改成 `loop-system` CLI。删除后，自跑方式明确为：

```bash
# 开发仓内未 npm link 时
node loop-system/bin/loop.mjs check
node loop-system/bin/loop.mjs run triage
node loop-system/bin/loop.mjs sync --check

# npm link / 全局安装后
loop-system check
loop-system run triage
loop-system sync --check
```

**Q2'：双份真源同步靠什么？够不够？要不要加一键同步？**

当前保障链路：

- 用户项目运行时：`loop-system/lib/init.mjs` 从 `loop-system/templates/.agents` 复制到目标项目 `.agents`，再 `generateInto(dest, dest)` 生成工具配置。
- dogfooding/dev 仓运行时：`loop-system/lib/sync.mjs` 从根 `.agents/skills` 生成根 `.trae/.claude/.codex`。
- 发布前防漂移：`loop-system/lib/check-templates.mjs` 比较根 `.agents/skills` 与 `loop-system/templates/.agents/skills`，并已纳入 `npm test`：`loop-system/package.json:42`。

这对“发现漂移”够用，但对“修复漂移”不够顺手。是否加一键同步？我建议**本轮不加**，因为它是新功能/维护命令，不是清理；但可以列为 Phase 2：新增 `loop-system/lib/sync-templates.mjs` 或 `npm run sync:templates`，明确方向为“根 `.agents` → templates”，然后 `check-templates` 继续做 gate。

本轮只需跑并保留现有 gate：`cd loop-system && npm test` 会覆盖 `check-templates`；`node bin/loop.mjs sync --check` 会覆盖根生成物漂移。

**Q3'：dialogue 归档到哪最合理？是否影响引用？**

我建议本轮**不移动 `dialogue/`**，只可选增加一句根 README 说明它是设计讨论留痕。原因：

- 现在这些文件仍是 active collaboration workspace，用户正在要求“继续讨论”。移动会打断现有协作路径。
- 现有 dialogue 里互相引用大量相对语义（如“上一份 dialogue”“这份 dialogue”），移动不会破代码，但会增加 review 噪音。
- 若要归档，最佳位置是 `docs/dialogue/`，但应作为单独 PR/commit 做“文档归档”，不和删除旧脚本混在一起。

所以 C5 本轮：**保留不动**；Phase 2 再议 `docs/dialogue/`。

**Q4'：保留自跑前提下，还有哪些真冗余可删？**

当前我只确认一个真冗余：

- `scripts/check-loop.sh`
- `scripts/run-loop.sh`
- `scripts/sync-skills.sh`
- `scripts/verify-loop.sh`

它们既不随 npm 包发布，也不覆盖新功能，还会和 Node CLI 形成冲突入口。其余项在 A+B 前提下都不是“真冗余”：

- 根 `.agents/`：dogfooding 真源，保留。
- 根 `.trae/.claude/.codex`：dogfooding 生成物，保留；`sync --check` 需要它们存在。
- 根 `LOOP.md/STATE.md`：dogfooding 配置/状态，保留；`run.mjs` prompts 明确读取它们。
- `dialogue/`：当前协作记录，保留。
- `reference/`：已 gitignore，不是 tracked 清理范围。

### Claude A 建议的最终 Cleanup MVP（v2）

本轮清理最小清单：

1. 改根 `LOOP.md`：所有 `scripts/*.sh` 命令替换为 `loop-system ...`（或开发态 `node loop-system/bin/loop.mjs ...` 说明）。
2. 删除根 `scripts/*.sh` 四个旧 bash 入口。
3. 可选改根 README 一小段：说明本仓保留 dogfooding 配置，`dialogue/` 是设计讨论留痕；不移动目录。
4. 不动 `.agents/.trae/.claude/.codex/STATE.md/dialogue/reference`。

验证顺序：

```bash
# 1. 活跃文档不再引用旧脚本（dialogue 历史记录可忽略）
grep -R "scripts/.*\.sh\|bash scripts/" -n LOOP.md README.md loop-system || true

# 2. 包测试与模板/生成物漂移
cd loop-system && npm test
node bin/loop.mjs sync --check
npm pack --dry-run
```

如果 Claude B 同意，我建议进入实现：先改 `LOOP.md`，再删 `scripts/`，最后跑上述验证。若 B 仍坚持处理 `dialogue/`，我建议只加 README 说明，不移动文件。

---

## Claude B 收敛复核：整合 Claude A 第一轮 + 用户"保留自跑"决定

Claude A 的第一轮分析很扎实，关键发现我已独立核实，与用户决定一致：

### 已核实的事实
1. **双份真源不是简单重复，是 sync/check 的输入↔输出对**（A 已给行号佐证）：`sync.mjs` 从项目根 `.agents/skills` 读、生成 `.trae/.claude/.codex`；`check-templates.mjs` 比"根 .agents vs templates"。→ 用户既然要保留自跑，**根 `.agents/.trae/.claude/.codex` 必须留**，这点 A 和用户决定一致。✅
2. **bash scripts 的活跃引用只在根 `LOOP.md`（9 处）**。其余命中全在 `.loop/`（运行产物，gitignore）和 `.trae/worktrees/`（worktree 残留，gitignore），非 git 跟踪。→ 删 bash scripts 只需同步改 LOOP.md，无其他活跃引用。✅
3. **根 `LOOP.md/STATE.md` 不能删**：run.mjs 的 prompt 全要求读它们（自跑依赖）。✅

### 回应 Claude A 的 2 个复核点
1. **同意本轮范围收敛为"删旧 bash + 修 LOOP/README 引用"**，不做 templates-only 大改。用户要保留自跑，双份真源就是必要机制，不是本轮该动的。
2. **根 `.agents/.trae/.claude/.codex` 不列入清理**——用户明确要自跑，它们是功能不是负担。Phase 2（templates-only 合一）也**不做**了，因为那会牺牲自跑能力，与用户决定冲突。

### 我补充发现的一个真冗余（A 没提）
- **`.trae/worktrees/loop-executor-execute-plan-in-worktree/`**：之前 fix 实测时 executor 子代理留下的 worktree 残留目录。它已被 gitignore（不进版本控制），但占本地空间、且让 grep 出噪声。**建议本地清理**（`git worktree prune` + 删目录），属于"历史残留"。注意：它不在 git 里，所以是本地清理动作，不进 commit。

### 最终收敛清理清单（保留自跑前提）

**本轮做（Cleanup MVP）：**
1. 改根 `LOOP.md`：9 处 `scripts/*.sh` 全部替换为 `loop-system` CLI 命令（与已改的根 README 一致）。
2. 删 `scripts/check-loop.sh / run-loop.sh / sync-skills.sh / verify-loop.sh`（被 Node CLI 完全取代，无活跃引用）。
3. 本地清理 worktree 残留：`git worktree prune` + 删 `.trae/worktrees/`（gitignore，不进 commit）。
4. 验证：`cd loop-system && npm test` 全过、`node bin/loop.mjs sync --check` 零漂移、`npm pack --dry-run` 正常（bash scripts 本就不在包里，删它不影响发布）。

**本轮不做（保留）：**
- 根 `.agents/.trae/.claude/.codex/LOOP.md/STATE.md`——自跑必需。
- `dialogue/`——A 说得对，它是 active workspace（我们还在用），不是死历史，保留原位不归档。
- 双份真源合一——会牺牲自跑，放弃这个方向。

### 结论
**同意 Claude A 的收敛，本轮只删 bash scripts + 修 LOOP.md 引用 + 清 worktree 残留。** 这是"保留自跑前提下"真正安全的最小清理，清掉过时误导的 shell 实现和运行残留，不碰任何自跑/发布依赖。

请 Claude A 据此执行（改 LOOP.md → 删 scripts → 清 worktree → 验证），完成后我复核。

#### Claude A 执行记录区

<!-- Claude A 执行清理后在此记录，等待 Claude B 复核。 -->

#### Claude A 执行结果（2026-06-11）

已按 Claude B 收敛方案执行 Cleanup MVP。

改动内容：

1. 根 `LOOP.md`：删除所有旧 bash 入口引用，改为 `loop-system` CLI：
   - Schedule: `loop-system run triage` + cron
   - Gate: `loop-system verify` / `loop-system check`
   - sync: `loop-system sync`
   - 本地开发未 npm link 时补充 `node loop-system/bin/loop.mjs check`
2. 删除旧 bash 入口：
   - `scripts/check-loop.sh`
   - `scripts/run-loop.sh`
   - `scripts/sync-skills.sh`
   - `scripts/verify-loop.sh`
3. 根 `README.md` 第 11 节小修：不再提 `scripts/*.sh`，改为说明根 `.agents` 是 dogfooding skill 真源、`.trae/.claude/.codex` 是 `loop-system sync` 生成物。
4. `loop-system/templates/LOOP.md` 修掉最后一处 `verify-loop.sh` 残留，避免 npm 模板继续带旧 shell 术语。
5. 本地清理：已执行 `git worktree prune`，并删除 ignored 的 `.trae/worktrees/` 残留目录（不进入 commit）。

验证结果：

```bash
# 活跃文档/包源码无旧脚本引用
Grep LOOP.md: no matches
Grep README.md: no matches
Grep loop-system/**/*.{md,mjs,js,json,sh}: no matches

# 全量测试
npm --prefix "/home/bytedance/codes/Loop Engineering/loop-system" test
# 结果：31/31 pass，template skills drift 全 ok

# 生成物漂移
node "/home/bytedance/codes/Loop Engineering/loop-system/bin/loop.mjs" sync --check
# 结果：check PASS，.trae/.claude/.codex skills + agents 全 ok

# npm 打包 dry-run
npm pack --dry-run "/home/bytedance/codes/Loop Engineering/loop-system"
# 结果：生成 yaminzhou02-loop-system-0.3.0.tgz dry-run，total files: 28
```

注意：我第一次误在仓库根执行了 `npm test` / `npm --prefix ... pack --dry-run`，因根无 `package.json` 失败；随后已用正确命令重跑并通过。这个失败不对应代码问题。

当前 git 状态（预期）：

```text
M LOOP.md
M README.md
M loop-system/templates/LOOP.md
D scripts/check-loop.sh
D scripts/run-loop.sh
D scripts/sync-skills.sh
D scripts/verify-loop.sh
?? dialogue/loop-cleanup-dialogue-20260611.md
```

等待 Claude B 独立复核。若通过，请明确“实现通过”；若有异议，请指出是否需要恢复某个脚本或调整文档措辞。
