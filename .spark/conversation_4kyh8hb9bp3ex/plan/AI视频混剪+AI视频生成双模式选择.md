## 目标与成功标准

点击"生成 AI 视频素材"按钮后，先弹出双模式选择面板，用户可选择两种生成路线：

1. **AI 视频混剪**：脚本 → 素材库分镜匹配 → 阿里云百炼全妙视频混剪 API → 返回剪辑后的视频
2. **AI 视频生成**：保持现有 5 阶段流水线（脚本→关键帧→语音→视频合成）

成功标准：用户能看到两个选项卡片，点击后进入对应流程；混剪路线能调用阿里云 API 返回混剪结果；生成路线走现有流水线不变。

## 关键实现文件

| 文件 | 改动 |
|------|------|
| `client/src/pages/ProductionLinePage/sections/WorkflowSection.tsx` | 新增 `generationMode` 状态 + 双模式选择卡片；混剪路线新增 `generateClipForEmployee` 函数；生成路线保持现有 `generateForEmployee` |
| `server/modules/video-editing/video-editing.module.ts` | 新建：阿里云百炼视频混剪模块 |
| `server/modules/video-editing/video-editing.service.ts` | 新建：通过 Connections SDK 读取阿里云 API Key，调用全妙视频混剪 API |
| `server/modules/video-editing/video-editing.controller.ts` | 新建：`POST /api/video-editing/clip` 接口 |
| `server/app.module.ts` | 注册 VideoEditingModule |
| `client/src/api/index.ts` | 新增 `videoEditing` namespace 导出 |
| `client/src/api/video-editing.ts` | 新建：前端调用混剪 API 的封装 |

## 实现方案

### 1. 双模式选择面板

在 WorkflowSection 的产品信息面板上方，新增模式选择步骤：

- **状态管理**：`generationMode: 'clip' | 'generate' | null`，初始为 null
- **模式未选择时**：显示两个并排卡片，替代当前的产品信息面板
  - 左卡片「AI 视频混剪」：`Scissors` 图标，标题「AI 视频混剪」，说明「脚本匹配素材库，阿里云百炼智能剪辑」，标签「推荐」
  - 右卡片「AI 视频生成」：`Sparkles` 图标，标题「AI 视频生成」，说明「AI 从零生成脚本、关键帧、语音，合成完整视频」
- **选择后**：卡片消失，显示产品信息面板（与现有一致），底部按钮文案变为对应模式（如「开始 AI 视频混剪」/「生成 AI 视频素材」）
- 提供「返回」按钮可重新选择模式

### 2. AI 视频混剪路线（新）

`generateClipForEmployee` 函数流程：

1. **脚本生成**（复用现有阶段 ①）：调用 `SCRIPT_PLUGIN_ID` 的 `textGenerate`
2. **分镜匹配**（复用现有阶段 ②）：`matchScriptToShots(fullScript, 4)` 从素材库匹配分镜
3. **调用阿里云百炼混剪 API**（新增阶段 ③）：
   - 前端调用 `POST /api/video-editing/clip`，传入脚本内容、匹配到的分镜视频 URL 列表
   - 后端通过 Connections SDK 读取阿里云 API Key（凭证名 `aliyun-bailian`）
   - 调用全妙视频混剪 API，传入素材 URL 列表和脚本时间轴
   - 返回混剪后的视频 URL
4. **语音合成**（复用现有阶段 ④）
5. **视频合成**：将混剪视频与语音合成为最终视频

### 3. 阿里云百炼全妙视频混剪 API 集成

**后端模块**：`server/modules/video-editing/`

- 使用 `@lark-apaas/miaoda-connections-sdk` 的 `ConnectionsService` 读取 API Key
- 凭证类型：`api_key`，凭证名 `aliyun-bailian`
- API 端点：`https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`
- 请求参数：素材 URL 列表、脚本时间轴、输出格式
- 响应：混剪视频的临时下载 URL

### 4. 流水线阶段适配

在混剪路线下，流水线阶段标签调整为：
- 脚本生成 → 分镜匹配 → 智能混剪 → 语音合成 → 视频合成

阶段 ③ 的图标使用 `Scissors`。

## 具体步骤

1. **新建后端视频混剪模块**：`server/modules/video-editing/`，含 Controller + Service + Module，在 `app.module.ts` 注册
2. **实现混剪 Service**：通过 Connections SDK 读取 `aliyun-bailian` 凭证，封装全妙视频混剪 API 调用
3. **前端 API 层**：新建 `client/src/api/video-editing.ts`，在 `api/index.ts` 中导出
4. **WorkflowSection 双模式选择**：新增 `generationMode` 状态 + 双卡片 UI → 选择后进入对应流程
5. **混剪路线实现**：`generateClipForEmployee` 函数，流程为脚本生成→分镜匹配→混剪 API→语音合成→视频合成
6. **流水线阶段动态切换**：根据 `generationMode` 显示不同的阶段标签和图标
7. **联调验证**：混剪路线能正常调用后端 API，生成路线保持原有流程不变

## 影响范围与风险

- 现有生成路线（AI 视频生成）保持不变，仅增加模式选择步骤
- 混剪 API 依赖阿里云百炼凭证，用户需先在妙搭开发态配置 `aliyun-bailian` 凭证
- 未配置凭证时，混剪路线给出明确提示，不阻塞生成路线
- 混剪 API 调用为异步任务，需轮询或等待结果，前端需处理等待状态

## 验收标准

1. 点击「生成 AI 视频素材」→ 显示双模式选择卡片
2. 选择「AI 视频混剪」→ 进入产品信息面板 → 点击「开始 AI 视频混剪」→ 走混剪流水线
3. 选择「AI 视频生成」→ 进入产品信息面板 → 点击「生成 AI 视频素材」→ 走现有流水线
4. 混剪路线能调用后端 API，后端正确读取阿里云凭证并调用全妙视频混剪
5. 未配置凭证时混剪按钮给出提示，不崩溃
6. 模式选择面板有返回按钮可重新选择
7. 无 TS 报错，类型检查通过

## 未决事项

- 全妙视频混剪 API 的具体参数格式需在实现时查阅阿里云百炼文档确认（当前按通用视频合成 API 设计）
- 混剪 API 返回的视频 URL 可能是临时 URL，需确认是否需要下载后转存到 dataloom