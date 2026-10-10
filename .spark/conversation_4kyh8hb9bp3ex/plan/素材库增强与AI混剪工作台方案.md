## 目标与成功标准

**素材库增强**：用户能在素材上传页批量上传视频，线上 Kimi API 自动打标入库；也能导入 Excel 打标表格直接入库。素材库页面正确展示所有视频及其打标结果。

**AI 混剪工作台**：新建独立页面，老板输入需求+选时长 → 自动生成脚本 → 从数据库智能匹配分镜 → 加运镜+AI配音 → 合成视频。生成视频保存在历史记录中，支持分类筛选。

---

## 关键实现文件

### 素材库增强
- `server/modules/video-analysis/video-analysis.service.ts` — 优化批量分析逻辑，支持并发队列
- `server/modules/video-analysis/video-analysis.controller.ts` — 新增 `POST /api/video/analyze/batch` 批量分析接口
- `server/modules/materials/` — 新建 materials 模块，提供 CRUD + Excel 导入接口
- `client/src/pages/MaterialUploadPage/MaterialUploadPage.tsx` — 改为多文件批量上传 + 进度展示
- `client/src/pages/MaterialLibraryPage/MaterialLibraryPage.tsx` — 增加 Excel 导入入口，素材卡片展示打标摘要
- `shared/api.interface.ts` — 新增批量分析、Excel 导入相关类型

### AI 混剪工作台
- `client/src/pages/ClipWorkbenchPage/` — 新建混剪工作台页面
- `server/modules/video-editing/video-editing.service.ts` — 增强混剪逻辑，支持运镜参数
- `server/modules/clip-history/` — 新建混剪历史模块
- `server/database/schema.ts` — 新增 `clip_history` 表（DDL 通过 lark-cli 执行）
- `client/src/pages/ClipHistoryPage/` — 新建混剪历史记录页面（或作为混剪工作台子页面）

---

## 实现方案

### 一、素材库增强

**1. 配置 KIMI_API_KEY 环境变量**
- 通过 `lark-cli apps +env-set` 配置 `KIMI_API_KEY`，让线上 AI 打标从 mock 降级切换到真实 Kimi API

**2. 批量上传视频并自动打标**
- MaterialUploadPage 改为多文件选择：`<input multiple>` 或拖拽多文件
- 上传队列管理：逐个上传到 dataloom storage，每个上传完成后立即调用 `POST /api/video/analyze` 触发分析
- 进度展示：显示"正在上传 X/N"和"正在分析 X/N"两阶段进度条
- 后端新增 `POST /api/video/analyze/batch` 接口，接收 `{ downloadUrls: string[] }`，并发处理（限制并发数 3），返回每项结果

**3. Excel 导入打标结果**
- 在 MaterialLibraryPage 顶部增加「导入 Excel」按钮
- 上传 Excel 文件后前端用 xlsx 库解析，映射列：视频名称、行业、产品型号、客户、部门、质量、时长 → 视频元信息；每条分镜（起始秒、结束秒、画面描述、场景、动作、镜头、核心卖点、旁白文案）→ video_shots
- 前端将解析后的结构化数据通过 `POST /api/materials/import` 批量写入数据库
- 若视频名称已存在则跳过（不重复导入）

**4. 素材库展示增强**
- 素材卡片增加标签摘要：行业标签、打标分镜数、核心卖点关键词
- 点击卡片进入详情弹窗，展示完整分镜标签时间轴（已有 MaterialDetailDialog）

### 二、AI 混剪工作台

**1. 新建混剪工作台页面 (`/clip-workbench`)**
- 左侧：需求输入区（产品名、目标人群、使用场景、核心卖点）、时长选择（15s/30s/45s/60s）
- 中间：生成结果预览区（视频播放器 + 分镜列表 + 脚本展示）
- 右侧：历史记录面板（最近生成的视频列表）
- 底部：一键生成按钮

**2. 智能分镜匹配**
- 后端新增 `POST /api/video-editing/match-shots` 接口
- 接收脚本内容，对每段脚本提取关键词
- 在 `video_shots` 表中按 `description`、`coreSellingPoint`、`scene`、`objects` 字段做模糊匹配（使用 PostgreSQL `ilike` 或 `similarity`）
- 每段脚本返回 top 3 候选分镜，前端可手动切换

