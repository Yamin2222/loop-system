#!/usr/bin/env bash
# run-loop.sh — 用 coco 无头模式驱动 loop（供 cron / CI 调度）
#
# 用法:
#   bash scripts/run-loop.sh triage              # L1: 只汇报，更新 STATE.md（+门禁）
#   bash scripts/run-loop.sh plan  "<目标>"       # L2-策划: 委派 loop-planner 出 plan.md
#   bash scripts/run-loop.sh fix   "<目标>"       # L2-全流程: planner→executor→verifier
#                                             # 需仓库已有 HEAD（worktree 子代理依赖）
#
# 角色与模型（在 .agents 子代理里绑定）:
#   loop-planner=openrouter-3o  loop-executor=GPT-5.5  loop-verifier=Gemini-3.1-Pro
#
# 挂 cron（工作日 08:00 跑 triage）:
#   0 8 * * 1-5  cd /path/to/repo && bash scripts/run-loop.sh triage >> .loop/cron.log 2>&1

set -euo pipefail

cd "$(dirname "$0")/.."   # 切到仓库根
mkdir -p .loop

MODE="${1:-triage}"
shift || true
TARGET="${*:-}"
TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"

need_target() {
  if [ -z "$TARGET" ]; then
    echo "用法: run-loop.sh $MODE \"<目标描述>\"" >&2
    exit 1
  fi
}

need_git_head() {
  if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    echo "[fix] 需人工：当前仓库没有有效 HEAD，worktree 子代理无法创建隔离环境；请先完成一次初始 commit 后重试" | tee -a .loop/cron.log >&2
    exit 2
  fi
}

case "$MODE" in
  triage)
    # L1：只读分流，允许写 STATE.md。不进 worktree。
    PROMPT="运行 loop-triage skill。先读 STATE.md 和 LOOP.md，把 High-Priority 和 Watch 项合并进 STATE.md，更新 Last run 时间戳为当前时间，并在 Activity Log 末尾追加一行记录。只汇报，不改任何源码。"
    echo "[$TS] L1 triage 开始" >> .loop/cron.log
    coco -p "$PROMPT" \
      --allowed-tool Read --allowed-tool Write \
      --allowed-tool Grep --allowed-tool Glob --allowed-tool Bash
    # triage 后跑门禁：校验 STATE.md 是否真更新
    if bash scripts/verify-loop.sh; then
      echo "[verify] PASS" >> .loop/cron.log
    else
      vrc=$?
      echo "[verify] FAIL rc=$vrc — STATE.md 可能未正确更新，请人工查 .loop/cron.log" >> .loop/cron.log
      exit "$vrc"
    fi
    ;;
  plan)
    # L2-策划：只委派 planner 出方案，不执行。
    need_target
    PROMPT="读 LOOP.md 与 STATE.md。把以下目标委派给 @loop-planner 子代理，让它调研代码库并产出 plan.md（写到 .loop/plan.md）。只策划，不写实现代码。目标：$TARGET"
    echo "[$TS] L2 plan 开始: $TARGET" >> .loop/cron.log
    coco -p "$PROMPT" \
      --allowed-tool Read --allowed-tool Write \
      --allowed-tool Grep --allowed-tool Glob --allowed-tool Bash
    if [ ! -s .loop/plan.md ]; then
      echo "[plan] FAIL: .loop/plan.md 未生成或为空" >&2
      echo "[plan] FAIL: .loop/plan.md 未生成或为空" >> .loop/cron.log
      exit 1
    fi
    echo "[plan] 方案见 .loop/plan.md，确认后可跑: run-loop.sh fix \"$TARGET\"" >> .loop/cron.log
    ;;
  fix)
    # L2-全流程：planner→executor→verifier 三角色编排。
    # 隔离由 executor/verifier 子代理自身的 isolation:worktree 负责，
    # 主进程不加 -w（否则双层 worktree，且 .loop/ 产物会落在子 worktree 里读不到）。
    need_target
    need_git_head
    PROMPT="读 LOOP.md 与 STATE.md，按三角色编排处理以下目标：
1) 委派 @loop-planner 产出 .loop/plan.md（若 .loop/plan.md 已存在且匹配该目标，可复用）。
2) 委派 @loop-executor 严格照 plan.md 在隔离 worktree 中落地实现+测试。
3) 委派 @loop-verifier 独立校验。verifier 可在子代理环境写报告并返回摘要；主编排者必须把最终机器可解析裁决写入当前主工作区 .loop/verifier-report.md，首行必须是 ## Verdict: APPROVE | REQUEST_CHANGES | REJECT | ESCALATE_HUMAN。
verifier APPROVE 才提议 PR，绝不自动合并；REQUEST_CHANGES/REJECT 则回 executor 修一轮或升级人工。
命中拒绝清单或模糊项一律升级人工。把结果追加到 STATE.md 的 Activity Log。
目标：$TARGET"
    echo "[$TS] L2 fix(三角色) 开始: $TARGET" >> .loop/cron.log
    if coco -p "$PROMPT" \
      --allowed-tool Read --allowed-tool Write --allowed-tool Edit \
      --allowed-tool Grep --allowed-tool Glob --allowed-tool Bash \
      2>&1 | tee .loop/fix-output.md; then
      :
    else
      coco_rc=$?
      echo "[fix] coco 执行失败 rc=$coco_rc，继续检查 .loop/verifier-report.md / .loop/fix-output.md" | tee -a .loop/cron.log >&2
    fi
    # 裁决唯一可信来源是 verifier 亲自落盘的 .loop/verifier-report.md。
    # 缺失即 checker 产物不存在 → 无法证明安全 → ESCALATE_HUMAN（exit 2）。
    # .loop/fix-output.md 仅作人工排查诊断，不参与裁决。
    if [ ! -s .loop/verifier-report.md ]; then
      echo "## Verdict: ESCALATE_HUMAN" > .loop/verifier-report.md
      echo "" >> .loop/verifier-report.md
      echo "verifier 未落盘 .loop/verifier-report.md，checker 产物缺失，自动流程无法证明安全。诊断见 .loop/fix-output.md。" >> .loop/verifier-report.md
      echo "[fix] 需人工（ESCALATE_HUMAN）：verifier 未落盘裁决，见 .loop/fix-output.md" | tee -a .loop/cron.log >&2
      exit 2
    fi
    if grep -q '^## Verdict: APPROVE$' .loop/verifier-report.md; then
      echo "[fix] verifier APPROVE — 可提议 PR（仍不自动合并）" >> .loop/cron.log
    else
      verdict="$(sed -n 's/^## Verdict: //p' .loop/verifier-report.md | head -1)"
      case "$verdict" in
        ESCALATE_HUMAN)
          echo "[fix] 需人工（ESCALATE_HUMAN），见 .loop/verifier-report.md" | tee -a .loop/cron.log >&2
          exit 2
          ;;
        *)
          echo "[fix] verifier 未通过（${verdict:-unknown}），见 .loop/verifier-report.md" | tee -a .loop/cron.log >&2
          exit 1
          ;;
      esac
    fi
    ;;
  *)
    echo "未知模式: $MODE（支持: triage | plan | fix）" >&2
    exit 1
    ;;
esac

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $MODE 结束" >> .loop/cron.log
