#!/usr/bin/env bash
# check-loop.sh — loop 工程聚合门禁（本地 / CI 均可用）
#
# 用法: bash scripts/check-loop.sh [STATE 新鲜度分钟数, 默认 240]

set -euo pipefail
cd "$(dirname "$0")/.."

FRESH_MIN="${1:-240}"

echo "== shell syntax =="
bash -n scripts/run-loop.sh
bash -n scripts/verify-loop.sh
bash -n scripts/sync-skills.sh
echo "  [ok] scripts/*.sh syntax"

echo "== generated skills drift =="
bash scripts/sync-skills.sh --check

echo "== loop state gate =="
bash scripts/verify-loop.sh "$FRESH_MIN"

echo "== check-loop PASS =="
