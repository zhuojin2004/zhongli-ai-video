# 中力视频生产平台 - Windows Server 部署文档

## 架构

```
互联网 (公网 IP:8080)
       ↓
┌──────────────────────────────────────────────┐
│ Tencent Cloud Lighthouse (Windows Server)     │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ windows-server.js (端口 8080, pm2)   │    │
│  │  ├─ /api/*  反代 → 127.0.0.1:9099    │    │
│  │  └─ 其他请求 → C:\zhongli-src\dist\   │    │
│  │              \client\ (静态 + SPA)   │    │
│  └──────────────────────────────────────┘    │
│                  ↓                           │
│  ┌──────────────────────────────────────┐    │
│  │ mockApiServer.js (端口 9099, pm2)    │    │
│  │  ├─ 完整 API                         │    │
│  │  └─ PGlite 文件数据库                │    │
│  │      C:\zhongli-src\data\pglite\     │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 部署步骤（20-30 分钟）

### 1. 上传 tarball

把 `/Users/jensen/Downloads/zhongli-src.tar.gz` 上传到 Lighthouse 服务器的 `C:\Users\Administrator\` 目录（OrcaTerm 文件管理器拖拽上传）。

### 2. 解压

在 OrcaTerm 命令提示符（管理员）：
```cmd
cd C:\Users\Administrator
tar -xzf zhongli-src.tar.gz -C C:\
dir C:\zhongli-src
```

应该看到 `deploy-windows\` `client\` `server\` `windows-server.js` 等。

### 3. 一键部署

在 `C:\zhongli-src\deploy-windows\` 里：
1. 找到 `一键部署.bat`
2. **右键 → 以管理员身份运行**
3. 等待 5-15 分钟（首次会下载 Node.js + ffmpeg）

完成后会自动：
- 输出公网 IP + 访问 URL
- 自动打开防火墙端口 8080 / 9099
- 跑通登录接口健康检查

### 4. 腾讯云控制台放行端口

脚本只打开了 **Windows 内部防火墙**。**还需要去腾讯云控制台放行**：

1. https://console.cloud.tencent.com/lighthouse → 你的实例
2. 顶部「防火墙」标签
3. 添加规则：
   - 协议 TCP，端口 8080，策略允许
   - 协议 TCP，端口 9099，策略允许

否则公网访问会被腾讯云防火墙拦截。

### 5. 浏览器访问

部署完成后会输出形如 `http://81.71.xx.xx:8080/` 的 URL。
- 账号：`admin` / `admin123`
- 登录后默认进入素材库，可按角色切换不同模块

## 日常运维

打开 PowerShell 或 cmd：

```cmd
pm2 status                :: 查看两个进程是否 online
pm2 logs                  :: 实时日志（两进程合并）
pm2 logs zhongli-api      :: 仅 API 日志
pm2 restart all           :: 重启两个进程
pm2 stop all              :: 停止
pm2 delete all            :: 彻底删除（再用 pm2 start 启动）

:: 编辑环境变量（填飞书 / MiniMax / OSS 真实密钥）
notepad C:\zhongli-src\.env
pm2 restart all           :: 改完重启
```

## 故障排查

### 部署失败
- 把脚本最后 20 行红色错误截图发我
- 常见：网络下载超时（重跑即可，幂等）
- 常见：端口被占用（先 `pm2 delete all` 再跑）

### 部署成功但浏览器打不开
1. **腾讯云防火墙没放行**：控制台 → 防火墙 → 开放 8080
2. **ORCA 终端防火墙没打开**：脚本会自动 `New-NetFirewallRule`，但 Windows Server 默认可能禁用。手动：
   ```powershell
   New-NetFirewallRule -DisplayName "zhongli-web" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080
   ```
3. **pm2 进程挂了**：`pm2 status` 看状态，`pm2 logs` 看堆栈

### 登录接口 404
正常情况：部署完会跑健康检查，如果登录接口返回非 200 但前端能打开，说明 mockApiServer.js 启动失败：
```cmd
pm2 logs zhongli-api
```
把错误最后 20 行发我。

### 改代码后重新部署
```cmd
cd C:\zhongli-src
npm run build:client
pm2 restart all
```

## 数据备份与迁移

PGlite 数据在 `C:\zhongli-src\data\pglite\`，整目录备份：

```cmd
:: 打包备份
tar -czf D:\pglite-backup-%date:~0,4%%date:~5,2%%date:~8,2%.tar.gz -C C:\zhongli-src\data pglite

:: 还原
pm2 stop all
rmdir /S /Q C:\zhongli-src\data\pglite
tar -xzf pglite-backup-xxx.tar.gz -C C:\zhongli-src\data
pm2 restart all
```

## 文件结构

```
C:\zhongli-src\
├── client\                       # 前端源码 + mockApiServer.js
│   └── vite\
│       └── mockApiServer.js      # 完整后端
├── server\                       # NestJS 服务（部署不用）
├── data\pglite\                  # PGlite 数据库
├── dist\client\                  # 构建后的前端静态文件
├── logs\                         # pm2 日志
├── windows-server.js             # 静态 + API 反代（8080）
├── ecosystem.config.cjs          # pm2 配置
├── .env                          # 环境变量
└── deploy-windows\
    ├── deploy.ps1                # 部署主脚本
    ├── 一键部署.bat              # 入口（右键管理员运行）
    └── README.md                 # 本文档
```

## 后续优化（可选）

- HTTPS：装个 IIS + 证书，nginx for Windows 麻烦
- 域名：腾讯云 DNS 解析 + 证书
- 自动备份：写个 PowerShell 脚本丢进 Windows 任务计划程序