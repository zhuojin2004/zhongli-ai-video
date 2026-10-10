# 切换视频分析后端从 Kimi 到 MiniMax

## 1. 目标与成功标准

- 用户上传视频到素材库触发打标时，后端改为调用 MiniMax 接口完成分镜/标签/元数据分析，不再使用 Moonshot Kimi
- 保持现有的 JSON Schema 输出、数据库写入、错误兜底与 mock fallback 行为不变
- 接口契约（`POST /api/video-analysis/analyze` 等）不变，前端无需任何改动
- 成功标准：配置 `MINIMAX_API_KEY` 后，分析流程调用 MiniMax 成功并把结果落库；未配置时回退到 mock，与原 Kimi 路径表现一致

## 2. 关键实现文件

- `server/modules/video-analysis/video-analysis.service.ts` — 唯一需要改动的文件
  - 替换 Kimi 客户端常量、文件上传方法、chat 调用方法、模型名与视频引用格式

无需改动：`video-analysis.controller.ts`、`shot.controller.ts`、`shot.service.ts`、`video-analysis.module.ts`、`mock-data.ts`、`shared/api.interface.ts`、任何前端文件

## 3. 实现方案

### 3.1 顶部常量与日志
- 把 `KIMI_API_KEY` / `KIMI_BASE` 改名为 `MINIMAX_API_KEY` / `MINIMAX_BASE`
- `MINIMAX_BASE = 'https://api.MiniMax.com/v1'`
- 日志文案 "Kimi" 统一改为 "MiniMax"

### 3.2 文件上传（`uploadToKimi` → `uploadToMiniMax`）
- endpoint 改为 `${MINIMAX_BASE}/files`
- 沿用 multipart/form-data + Bearer 鉴权
- `purpose` 字段值改为 MiniMax 接受的值（`video` / `vision` 视接口约定，先用 `video`，不通过再调整为 `vision`）

### 3.3 Chat Completion（`analyzeWithKimi` → `analyzeWithMiniMax`）
- endpoint 改为 `${MINIMAX_BASE}/chat/completions`
- 模型名 `kimi-k3` → `MiniMax-Text-01`（MiniMax 支持视频理解的多模态模型）
- 视频引用：MiniMax 不使用 Kimi 的 `ms://file_id` 协议，改为 OpenAI 兼容的 `video_url` 类型，URL 用上传后拿到的 `file_id` 拼成下载 URL，格式：
  ```json
  { "type": "video_url", "video_url": { "url": "${MINIMAX_BASE}/files/${fileId}/content" } }
  ```
- system prompt、user prompt、json_schema 完全沿用现有内容（业务侧 prompt 已经是中文工业视频分析专用，无需调整）
- 响应解析维持 `data.choices[0].message.content` + `JSON.parse` 的逻辑

### 3.4 环境变量
- 新增 `MINIMAX_API_KEY`，值为用户提供的 `***MINIMAX_KEY_REMOVED***`
- 用户需要在妙搭环境变量配置里设置 `MINIMAX_API_KEY=<key>`（或在 `server/main.ts` 启动时读 .env；平台默认不读 .env，所以优先用环境变量配置页设置）
- 若暂时未设置环境变量，保留现有的 mock fallback 兜底逻辑（`if (!MINIMAX_API_KEY) → mockAnalyze`）

## 4. 具体步骤

1. 编辑 `server/modules/video-analysis/video-analysis.service.ts`：
   - 第 21-22 行：替换 `KIMI_API_KEY` → `MINIMAX_API_KEY`，`KIMI_BASE` → `MINIMAX_BASE = 'https://api.MiniMax.com/v1'`
   - 第 57-58 行：日志改为 "MINIMAX_API_KEY not configured, using mock fallback"
   - 第 78 行：日志改为 "Uploaded to MiniMax, file_id: ${fileId}"
   - 第 279-301 行：方法名 `uploadToKimi` → `uploadToMiniMax`，endpoint 改 `${MINIMAX_BASE}/files`，purpose 改 `video`
   - 第 303-418 行：方法名 `analyzeWithKimi` → `analyzeWithMiniMax`：
     - endpoint 改 `${MINIMAX_BASE}/chat/completions`
     - model 改 `MiniMax-Text-01`
     - video_url.url 改 `${MINIMAX_BASE}/files/${fileId}/content`
     - 错误日志文案改 MiniMax
2. 在妙搭环境变量配置页添加 `MINIMAX_API_KEY=<用户提供的 key>`
3. 触发一次视频分析（前端素材库上传或调用 `POST /api/video-analysis/analyze`），确认日志显示 "Uploaded to MiniMax" 与 "Analysis complete"
4. 打开数据库 `video_analyses` / `video_shots` 表，确认新记录已写入且字段齐全

## 5. 影响范围与风险

- **影响范围**：仅 `video-analysis.service.ts` 一个文件；其他模块、前端、数据库 schema 不变
- **风险 1：MiniMax `purpose` 字段值**：若 MiniMax 不接受 `video`，需改为 `vision` 或 `file-extract`；通过首次调用 400 报错调整
- **风险 2：视频引用 URL 格式**：若 MiniMax 不支持 `${base}/files/${id}/content` 拼 URL，改为直接传 `file_id` 字符串或在 `video_url.url` 字段中试 `MiniMax://${fileId}` 等变体；通过首次 chat 调用 400 报错调整
- **风险 3：模型名**：若 `MiniMax-Text-01` 不可用或不支持视频，备选 `MiniMax-VL-01`
- **风险 4：response_format json_schema**：MiniMax 可能不完全支持 OpenAI 的 `json_schema` 模式；若报错 400，回退到在 prompt 里要求返回 JSON + 解析时正则提取 ```json``` 代码块
- **mock 兜底**保留，即使 MiniMax 全失败也不会导致前端报错

## 6. 验收标准

- `server/modules/video-analysis/video-analysis.service.ts` 内无 `KIMI`、`kimi`、`moonshot` 字样残留
- `grep -rn "KIMI" server/` 仅命中本文件的历史注释（修改后应为 0）
- 调用 `POST /api/video-analysis/analyze`（带已上传的视频 downloadUrl）：
  - 响应 200，返回的 `id` 在 `video_analyses` 表中可查到
  - 关联的 `video_shots` 记录条数与返回的 `shots.length` 一致
  - 日志中包含 "Uploaded to MiniMax" 与 "Analysis complete"
- 临时把 `MINIMAX_API_KEY` 置空再调用一次，应走 mock 分支，日志含 "using mock fallback"

## 7. 未决事项

- `MiniMax-Text-01` 是否为最终模型名：用户回答"minimax"较模糊，方案默认用 `MiniMax-Text-01`（MiniMax 当前支持视频的多模态模型），如用户指定其他模型再调整
- MiniMax `/files` 接口的 `purpose` 取值与 `video_url` 的 URL 拼接规则需在第一次实际调用时根据错误码微调；方案已列出 2 个备选方案
