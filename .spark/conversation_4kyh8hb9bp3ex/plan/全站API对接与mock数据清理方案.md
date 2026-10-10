## 1. 目标与成功标准

清除全站 mock 数据残留，将所有页面切换为真实后端 API 驱动。用户打开任意页面时，数据均来自数据库而非静态 mock 文件。

## 2. 现状诊断

### ✅ 已对接真实 API 的页面
- **ProductionLinePage** — 生产任务 CRUD (`/api/production/tasks`) + 工作流 (`/api/workflow/runs`) + 混剪 (`/api/video-editing/clip`)
- **VideoTagViewerPage** — 视频分析列表/详情 (`/api/video`) + 分镜 CRUD (`/api/video/shots`)
- **MaterialLibraryPage** — 视频上传部分已对接 dataloom + analyze API

### ❌ 完全依赖 mock 数据的页面（无后端 API）
- **DashboardPage** — 所有数据来自 `@/data/dashboard.ts`（KPI、管线统计、发布概览、视频趋势）
- **IterationCenterPage** — 所有数据来自 `@/data/iteration.ts`（热门标签、竞品分析、经销商案例、迭代建议）
- **AuthorizationPage** — 所有数据来自 `@/data/authorization.ts`（授权记录列表、开通/续期无 API 调用）

### ⚠️ 部分依赖 mock 的页面
- **MaterialLibraryPage + MaterialUploadPage + MaterialDetailDialog** — 素材管理（列表/搜索/删除/标签编辑）仍调用 `materials.ts` mock 函数
- **SimpleClipPage / VideoEditorPage / AdminDashboardPage** — 使用 `clip-tasks.ts` 和 `video-tags.ts` mock 数据

### 🔌 使用 Lark 插件（非标准 REST）
- **AccountMonitorPage** — 调用 `forklift_industry_channel_search_summary_1` 插件
- **DashboardPage/CompetitorMonitorSection** — 调用 `competitor_video_content_analysis_1` 插件

## 3. 实现方案

### 3.1 DashboardPage 后端 API（新建模块 `server/modules/dashboard/`）

建表 `dashboard_kpis` 存储 KPI 指标快照，提供 `GET /api/dashboard` 返回聚合数据。

- 建表：`dashboard_kpis`（字段：target/sales_internal/sales_external/estimated/gap/last_year + 审计列）
- Controller：`GET /api/dashboard` 返回最新一条 KPI 记录 + 生产管线统计（从 production_tasks 聚合）+ 最近发布内容（从 workflow_runs 取最近 5 条）
- 前端：DashboardPage 改为调用 `GET /api/dashboard`，删除 `@/data/dashboard` 导入
- 灌一条初始 mock 数据到 dashboard_kpis 表

### 3.2 IterationCenterPage 后端 API（新建模块 `server/modules/iteration/`）

建表 `iteration_items` 存储迭代建议，提供 `GET /api/iteration` 返回建议列表。

- 建表：`iteration_items`（字段：type(hot_tag/competitor/dealer_case/suggestion) + title + description + metrics jsonb + 审计列）
- Controller：`GET /api/iteration?type=hot_tag|competitor|dealer_case|suggestion` 按类型筛选
- 前端：IterationCenterPage 改为调用 API，删除 `@/data/iteration` 导入
- 灌各类型初始数据

### 3.3 AuthorizationPage 后端 API（新建模块 `server/modules/authorization/`）

建表 `authorizations` 存储授权记录，提供 CRUD。

- 建表：`authorizations`（字段：user_name/user_type/status/payment_method/amount/expire_date + 审计列）
- Controller：`GET /api/authorization` 列表 + `POST /api/authorization` 创建 + `PATCH /api/authorization/:id` 开通/续期
- 前端：AuthorizationPage 改为调用 API，删除 `@/data/authorization` 导入
- 灌初始授权记录

### 3.4 MaterialLibraryPage 素材管理 API 改造

