# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**重力视频素材库** — 极简版。核心只有 1 个业务页面：**双素材库**。可上传视频、浏览视频、编辑分镜（鼠标 hover 到分镜标签出现小铅笔即可编辑，自动同步飞书）。

**默认账号** (mock 模式): `admin / admin123`

## 业务页面（仅 4 个）

| 页面 | 路由 | 作用 |
|---|---|---|
| `LoginPage` | `/login` | 登录（未登录唯一入口） |
| `MaterialLibraryPage` | `/` `/materials` | **核心**：双素材库（产品库 / 员工库） |
| `MaterialUploadPage` | `/upload` | 上传视频（独立路由，全屏 modal 风格） |
| `NotFoundPage` | `*` | 404 兜底 |

> 已删除的页面（不要恢复）：ProductionLinePage / IterationCenterPage / DashboardPage / VideoTagViewerPage / AuthorizationPage / SimpleClipPage / VideoEditorPage / ClipWorkbenchPage / AdminDashboardPage / ExamplePage

## 核心功能链路

```
上传视频
  ├─ MaterialLibraryPage 顶部点「上传素材」→ 跳 /upload
  └─ MaterialUploadPage 拖拽/选择视频
     → POST /api/upload (multipart)
       ├─ 写本地磁盘
       ├─ SHA-256 哈希去重
       ├─ ⭐ 同步写 PGlite materials 表
       ├─ ⭐ 异步同步写飞书·主表
       └─ ⭐ 异步触发 analyzeAndSyncToShotTable (60-180s)
          ├─ MiniMax-M3 抽帧 + 多模态识别
          ├─ ⭐ 同步写飞书·分镜表
          └─ ⭐ 同步写 PGlite shots 表
     → 完成后 navigate('/materials') 回素材库

浏览视频
  └─ MaterialLibraryPage
     → tab 切换：员工素材库 | 产品素材库
     → 点分组 → 分页视频列表
     → 点视频卡 → 打开 VideoShotDetailDialog
       ├─ 视频播放器
       ├─ 分镜时间轴
       ├─ 分镜标签列表（每条 hover 出现 ✏️ 铅笔图标）
       └─ ⭐ 点铅笔 → 调 PATCH /api/library/shot/:shotId
          └─ ⭐ 自动同步写飞书·分镜表
```

## 常用命令

```bash
# 全栈开发（mockApiServer + Vite 并行）
npm run dev

# 仅前端
npm run dev:client

# 类型检查（前后端并行）
npm run type:check

# lint / format
npm run lint
npm run format

# 测试
npm run test
npm run test:watch
npm run test:e2e

# 生产构建
npm run build
npm run build:client

# 数据库 schema 重新生成
npm run gen:db-schema
```

## 关键架构事实

### 双后端并存（一定要看）

| 后端 | 路径 | 状态 |
|---|---|---|
| **mockApiServer** | `client/vite/mockApiServer.js` (5343 行) | ✅ 真实业务后端，生产用 |
| **NestJS server** | `server/` (10 个模块) | ⚠️ 骨架，业务未迁入 |

Vite dev 把 `/api/*` proxy 到 `localhost:9099`（mockApiServer）。生产 nginx 反代也是同一端口。

### 路由结构（`client/src/app.tsx`）

```tsx
<AuthProvider>
  <RoleProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<MaterialLibraryPage />} />
        <Route path="materials" element={<MaterialLibraryPage />} />
        <Route path="upload" element={<MaterialUploadPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </RoleProvider>
</AuthProvider>
```

- `ProtectedRoute` 强制登录
- `Layout` = `SidebarProvider` + `AppSidebar`（目前只显示"素材库"一个导航项）+ `Header` + `<Outlet/>`
- 角色从 `AuthContext.user.role` 派生，3 种：`admin` / `operator` / `user`（业务员）

### 三个 axios 实例（`client/src/utils/localAxios.ts`）

| 实例 | timeout | 调用方 |
|---|---|---|
| `localAxios` | 10 分钟 | 通用 API |
| `analyzeAxios` | 10 分钟 | AI 分析（MiniMax-M3 60-180s） |
| `clipAxios` | 10 分钟 | 混剪合成 |

全部 `baseURL: '/'` + Vite proxy。**禁止**改回 60s 默认值（22MB+ 视频上传会被误杀）。

### MaterialLibraryPage 内部结构

