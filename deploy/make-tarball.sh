#!/usr/bin/env bash
# ============================================================================
# 在本机（Mac / Linux）运行：打包项目源码用于上传到腾讯云
# ============================================================================
# 输出：./zhongli-src.tar.gz（~30-80MB，不含 node_modules / 旧 dist / 旧数据）
# ============================================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$SRC_DIR/../zhongli-src.tar.gz"

echo "源目录: $SRC_DIR"
echo "输出:   $OUT"

# 排除：node_modules、.env、本地 PGlite 数据、旧构建产物、临时文件
tar czf "$OUT" \
  --exclude='zhongli-src/node_modules' \
  --exclude='zhongli-src/client/node_modules' \
  --exclude='zhongli-src/.env' \
  --exclude='zhongli-src/data/pglite' \
  --exclude='zhongli-src/data/pglite.broken-*' \
  --exclude='zhongli-src/logs' \
  --exclude='zhongli-src/uploads' \
  --exclude='zhongli-src/dist' \
  --exclude='zhongli-src/.git' \
  --exclude='zhongli-src/backfill.log' \
  --exclude='zhongli-src/retry3.log' \
  --exclude='zhongli-src/smoke-test.log' \
  --exclude='zhongli-src/verify.log' \
  --exclude='zhongli-src/batch-sync.log' \
  --exclude='zhongli-src/sync-audit.json' \
  --exclude='zhongli-src/batch-sync-checkpoint.json' \
  --exclude='zhongli-src/verify-report.json' \
  --exclude='zhongli-src/tsconfig.*.tsbuildinfo' \
  --exclude='zhongli-src/_*.mjs' \
  --exclude='zhongli-src/_*.js' \
  --exclude='zhongli-src/diag_*.mjs' \
  --exclude='zhongli-src/check_*.mjs' \
  --exclude='zhongli-src/dry_run_*.mjs' \
  --exclude='zhongli-src/_probe*.mjs' \
  --exclude='zhongli-src/_smoke-test.js' \
  --exclude='zhongli-src/_test_*.mjs' \
  --exclude='zhongli-src/_retry-*.js' \
  --exclude='zhongli-src/_verify-*.js' \
  --exclude='zhongli-src/_list-shot-fields.js' \
  --exclude='zhongli-src/_read-*.js' \
  --exclude='zhongli-src/_upload-error-cause.md' \
  --exclude='zhongli-src/task_*.mjs' \
  --exclude='zhongli-src/audit-sync.js' \
  --exclude='zhongli-src/batch-sync.js' \
  --exclude='zhongli-src/backfill.log' \
  --exclude='zhongli-src/feishu-schema.json' \
  --exclude='zhongli-src/fix-match-shots.*' \
  --exclude='zhongli-src/fix_yuan-shipin.py' \
  -C "$(dirname "$SRC_DIR")" \
  zhongli-src

SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "✅ 打包完成: $OUT ($SIZE)"
echo ""
echo "下一步：把这个文件上传到服务器 /root/ 目录（OrcaTerm 顶部 📁 图标，拖拽上传）"