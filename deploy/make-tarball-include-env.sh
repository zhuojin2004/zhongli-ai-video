#!/usr/bin/env bash
# ============================================================================
# 中力视频内容生产平台 - 自定义打包（含 .env + 已构建 dist/，开箱即用）
# 输出：~/Downloads/zhongli-src.tar.gz
# 与 deploy/make-tarball.sh 的差异：
#   1. 保留 .env（你的真实密钥，服务器直接能跑）
#   2. 保留 dist/client/（已构建好的前端，服务器无需 npm run build）
# ============================================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HOME/Downloads/zhongli-src.tar.gz"

echo "源目录: $SRC_DIR"
echo "输出:   $OUT"
echo ""

# 先做客户端 build（确保 dist/ 是最新的，包含本会话的 bug fix）
echo "🛠️  重新构建前端 dist/（确保打包包含最新修复）..."
NODE_OPTIONS="--max-old-space-size=8192" npm run build:client --silent
echo "✅ 构建完成"
echo ""

echo "📦 打包中..."
tar czf "$OUT" \
  --exclude='zhongli-src/node_modules' \
  --exclude='zhongli-src/client/node_modules' \
  --exclude='zhongli-src/server/node_modules' \
  --exclude='zhongli-src/data/pglite' \
  --exclude='zhongli-src/data/pglite.broken-*' \
  --exclude='zhongli-src/client/data/pglite' \
  --exclude='zhongli-src/server/data/pglite' \
  --exclude='zhongli-src/logs' \
  --exclude='zhongli-src/uploads' \
  --exclude='zhongli-src/.git' \
  --exclude='zhongli-src/.DS_Store' \
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
  --exclude='zhongli-src/feishu-schema.json' \
  --exclude='zhongli-src/fix-match-shots.*' \
  --exclude='zhongli-src/fix_yuan-shipin.py' \
  -C "$(dirname "$SRC_DIR")" \
  zhongli-src

SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "✅ 打包完成: $OUT ($SIZE)"
echo ""
echo "📋 包含的关键资产："
echo "   - client/vite/mockApiServer.js （含本会话修复：业务员 person_name 写入）"
echo "   - .env （飞书/MiniMax/OSS 密钥）"
echo "   - dist/client/ （前端构建产物，服务器无需 npm run build）"
echo "   - deploy/deploy.sh （一键部署脚本）"
echo ""
echo "📋 服务器端部署步骤："
echo "   1) 用 OrcaTerm 顶部 📁 图标上传 zhongli-src.tar.gz 到 /root/"
echo "   2) cd /root && tar xzf zhongli-src.tar.gz"
echo "   3) cd zhongli-src && sudo bash deploy/deploy.sh"
echo "   4) 访问 http://<服务器IP>/"