**3. 视频合成增强**
- 在 `POST /api/video-editing/clip` 请求中增加运镜参数（`cameraMotion`: pan/zoom/none）
- 混剪时对每段分镜添加对应的运镜描述

**4. 混剪历史记录**
- 新建 `clip_history` 表：id, title, requirement(需求描述), duration(目标时长), scriptContent, videoUrl, shotIds(使用的分镜ID列表), category(分类标签), status, createdAt
- 新建 `server/modules/clip-history/` 模块，提供 CRUD
- 混剪完成后自动写入历史记录
- 历史记录支持按分类筛选（如"产品推广""节日营销""客户案例"等）

**5. 路由与导航**
- 新增路由 `/clip-workbench` → ClipWorkbenchPage
- Sidebar 导航增加「AI 混剪」入口（图标：Clapperboard）
- 运营端导航展示 5 项：素材库、AI 混剪、生产流水线、分镜标签、内容迭代中心

---

## 具体步骤

### 步骤 1：配置 KIMI_API_KEY
- 通过 `lark-cli apps +env-set` 配置环境变量，使线上 AI 打标切换为真实 Kimi 调用
- 验证：上传一个视频，查看服务端日志确认输出了 "Kimi analysis complete" 而非 "using mock fallback"

### 步骤 2：批量上传视频
- 修改 `MaterialUploadPage.tsx`：支持多文件选择，维护上传队列状态
- 后端新增 `POST /api/video/analyze/batch`：并发分析（限制 3 并发），返回每项成功/失败
- 前端展示两阶段进度条

### 步骤 3：Excel 导入打标结果
- 在 MaterialLibraryPage 顶部增加「导入 Excel」按钮
- 前端用 xlsx 解析 Excel，按约定列名映射到 video_analyses + video_shots
- 后端新建 `POST /api/materials/import` 接口，接收解析后的结构化数据批量写入
- 视频名称已存在时跳过

### 步骤 4：素材库展示增强
- MaterialGridSection 卡片增加标签摘要展示
- 确认详情弹窗分镜数据正确加载

### 步骤 5：新建混剪工作台页面
- 创建 `ClipWorkbenchPage`，包含需求输入、时长选择、预览区、生成按钮
- 复用现有 capabilityClient 插件生成脚本和 TTS 音频
- 调用后端分镜匹配接口 + 视频合成接口

### 步骤 6：智能分镜匹配后端
- 新增 `POST /api/video-editing/match-shots` 接口
- 对脚本分段提取关键词，在 video_shots 表做模糊匹配
- 返回每段脚本的 top 3 候选分镜

### 步骤 7：混剪历史记录
- DDL 创建 `clip_history` 表
- 新建 `server/modules/clip-history/` 模块
- 混剪完成后自动保存历史
- 历史记录面板支持分类筛选

### 步骤 8：路由与导航更新
- 注册 `/clip-workbench` 路由
- Sidebar 增加「AI 混剪」导航项

---

## 影响范围与风险

- **MaterialUploadPage 重构**：从单文件改为多文件，需保留现有进度步骤 UI 风格
- **MaterialLibraryPage 增加 Excel 导入**：不影响现有素材展示逻辑
- **新增 clip_history 表**：不影响现有表结构
- **video-editing 模块增强**：增加运镜参数，需确保向下兼容
- **KIMI_API_KEY 配置**：需要用户提供 API Key，配置后立即生效

---

## 验收标准

1. **批量上传**：选择 3 个视频文件 → 逐个上传到存储 → 逐个调用 Kimi 分析 → 素材库中看到 3 条新的打标记录
2. **Excel 导入**：上传包含打标结果的 Excel → 解析成功 → 素材库中出现对应视频和分镜数据
3. **素材库展示**：素材卡片展示行业标签、分镜数、核心卖点；点击详情弹窗展示完整分镜时间轴
4. **混剪工作台**：输入需求 → 选 15s 时长 → 点击生成 → 生成脚本 → 匹配分镜 → 合成视频 → 可播放预览
5. **混剪历史**：生成后自动保存到历史记录；可按分类筛选；可点击查看历史视频
6. **导航**：Sidebar 出现「AI 混剪」入口，点击进入混剪工作台

---

## 未决事项

- **KIMI_API_KEY**：需要用户提供 Kimi API Key，配置后 AI 打标才能生效
- **Excel 导入列名约定**：需要确认 Excel 表格的列名格式，建议先看用户提供的表格样例再确定映射规则