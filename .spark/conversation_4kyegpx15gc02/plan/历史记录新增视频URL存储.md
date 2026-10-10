## 目标与成功标准

工作流完成 AI 生成后，历史记录中完整保存四个阶段的产物：脚本、关键帧、语音、视频 URL。用户点击「查看详情」时能看到视频链接。

## 根因

`workflow_runs` 数据库表缺少 `video_url` 字段，`CreateWorkflowRunDto` 和 `WorkflowRun` 类型也没有 `videoUrl`，导致保存历史记录时视频 URL 被丢弃。

## 关键实现文件

- 数据库 `workflow_runs` 表 — 新增 `video_url` 列
- `server/database/schema.ts` — DDL 后自动重新生成
- `shared/api.interface.ts` — `WorkflowRun` 和 `CreateWorkflowRunDto` 新增 `videoUrl: string`
- `server/modules/workflow/workflow.service.ts` — `dbToApi` 和 `create` 方法增加 `videoUrl` 字段映射
- `client/src/pages/ProductionLinePage/sections/WorkflowSection.tsx` — `createRun` 调用增加 `videoUrl: task.videoUrl || ''`

## 具体步骤

1. **DDL**：`ALTER TABLE workflow_runs ADD COLUMN video_url varchar(500)`，然后 `code_gen` 重新生成 schema
2. **共享类型**：`WorkflowRun` 和 `CreateWorkflowRunDto` 各加 `videoUrl: string` 字段
3. **后端 Service**：`dbToApi` 返回 `videoUrl`，`create` 写入 `videoUrl`
4. **前端保存**：`createRun` 入参增加 `videoUrl: task.videoUrl || ''`
5. **API 测试**：POST 一条含 videoUrl 的测试记录，GET 验证回显正确，DELETE 清理

## 验收标准

1. 完成一次 AI 生成 → 历史记录中 `videoUrl` 有值（匹配的产品视频 URL）
2. GET `/api/workflow/runs` 返回的记录包含 `videoUrl` 字段