# 中力视频内容生产平台 - 腾讯云部署文档

> 部署目标：把 `/Users/jensen/Downloads/zhongli-src/` 部署到 Tencent Cloud Lighthouse 公网可访问

## 架构（最简方案）

```
┌──────────────────────────────────────────────┐
│ 互联网 (公网 IP:80)                            │
└──────────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────┐
│ nginx (反代 + 静态)                            │
│  ├─ /api/*  → 127.0.0.1:9099 (pm2 守护)       │
│  ├─ /uploads/* → /opt/zhongli/uploads/        │
│  └─ /* → /opt/zhongli/dist/client/ (SPA 静态)  │
└──────────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────┐
│ mockApiServer.js (端口 9099)                  │
│  ├─ 完整 API（auth / 素材 / 视频分析 / 剪辑 / 飞书 / ...）│
│  └─ PGlite 文件数据库 /opt/zhongli/data/pglite │
└──────────────────────────────────────────────┘
```

为什么不用 NestJS（`server/main.ts`）：
- 业务 API 写在 `client/vite/mockApiServer.js`，未移植到 NestJS controller
- mockApiServer 是当前 dev 完整后端；NestJS 模块不完整
- 移植到 NestJS 工作量 ~2h + 调试风险，vs 直接用 mockApiServer 0 风险

## 部署步骤（15-20 分钟）

### 1. 把项目传到服务器

把 `/Users/jensen/Downloads/zhongli-src/` 打包（**不含 node_modules / .env / data**）：

```bash
cd /Users/jensen/Downloads
tar czf zhongli-src.tar.gz \
  --exclude='zhongli-src/node_modules' \
  --exclude='zhongli-src/.env' \
  --exclude='zhongli-src/data/pglite' \
  --exclude='zhongli-src/logs' \
  --exclude='zhongli-src/dist' \
  zhongli-src
```

预期大小：~30-80 MB。

然后用 **OrcaTerm 文件上传功能**（顶部工具栏的 📁 图标，拖拽上传到 `/root/`）传到服务器。

### 2. 在服务器上解压

```bash
cd /root
tar xzf zhongli-src.tar.gz
cd zhongli-src
ls deploy/
# 应该看到 deploy.sh / nginx.conf / ecosystem.config.cjs / README.md
```

### 3. 复制 deploy 目录到项目根

```bash
# 把 deploy 文件夹放到项目根
ls -d deploy  # 确认存在
```

### 4. 一键部署

```bash
cd /root/zhongli-src
sudo bash deploy/deploy.sh
```

脚本会做：
- 安装 Node.js 20 / ffmpeg / nginx / pm2
- `npm install --omit=dev`（首次约 60-120s）
- `npm run build:client`（首次约 30-60s）
- 配置 nginx + pm2
- 启动并健康检查

### 5. 验证

部署完成后，浏览器访问 `http://<服务器公网IP>/`：
- 默认账号：`admin / admin123`（mockApiServer 内置测试账号）
- 登录后默认进入素材库，可按角色切换不同模块

### 6. （可选）填真实密钥

```bash
sudo vim /opt/zhongli/.env
# 填入 FEISHU_APP_ID / MINIMAX_API_KEY / ALI_OSS_ACCESS_KEY_ID 等
sudo pm2 restart zhongli-api
```

## 日常运维命令

```bash
# 查看服务状态
pm2 status

# 实时日志
pm2 logs zhongli-api --lines 100

# 重启服务（改 .env 后必跑）
pm2 restart zhongli-api

# 查看 nginx 错误日志
sudo tail -f /var/log/nginx/error.log

# 备份 PGlite 数据库
sudo tar czf pglite-backup-$(date +%Y%m%d).tar.gz /opt/zhongli/data/pglite
```

## 故障排查

### 502 Bad Gateway
`pm2 status` 看看 `zhongli-api` 是否 `online`：
- `errored` → `pm2 logs zhongli-api` 看堆栈
- `stopped` → `pm2 restart zhongli-api`

### 接口 404
确认 nginx 配置生效：`sudo nginx -t && sudo nginx -s reload`

### 内存不足 OOM
Lighthouse 2GB 内存跑 AI 分析 + ffmpeg 抽帧可能爆：
```bash
free -h  # 看实际占用
```
如果经常 OOM：
- 临时：`pm2 restart zhongli-api`
- 长期：升级 Lighthouse 配置或加 swap（`sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`）

## 数据迁移（从本地到云端）

```bash
# 本机：打包本地数据库
cd /Users/jensen/Downloads/zhongli-src/data
tar czf pglite-export.tar.gz pglite/

# 上传到服务器 /opt/zhongli/data/
# 在服务器上：
sudo systemctl stop pm2-zhongli-api 2>/dev/null || pm2 stop zhongli-api
cd /opt/zhongli/data
sudo rm -rf pglite
sudo tar xzf pglite-export.tar.gz
sudo chown -R zhongli:zhongli pglite
pm2 restart zhongli-api
```

## 更新部署（重新发布）

```bash
# 本机：修改代码 → 测试通过 → 重新打包
cd /Users/jensen/Downloads
tar czf zhongli-src.tar.gz \
  --exclude='zhongli-src/node_modules' \
  --exclude='zhongli-src/.env' \
  --exclude='zhongli-src/data/pglite' \
  zhongli-src

# 上传到 /root/，覆盖解压
# 服务器上：
cd /opt/zhongli
sudo -u zhongli bash -c "cd /opt/zhongli && npm install --omit=dev"
npm run build:client
pm2 restart zhongli-api
```

## 安全性建议（上线前必做）

1. **改默认密码**：`client/vite/mockApiServer.js` 第 ~600 行附近的 `admin/admin123`
2. **关闭 SSH 密码登录**：腾讯云控制台 → SSH 密钥
3. **开放端口**：控制台 → 防火墙 → 只放 80 + 22
4. **启用 HTTPS**：用 certbot 自动签
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```
5. **定期备份 PGlite**：写个 cron，每天凌晨打包上传 OSS