```
MaterialLibraryPage.tsx (451 行)
├─ tabs: product | employee
├─ 搜索 + 排序（视频数量 / 最近上传）
├─ 上传按钮（业务员 + 管理员/运营可见）
├─ 分组网格（GroupGridSection）
│   ├─ ProductGroupGridSection
│   └─ EmployeeGroupGridSection
├─ 视频网格（VideosGridSection）
└─ 视频详情 Dialog（VideoShotDetailDialog）
    ├─ 视频播放器
    ├─ 分镜时间轴
    ├─ 分镜标签列表（hover→✏️→编辑）
    └─ 自动同步飞书
```

### 三个 sections 文件

```
client/src/pages/MaterialLibraryPage/sections/
├── GroupGridSection.tsx       # 产品/员工分组卡片网格
├── VideosGridSection.tsx       # 视频卡片网格
└── VideoShotDetailDialog.tsx  # 视频详情 Dialog（含分镜编辑）
```

> 已删除的死代码 sections：MaterialGridSection / MaterialFilterSection / FilterPanel / MaterialDetailDialog（都没人用，已清理）

### 共享类型（`shared/api.interface.ts`）

所有 DTO 都从这里 import，前后端共用。MaterialItem / VideoShot / User / LoginResponse 等。

## 调试辅助脚本（根目录）

不要被根目录那一堆 `_xxx.js` 吓到，**它们不是项目源代码**：

| 文件 | 用途 |
|---|---|
| `_smoke-test.js` | API 冒烟测试 |
| `_test_minimax_real.js` | 真实 MiniMax 链路测试 |
| `_backfill*.js` `_retry*.js` `_verify*.js` `_probe*.mjs` | 一次性数据修复/验证 |
| `batch-sync.js` `audit-sync.js` | 飞书批量同步 |
| `dry_run_*.mjs` `check_main.mjs` `task_*.mjs` `fix-*.py/sh` | 数据迁移工具 |

**理解项目时全部跳过**。它们是开发者本地临时脚本，不参与构建。

## 部署

详见 `deploy/README.md`（腾讯云 Lighthouse + nginx + pm2 + mockApiServer.js）。

```bash
# 本机打包（不含依赖/.env/data）
cd /Users/jensen/Downloads
tar czf zhongli-src.tar.gz \
  --exclude='zhongli-src/node_modules' \
  --exclude='zhongli-src/.env' \
  --exclude='zhongli-src/data/pglite' \
  --exclude='zhongli-src/logs' \
  --exclude='zhongli-src/dist' \
  zhongli-src

# 服务器
sudo bash deploy/deploy.sh
```

## 常见陷阱

1. **不要修改 `client/src/index.tsx`** — Provider 层级 + 样式引入由模板管理
2. **不要修改 `client/src/components/ui/*`** — shadcn/ui 内置组件锁版本
3. **`mockApiServer.js` vs `server/`** — 当前业务 API 在 `mockApiServer.js`；NestJS 模块是平台占位骨架，迁移要单独评估
4. **Vite proxy timeout** — 默认 2 分钟必须改为 10 分钟（AI 分析实测 60-180s）
5. **axios timeout** — 默认 60s 不够，必须 10 分钟
6. **PGlite 数据** — `./data/pglite/` 是关键资产，备份/迁移时整个目录打 tar
7. **不要手改 `scripts/*`** — 平台自动生成，会与平台漂移
8. **不要新增页面目录** — 当前 4 页面是简化目标，新功能请加在 MaterialLibraryPage / MaterialUploadPage 内
9. **mockApiServer.js 是 CommonJS** — 不支持 ESM
10. **macOS 上传按钮灰色 bug** — `MaterialUploadPage.tsx:119-140` 的「动态创建 input 元素立即 click」方案，删之前请理解为什么

## 临时性数据/调试产物

- `data/pglite/` — PGlite 嵌入式数据库（git ignored）
- `logs/` — dev/prod 日志
- 根目录 `*.log` `*.json`（backfill.log / sync-audit.json 等）— 调试脚本的运行产物

## 已知 TS 错误（预先存在，与清理无关）

```
client/src/components/ui/button.tsx(65,29): 'type' 属性不存在
client/src/index.tsx(17,25): error.message 不存在
client/src/pages/MaterialLibraryPage/sections/VideosGridSection.tsx(297,61): keyframePath 不存在
client/src/pages/MaterialUploadPage/MaterialUploadPage.tsx(212,11): AnalyzeVideoRequest 多 fileName
client/vite/mockApiPlugin.ts(3,15): connect.Connect 未导出
```

这些都是模板/小 bug，**与本次清理无关**，保留待后续处理。