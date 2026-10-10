## 目标与成功标准

员工在生产流水线中提交 AI 视频任务后，任务推进到「已审核」环节时可触发 AI 自动打标，打标完成后分镜标签数据自动同步到分镜标签查看器中，实现从「任务提交 → AI 打标 → 分镜查看」的完整闭环。

成功标准：
- 生产流水线看板中「已审核」列的任务卡片出现「AI 打标」按钮
- 点击「AI 打标」后，模拟 AI 生成分镜标签（基于产品名称和脚本内容），任务状态自动推进到「已打标」
- 分镜标签查看器中自动出现该视频及其分镜数据，无需手动刷新

## 关键实现文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `client/src/data/video-tags.ts` | 修改 | 新增 `addVideoTagData()` 和 `getVideoTagsSnapshot()` 函数，支持运行时动态追加视频分镜数据 |
| `client/src/data/production.ts` | 修改 | 新增 `generateMockShotTags()` 函数，根据产品名称和脚本内容生成模拟分镜标签 |
| `client/src/pages/ProductionLinePage/sections/PipelineBoardSection.tsx` | 修改 | 「已审核」列任务卡片增加「AI 打标」按钮，点击后调用打标逻辑并推进状态 |
| `client/src/pages/VideoTagViewerPage/VideoTagViewerPage.tsx` | 修改 | 使用 `getVideoTagsSnapshot()` 替代直接导入 `MOCK_VIDEO_TAGS`，支持动态数据 |

## 实现方案

### 数据架构

在 `video-tags.ts` 中维护一个模块级可变数组 `runtimeVideoTags`，初始值为 `MOCK_VIDEO_TAGS` 的深拷贝：

```typescript
let runtimeVideoTags: VideoTagData[] = JSON.parse(JSON.stringify(MOCK_VIDEO_TAGS));

export function addVideoTagData(video: VideoTagData) {
  runtimeVideoTags = [video, ...runtimeVideoTags];
}

export function getVideoTagsSnapshot(): VideoTagData[] {
  return runtimeVideoTags;
}
```

分镜标签查看器从 `getVideoTagsSnapshot()` 读取数据，而非直接导入 `MOCK_VIDEO_TAGS`。

### AI 打标模拟

在 `production.ts` 中新增 `generateMockShotTags(productName, scriptContent)` 函数：

```
输入：产品名称（如"EXP15"）、脚本内容文本
输出：VideoTagData 对象，包含 3-8 个模拟分镜

生成逻辑：
- 根据脚本内容按句号/换行分段，每段生成一个分镜
- 每个分镜自动填充：shotId、startTime、endTime、duration、description、productModel、scene、objects、action、camera、coreSellingPoint 等字段
- 总时长按分镜数 × 5s 估算
- videoUrl 暂为空（提示用户需在混剪完成后关联）
```

### 流水线改造

在 `PipelineBoardSection.tsx` 中：
- 「已审核」列任务卡片增加「AI 打标」按钮（蓝色 primary 样式）
- 点击后执行：
  1. 调用 `generateMockShotTags()` 生成分镜标签
  2. 调用 `addVideoTagData()` 将数据追加到全局 store
  3. 调用 `onTaskUpdate(taskId, '已打标')` 推进任务状态
  4. 显示成功提示

## 具体步骤

1. **改造 video-tags.ts**：添加模块级可变数组 + `addVideoTagData()` + `getVideoTagsSnapshot()`
2. **新增打标模拟函数**：在 `production.ts` 中实现 `generateMockShotTags()`，根据产品名称和脚本内容生成合理的分镜标签
3. **改造 PipelineBoardSection**：「已审核」列增加「AI 打标」按钮，串联打标→追加数据→推进状态
4. **改造 VideoTagViewerPage**：使用 `getVideoTagsSnapshot()` 替代 `MOCK_VIDEO_TAGS`，确保新增数据可见
5. **检查代码并提交**

## 影响范围与风险

- `video-tags.ts` 从纯静态数据变为模块级可变状态，但初始值不变，已有分镜标签查看器的增删改功能不受影响
- 新增视频的 `videoUrl` 为空，分镜标签查看器会显示"尚未关联视频文件"提示，后续混剪完成后可关联
- 刷新页面后运行时追加的数据会丢失（模块级状态不持久化），符合 prototype-app 定位
- 不影响生产流水线现有 7 环节状态流转逻辑

## 验收标准

1. 进入生产流水线页面，选择一个「已审核」状态的任务，卡片上出现「AI 打标」按钮
2. 点击「AI 打标」→ 短暂加载后任务卡片移至「已打标」列
3. 切换到分镜标签查看器（`/video-tags`），下拉菜单中出现新视频
4. 选择该视频，时间轴展示 3-8 个分镜色块，标签面板显示画面描述、场景、动作等字段
5. 刷新页面后，AI 打标生成的数据恢复为初始 mock 数据（20 个视频）