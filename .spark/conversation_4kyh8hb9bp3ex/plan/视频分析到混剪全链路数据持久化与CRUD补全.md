## 目标与成功标准

打通「视频导入 → AI 打标 → 分镜标签持久化 → 混剪调用真实分镜数据 → 混剪结果存储 → 二次修改」的完整闭环。用户导入视频后，分镜标签永久保存；混剪流程从数据库读取真实分镜数据而非 mock；混剪结果可编辑。

成功标准：
- 视频分析完成后，分镜数据写入数据库，刷新页面后数据不丢失
- 分镜标签页面从后端 API 读取数据，有完整的增删改查
- 混剪流程使用数据库中的真实分镜数据做匹配
- 混剪结果可编辑（二次修改）
- 所有数据表有完整的 CRUD

## 关键实现文件

- `server/database/schema.ts` — 不修改（自动生成），需通过 lark-apps-db skill 建表
- `server/modules/video-analysis/video-analysis.service.ts` — 分析完成后新增落库逻辑
- `server/modules/video-analysis/video-analysis.controller.ts` — 新增 list/detail/update/delete 路由
- `server/modules/video-analysis/` — 新增 video-shot CRUD 子模块
- `server/modules/workflow/workflow.controller.ts` — 新增 PATCH update 路由
- `server/modules/workflow/workflow.service.ts` — 新增 update 方法
- `shared/api.interface.ts` — 新增分镜标签相关类型，新增 workflow update DTO
- `client/src/pages/VideoTagViewerPage/` — 改为从后端 API 读取数据，增删改走 API
- `client/src/pages/ProductionLinePage/sections/WorkflowSection.tsx` — 混剪分镜匹配改为从 API 获取真实数据
- `client/src/utils/material-match.ts` — 分镜匹配改为从 API 获取数据
- `client/src/api/` — 新增 video-analysis 和 video-shot API 函数

## 实现方案

### 1. 建分镜标签持久化表（video_shots）

通过 lark-apps-db skill 执行 DDL，建 `video_shots` 表存储每一条分镜记录：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | 主键 |
| video_id | uuid FK → video_analyses | 所属视频分析记录 |
| start_time | float | 起始秒数 |
| end_time | float | 结束秒数 |
| description | text | 画面描述 |
| scene | varchar | 场景 |
| objects | varchar | 画面中物体 |
| action | text | 动作描述 |
| camera | varchar | 镜头语言 |
| core_selling_point | varchar | 核心卖点 |
| narration_text | text | 旁白文案 |
| 系统字段 | timestamptz + user_profile | _created_at, _updated_at, _created_by, _updated_by |

同时建 `video_analyses` 表存储每次分析的整体元数据（productModel, totalDuration, shotCount, industry, clientName, department, categoryTags, quality, videoUrl）。

### 2. 视频分析完成后落库

修改 `video-analysis.service.ts` 的 `analyze()` 方法：分析完成后，将结果写入 `video_analyses` 表（元数据）和 `video_shots` 表（分镜列表），再返回给前端。

### 3. 分镜标签后端 CRUD

新建 `server/modules/video-analysis/` 下的 shot 子模块（shot.controller.ts + shot.service.ts），提供：
- `GET /api/video/shots?videoId=xxx` — 按视频查询分镜列表
- `POST /api/video/shots` — 新增分镜
- `PATCH /api/video/shots/:id` — 编辑分镜
- `DELETE /api/video/shots/:id` — 删除分镜

同时为 video_analyses 提供 list/detail/delete 路由。

### 4. VideoTagViewerPage 对接后端 API

- 改为调用后端 API 获取视频列表和分镜数据
- 新增/编辑/删除分镜操作通过 API 完成
- 添加 loading/error/empty 状态处理
- 保留视频播放器和时间轴的交互逻辑

### 5. 混剪流程使用真实分镜数据

- 修改 `material-match.ts` 的 `matchScriptToShots()`：从后端 API 获取分镜数据（而非 mock 文件）
- WorkflowSection 中调用 clipVideo 时传入真实匹配到的分镜视频 URLs

### 6. 补全 workflow_runs 更新接口

- `workflow.service.ts` 新增 `update(id, dto)` 方法
- `workflow.controller.ts` 新增 `PATCH /api/workflow/runs/:id` 路由
- 前端 `client/src/api/workflow/index.ts` 新增 `updateRun()` 函数
- 支持修改 scriptContent、videoUrl、status 等字段

### 7. 视频上传功能

在素材库页面实现视频上传：使用 dataloom SDK 上传视频文件到云存储，获取 downloadUrl 后传给分析接口。

## 具体步骤

1. **建表**：通过 lark-apps-db skill 执行 DDL，创建 `video_analyses` 和 `video_shots` 表
2. **重新读取 schema.ts**，确认新表定义
3. **更新 shared/api.interface.ts**：新增 VideoAnalysis、VideoShot、CreateVideoShotDto、UpdateVideoShotDto、UpdateWorkflowRunDto 等类型
4. **修改 video-analysis.service.ts**：`analyze()` 完成后写库
5. **新建 shot 子模块**：shot.controller.ts + shot.service.ts + shot.module.ts
6. **修改 video-analysis.controller.ts**：新增 video_analyses 的 list/detail/delete 路由
7. **注册模块**：在 `server/app.module.ts` 和 `server/modules/video-analysis/video-analysis.module.ts` 中注册
8. **更新前端 API 层**：新增 `client/src/api/video-shot.ts`，更新 `client/src/api/video-analysis.ts`
9. **改造 VideoTagViewerPage**：从 mock 数据切换为 API 调用
10. **改造混剪分镜匹配**：material-match.ts 改为从 API 获取分镜数据
11. **补全 workflow CRUD**：后端 update + 前端 updateRun
12. **实现视频上传**：素材库页面集成 dataloom 上传
13. **接口测试 + 验证**：测试全链路

## 影响范围与风险

- **VideoTagViewerPage 重写数据层**：当前所有分镜操作基于 mock 数据，改为 API 调用后需重构 state 管理逻辑，但视频播放器和时间轴的 UI 交互可保留
- **混剪流程依赖变化**：分镜匹配从同步 mock 导入变为异步 API 调用，需处理 loading 状态
- **数据库新增两张表**：不影响现有 production_tasks 和 workflow_runs 表
- **EDGE CASE**：视频分析失败（Kimi API 不可用）时，mock 兜底结果也应落库，确保数据完整性

## 验收标准

- [ ] 视频分析完成后，分镜数据写入 video_shots 表，刷新页面后数据仍在
- [ ] VideoTagViewerPage 从后端 API 读取数据，有 loading/error/empty 三态
- [ ] 分镜标签可新增、编辑、删除，操作后数据持久化
- [ ] 混剪流程中分镜匹配使用数据库中的真实数据
- [ ] workflow_runs 支持 PATCH 更新
- [ ] 混剪结果（production_tasks）可编辑 scriptContent、videoUrl、status
- [ ] 素材库可上传视频文件并获得 downloadUrl

## 未决事项

- 视频上传后是否自动触发分析？还是手动触发？当前设计中分析接口接受 downloadUrl，上传后需手动调用分析接口。建议上传后自动触发分析，需确认。
- 混剪视频的"二次修改"具体指什么？当前 production_tasks 的 update 支持修改 title/scriptContent/videoUrl/status。如果是指重新混剪（换素材/换脚本），那是重新走一遍混剪流程，不是编辑现有结果。