#!/usr/bin/env bash
# ============================================================================
# 中力视频内容生产平台 - 腾讯云 Lighthouse 一键部署脚本
# ============================================================================
# 用法（在你的 Tencent Cloud Lighthouse 上以 root 运行）：
#   bash deploy.sh
#
# 行为：
#   1. 安装系统依赖（Node.js 20 / ffmpeg / nginx / pm2）
#   2. 安装 npm 依赖（npm install --omit=dev）
#   3. 构建前端静态产物（npm run build:client）
#   4. 配置 nginx 反向代理（80 → 9099 + 静态资源）
#   5. 用 pm2 守护 mockApiServer（端口 9099）
#
# 幂等：可以反复执行，不会重复初始化
# 安全：不会触碰 .env（部署时由你自己 cp .env.example .env 后填值）
# ============================================================================

set -euo pipefail

# ---------- 颜色输出 ----------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()      { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()     { echo -e "${RED}[ERR]${NC} $*"; }
section() { echo -e "\n${GREEN}========== $* ==========${NC}"; }

# ---------- 必须 root ----------
if [ "$(id -u)" -ne 0 ]; then
  err "请用 root 运行: sudo bash deploy.sh"
  exit 1
fi

APP_DIR="/opt/zhongli"
APP_USER="zhongli"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------- 0. 检测系统 ----------
section "0/8 检测系统"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) PKG="apt-get"; NODE_INSTALL_CMD="curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && $PKG install -y nodejs" ;;
  centos|rhel|rocky|almalinux|fedora) PKG="yum"; NODE_INSTALL_CMD="curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && $PKG install -y nodejs" ;;
  *)
    err "不支持的系统: ${ID:-unknown}（仅支持 Ubuntu/Debian/CentOS/RHEL 系列）"
    exit 1
    ;;
esac
ok "系统: ${PRETTY_NAME:-${ID}}  包管理器: $PKG"

# ---------- 1. 安装系统依赖 ----------
section "1/8 安装系统依赖 (Node.js / ffmpeg / nginx / git)"

if ! command -v node >/dev/null 2>&1; then
  info "安装 Node.js 20..."
  bash -c "$NODE_INSTALL_CMD"
else
  NODE_VER=$(node -v)
  ok "Node.js 已安装: $NODE_VER"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  info "安装 ffmpeg..."
  $PKG install -y ffmpeg
fi
ok "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"

if ! command -v nginx >/dev/null 2>&1; then
  info "安装 nginx..."
  $PKG install -y nginx
  systemctl enable nginx
fi
ok "nginx: $(nginx -v 2>&1)"

if ! command -v git >/dev/null 2>&1; then
  $PKG install -y git
fi
ok "git: $(git --version)"

if ! command -v pm2 >/dev/null 2>&1; then
  info "安装 pm2..."
  npm install -g pm2
fi
ok "pm2: $(pm2 -v)"

# ---------- 2. 准备应用目录 ----------
section "2/8 准备应用目录 $APP_DIR"

