#!/usr/bin/env bash
# check-loop.sh — loop 工程代码健康门禁（本地 / CI 均可用）
#
# 默认只检查不随时间变化的代码健康项：shell 语法 + 生成物漂移。
# STATE 新鲜度是运行态门禁，会随时间变化；需显式开启。
#
# 用法:
#   bash scripts/check-loop.sh              # 代码健康：语法 + 生成物漂移
#   bash scripts/check-loop.sh --state      # 代码健康 + STATE 新鲜度（默认 240 分钟）
#   bash scripts/check-loop.sh --state 60   # 代码健康 + STATE 新鲜度（60 分钟）
#   bash scripts/check-loop.sh 240          # 兼容旧用法：等价于 --state 240

set -euo pipefail
cd "$(dirname "$0")/.."

RUN_STATE="no"
FRESH_MIN="240"

usage() {
  echo "用法: bash scripts/check-loop.sh [--state [新鲜度分钟数] | 新鲜度分钟数]" >&2
}

if [ "$#" -gt 0 ]; then
  case "${1:-}" in
    --state)
      RUN_STATE="yes"
      if [ "$#" -gt 2 ]; then
        usage
        exit 2
      fi
      FRESH_MIN="${2:-240}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [ "$#" -eq 1 ] && [[ "$1" =~ ^[0-9]+$ ]]; then
        RUN_STATE="yes"
        FRESH_MIN="$1"
      else
        usage
        exit 2
      fi
      ;;
  esac
fi

if ! [[ "$FRESH_MIN" =~ ^[0-9]+$ ]]; then
  echo "[check-loop] STATE 新鲜度分钟数必须是非负整数: $FRESH_MIN" >&2
  exit 2
fi

echo "== shell syntax =="
bash -n scripts/run-loop.sh
bash -n scripts/verify-loop.sh
bash -n scripts/sync-skills.sh
echo "  [ok] scripts/*.sh syntax"

echo "== generated skills drift =="
bash scripts/sync-skills.sh --check

if [ "$RUN_STATE" = "yes" ]; then
  echo "== loop state gate =="
  bash scripts/verify-loop.sh "$FRESH_MIN"
else
  echo "== loop state gate =="
  echo "  [skip] 默认跳过时间敏感的 STATE 新鲜度检查；需要时运行: bash scripts/check-loop.sh --state $FRESH_MIN"
fi

echo "== check-loop PASS =="
