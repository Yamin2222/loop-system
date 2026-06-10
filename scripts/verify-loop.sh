#!/usr/bin/env bash
# verify-loop.sh — loop 产物门禁（确定性校验，退出码驱动）
#
# 用途：客观判断"本轮 loop 是否真完成"，而非靠 AI 自我宣称。
# 由 run-loop.sh 在 triage/fix 跑完后调用，按退出码决定通过/重试/中止。
#
# 退出码:
#   0  通过：STATE.md 结构完整、Last run 新鲜、本轮有 Activity Log 条目
#   1  校验失败：缺段落 / 时间戳过期 / 无当轮日志 → 应重跑或人工查
#   2  环境阻塞：找不到 STATE.md 等前置条件 → 需人工
#
# 用法: bash scripts/verify-loop.sh [新鲜度分钟数, 默认 60]

set -euo pipefail
cd "$(dirname "$0")/.."

STATE="STATE.md"
FRESH_MIN="${1:-60}"
rc=0

[ -f "$STATE" ] || { echo "[verify] 找不到 $STATE"; exit 2; }

echo "== 校验 $STATE =="

# 1. 必需段落
for sec in "## High Priority" "## Watch List" "## Activity Log"; do
  if grep -qF "$sec" "$STATE"; then
    echo "  [ok] 段落: $sec"
  else
    echo "  [FAIL] 缺段落: $sec"; rc=1
  fi
done

# 2. Last run 不能是 never
last="$(sed -n 's/^Last run: *//p' "$STATE" | head -1)"
if [ -z "$last" ] || [ "$last" = "never" ]; then
  echo "  [FAIL] Last run 未更新（=$last）"; rc=1
else
  echo "  [ok] Last run: $last"
  # 3. 新鲜度：Last run 应在 FRESH_MIN 分钟内
  if last_epoch="$(date -d "$last" +%s 2>/dev/null)"; then
    age_min=$(( ( $(date +%s) - last_epoch ) / 60 ))
    if [ "$age_min" -le "$FRESH_MIN" ]; then
      echo "  [ok] 新鲜度: ${age_min}min ≤ ${FRESH_MIN}min"
    else
      echo "  [FAIL] 产物过期: ${age_min}min > ${FRESH_MIN}min（疑似拿旧产物冒充）"; rc=1
    fi
  else
    echo "  [warn] 无法解析 Last run 时间格式，跳过新鲜度检查"
  fi
fi

# 4. 今天是否有 Activity Log 条目（排除注释与示例行）
today="$(date '+%Y-%m-%d')"
if grep -E "^${today}.*\|.*\|" "$STATE" | grep -qv '^例'; then
  echo "  [ok] 今天($today)有 Activity Log 条目"
else
  echo "  [FAIL] 今天($today)无 Activity Log 条目（loop 未追加记录）"; rc=1
fi

echo "== verify rc=$rc =="
exit "$rc"
