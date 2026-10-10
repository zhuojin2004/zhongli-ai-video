## 目标与成功标准

运营上传视频后，系统自动调用 Kimi API 对视频进行分镜分析，生成真实的分镜标签数据（ShotTag[]），并自动入库到素材库。替换当前"空 shots 数组 + 随机标签"的 mock 模拟。

成功标准：上传一个视频 → 等待分析完成 → 素材库中出现带真实分镜标签的素材卡片，标签来源于 Kimi 对视频内容的理解。

## 关键实现文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/modules/video-analysis/video-analysis.module.ts` | 新建 | NestJS 模块 |
| `server/modules/video-analysis/video-analysis.controller.ts` | 新建 | `POST /api/video/analyze` 接口 |
| `server/modules/video-analysis/video-analysis.service.ts` | 新建 | 调用 Kimi API 分析视频 |
| `server/app.module.ts` | 修改 | 注册 VideoAnalysisModule |
| `shared/api.interface.ts` | 修改 | 新增请求/响应类型 |
| `client/src/api/index.ts` | 修改 | 新增前端 API 调用 |
| `client/src/pages/MaterialUploadPage/MaterialUploadPage.tsx` | 修改 | 替换 mock 为真实 API 调用 |

## 实现方案

### 1. 安全存储 Kimi API Key

使用 Connections SDK（`@lark-apaas/miaoda-connections-sdk`）创建凭证 `kimi-api-key`，存储用户提供的 API Key。后端通过 `ConnectionsService` 读取。

### 2. 后端视频分析模块

**流程**：
1. 前端上传视频到 dataloom → 拿到 file_path
2. 前端调用 `POST /api/video/analyze`，传入 `{ filePath: string, bucketId: string }`
3. 后端通过 FileService 下载视频文件到 `/tmp`
4. 后端调用 Kimi Files API 上传视频 → 获得 `file_id`
5. 后端调用 Kimi Chat API，传入 `file_id` + 分镜分析 prompt + JSON Schema
6. Kimi 返回结构化 JSON（shots 数组，含 startTime/endTime/description/scene/objects/action/camera/coreSellingPoint/narrationText 等）
7. 后端解析响应，返回 `VideoTagData` 给前端
8. 前端调用 `addVideoTagData` + `addProductMaterial` 入库

**JSON Schema 输出格式**（传给 Kimi）：
```json
{
  "type": "json_schema",
  "json_schema": {
    "name": "video_shot_analysis",
    "schema": {
      "type": "object",
      "properties": {
        "productModel": { "type": "string", "description": "识别到的产品型号" },
        "shots": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "startTime": { "type": "number", "description": "起始秒数" },
              "endTime": { "type": "number", "description": "结束秒数" },
              "description": { "type": "string", "description": "画面描述" },
              "scene": { "type": "string", "description": "场景" },
              "objects": { "type": "string", "description": "画面中物体" },
              "action": { "type": "string", "description": "动作" },
              "camera": { "type": "string", "description": "镜头语言" },
              "coreSellingPoint": { "type": "string", "description": "核心卖点" },
              "narrationText": { "type": "string", "description": "建议旁白" }
            },
            "required": ["startTime", "endTime", "description", "scene", "coreSellingPoint"]
          }
        }
      },
      "required": ["shots"]
    }
  }
}
```

### 3. 前端改造

MaterialUploadPage 的 `startProcessing` 函数改造：
- 去掉 mock setTimeout 模拟
- 改为调用 `POST /api/video/analyze`
- 显示真实分析进度（上传中 → 分析中 → 完成）
- 分析完成后获得真实 `VideoTagData`（含 shots 数组），调用 `addVideoTagData` + `addProductMaterial`

## 具体步骤

1. **创建 Kimi API Key 凭证**：使用 `lark-cli apps +connection-create` 创建 `kimi-api-key` 凭证
2. **创建 shared 类型**：在 `shared/api.interface.ts` 中新增 `AnalyzeVideoRequest` 和 `AnalyzeVideoResponse` 类型
3. **创建后端模块**：`server/modules/video-analysis/`，含 module/controller/service
4. **注册模块**：在 `server/app.module.ts` 中注册 VideoAnalysisModule
5. **创建前端 API**：在 `client/src/api/video-analysis.ts` 中封装 API 调用
6. **改造上传页**：替换 MaterialUploadPage 的 mock 逻辑为真实 API 调用
7. **测试验证**：上传视频 → 确认 Kimi 分析结果 → 确认素材库入库

## 影响范围与风险

- 新增后端模块，不影响现有 production/workflow 模块
- 前端仅改造 MaterialUploadPage 的处理逻辑，不影响其他页面
- Kimi API 调用耗时较长（视频分析可能需要 30 秒 ~ 2 分钟），需要适当的 loading 状态和超时处理
- API Key 消费：每次视频分析会消耗 Kimi API tokens
- 大视频文件（>100MB）需要前端压缩或分段处理

## 验收标准

1. 上传视频后，后端成功调用 Kimi API 并返回结构化分镜数据
2. 前端展示真实的分镜数量、标签（非随机 mock）
3. 分镜数据包含 startTime/endTime/description/scene/coreSellingPoint 等关键字段
4. 素材库中新增素材的 sellingPointTags 来自 Kimi 分析结果（非「新素材」兜底）
5. 处理失败时有明确的错误提示
6. 无 TS 报错，类型检查通过