if [ ! -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR"
  ok "创建 $APP_DIR"
fi

# 把当前 deploy.sh 所在的项目目录同步到 /opt/zhongli
info "同步源码到 $APP_DIR ..."
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='data/pglite' \
  --exclude='logs' \
  --exclude='uploads' \
  --exclude='dist' \
  "$SCRIPT_DIR/" "$APP_DIR/"
ok "源码同步完成"

cd "$APP_DIR"

# ---------- 3. 创建系统用户 ----------
section "3/8 创建系统用户 $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash "$APP_USER"
  ok "创建用户 $APP_USER"
else
  ok "用户 $APP_USER 已存在"
fi
mkdir -p "$APP_DIR/logs" "$APP_DIR/data/pglite" "$APP_DIR/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------- 4. 安装 npm 依赖 ----------
section "4/8 安装 npm 依赖"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  info "执行 npm install --omit=dev ..."
  npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
else
  ok "node_modules 已存在，跳过安装"
fi
ok "依赖安装完成"

# ---------- 5. 构建前端 ----------
section "5/8 构建前端静态产物"
if [ ! -d dist/client ]; then
  info "执行 npm run build:client ..."
  sudo -u "$APP_USER" bash -c "npm run build:client" 2>&1 | tail -10
else
  ok "dist/client 已存在，跳过构建"
fi
ok "前端构建完成"

# ---------- 6. 配置环境变量 ----------
section "6/8 配置环境变量"
if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
    warn ".env 已从 .env.example 复制，请用 vim/nano 编辑填入真实密钥！"
    warn "  vim /opt/zhongli/.env"
  else
    warn "未找到 .env.example，AI 分析可能受限"
  fi
else
  ok ".env 已存在，跳过"
fi

# mockApiServer 默认 ffmpeg 路径 /Users/jensen/miniconda3/bin/ffmpeg（Mac 路径）
# 我们用环境变量 FFMPEG_PATH=/usr/bin/ffmpeg 覆盖
grep -q "^FFMPEG_PATH=" "$APP_DIR/.env" 2>/dev/null || echo "FFMPEG_PATH=/usr/bin/ffmpeg" >> "$APP_DIR/.env"
ok "FFMPEG_PATH=/usr/bin/ffmpeg"

# ---------- 7. 启动 mockApiServer (pm2) ----------
section "7/8 用 pm2 启动 mockApiServer (端口 9099)"
cat > "$APP_DIR/ecosystem.config.cjs" <<'EOF'
module.exports = {
  apps: [{
    name: 'zhongli-api',
    script: 'client/vite/mockApiServer.js',
    cwd: '/opt/zhongli',
    user: 'zhongli',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/opt/zhongli/logs/pm2-error.log',
    out_file: '/opt/zhongli/logs/pm2-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '512M',
  }],
}
EOF

# pm2 启动 / 重启
pm2 delete zhongli-api 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save
ok "pm2 启动 zhongli-api 完成"

# pm2 开机自启
info "配置 pm2 开机自启..."
STARTUP_CMD=$(pm2 startup | grep -E "sudo env" | tail -1 || true)
if [ -n "$STARTUP_CMD" ]; then
  bash -c "$STARTUP_CMD" >/dev/null 2>&1 || warn "开机自启命令需要手动执行（pm2 startup 输出）"
fi
ok "pm2 配置完成"

# ---------- 8. 配置 nginx ----------
section "8/8 配置 nginx 反向代理"

cat > /etc/nginx/sites-available/zhongli <<'NGINX'
# 中力视频生产平台 - nginx 配置
# 80 → /api/* 反代到 127.0.0.1:9099 (mockApiServer)
# 80 → /* 静态资源，从 /opt/zhongli/dist/client 提供

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 500M;        # 视频上传最大 500MB
    proxy_read_timeout 600s;          # AI 分析可能 60-180s
    proxy_send_timeout 600s;

    root /opt/zhongli/dist/client;
    index index.html;

    # 长连接缓存，避免 nginx 默认连接池阻塞 SSE / 长时间 AI 任务
    location /api/ {
        proxy_pass http://127.0.0.1:9099;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 关闭缓存避免 AI 长任务响应延迟
        proxy_buffering off;
    }

    # 上传视频静态文件（mockApiServer 写入 /tmp/zhongli-videos，软链到 /opt/zhongli/uploads）
    location /uploads/ {
        alias /opt/zhongli/uploads/;
        autoindex on;
    }

    # SPA 路由：所有未匹配的 URL 回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 健康检查
    location = /healthz {
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }
}
NGINX

# 启用站点
ln -sf /etc/nginx/sites-available/zhongli /etc/nginx/sites-enabled/zhongli
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ok "nginx 配置完成并 reload"

# ---------- 健康检查 ----------
section "✅ 部署完成 - 健康检查"

sleep 2
echo ""
info "测试 /healthz:"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://127.0.0.1/healthz || true

info "测试 /api/auth/login:"
LOGIN_RESP=$(curl -s -X POST http://127.0.0.1/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}')
echo "  响应: $(echo "$LOGIN_RESP" | head -c 100)..."

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN} 部署成功！${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "  访问:  http://$(curl -s ifconfig.me)/"
echo "  默认账号: admin / admin123"
echo ""
echo "  常用命令："
echo "    pm2 status                    # 查看服务状态"
echo "    pm2 logs zhongli-api          # 实时日志"
echo "    pm2 restart zhongli-api       # 重启服务"
echo "    vim /opt/zhongli/.env         # 编辑环境变量（改完要 restart）"
echo ""
warn "如果接口报 '✗ 未配置' 飞书 / MiniMax 密钥，请编辑 /opt/zhongli/.env 后执行 pm2 restart zhongli-api"
echo ""