当前 `materials.ts` 提供了完整的 mock 状态管理（增删改查），但素材数据存储在 `video_analyses` 表（上传视频分析后已落库）。改造方向：

- 复用 `video_analyses` 表作为素材库数据源（已有 videoUrl/videoName/productModel/categoryTags/quality 等字段）
- 新增素材管理 API：`GET /api/materials` 列表（含搜索/筛选） + `DELETE /api/materials/:id` 删除 + `PATCH /api/materials/:id` 更新标签
- 前端：MaterialLibraryPage 改为调用 API，删除 `materials.ts` 导入
- 已上传的视频直接出现在素材库中

### 3.5 清理遗留 mock 页面

- **SimpleClipPage / VideoEditorPage / AdminDashboardPage**：这些是辅助页面，改用 `video_analyses` 表数据或与 ProductionLinePage 共享数据源
- **MaterialUploadPage**：已在上次迭代中改造为使用 dataloom + analyze API，需确认无 mock 残留

## 4. 具体步骤

### 步骤 1：Dashboard 全链路
1. 建 `dashboard_kpis` 表（DDL）+ 灌初始数据
2. 创建 `server/modules/dashboard/` 模块（controller + service + module）
3. 注册到 `app.module.ts`
4. 创建 `client/src/api/dashboard.ts`
5. 改造 DashboardPage 及其 6 个 section 为 API 数据源
6. 接口测试验证

### 步骤 2：Iteration 全链路
1. 建 `iteration_items` 表（DDL）+ 灌初始数据
2. 创建 `server/modules/iteration/` 模块
3. 注册到 `app.module.ts`
4. 创建 `client/src/api/iteration.ts`
5. 改造 IterationCenterPage 及其 4 个 section
6. 接口测试验证

### 步骤 3：Authorization 全链路
1. 建 `authorizations` 表（DDL）+ 灌初始数据
2. 创建 `server/modules/authorization/` 模块
3. 注册到 `app.module.ts`
4. 创建 `client/src/api/authorization.ts`
5. 改造 AuthorizationPage（开通/续期按钮绑定 API）
6. 接口测试验证

### 步骤 4：MaterialLibrary 素材管理 API
1. 在 `video-analysis` 模块新增 `GET /api/materials` + `PATCH /api/materials/:id` 路由
2. 改造 MaterialLibraryPage、MaterialGridSection、MaterialDetailDialog
3. 确认 MaterialUploadPage 无 mock 残留

### 步骤 5：清理遗留页面
1. SimpleClipPage / VideoEditorPage / AdminDashboardPage 改用 API 数据源
2. 删除不再使用的 mock 数据文件

## 5. 影响范围与风险

- **数据库**：新建 3 张表（dashboard_kpis、iteration_items、authorizations），不影响现有表
- **前端**：改造 6 个页面（DashboardPage、IterationCenterPage、AuthorizationPage、MaterialLibraryPage、MaterialUploadPage、MaterialDetailDialog），涉及 20+ 组件
- **风险**：AccountMonitorPage 依赖 Lark 插件，插件不可用时页面无法展示数据（非本次改造范围，属于插件配置问题）
- **MaterialLibraryPage** 的素材数据源从 `@/data/materials.ts` 切换到 `video_analyses` 表，需确认字段映射是否完整

## 6. 验收标准

- [ ] DashboardPage 打开后 KPI 卡片、管线统计、发布概览均从 API 加载，无 mock 数据引用
- [ ] IterationCenterPage 热门标签、竞品分析、经销商案例、建议卡片均从 API 加载
- [ ] AuthorizationPage 授权列表从 API 加载，开通/续期按钮可触发 API 调用
- [ ] MaterialLibraryPage 素材列表从 API 加载，搜索/删除/标签编辑通过 API 完成
- [ ] 所有 `@/data/` 导入仅保留类型定义接口，数据常量不再被页面直接引用
- [ ] 新增的 3 个模块所有接口返回 200，数据正确
- [ ] 无 TypeScript 编译错误，前端 devServer 无报错