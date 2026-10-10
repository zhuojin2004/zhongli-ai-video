## 目标与成功标准

把生产流水线的「工作流」Tab 从 mock 模拟升级为真实 AI 驱动：输入产品信息 + 选择销售员，AI 自动生成口播脚本、产品图片、语音合成，最终组合成可用的视频素材包。

## 关键实现文件

- `src/pages/ProductionLinePage/sections/WorkflowSection.tsx` — 重写为真实 AI 调用流程，替换 mock 模拟
- `src/pages/ProductionLinePage/ProductionLinePage.tsx` — 可能需要微调状态传递
- 新增插件实例（需在实现阶段通过 `plugin_instance` 工具创建）：
  - `ai-text-generate` 实例：用于脚本生成
  - `ai-text-to-image` 实例：用于产品图生成
  - `ai-speech-synthesis` 实例：用于语音合成

## 实现方案

### 工作流 AI 流水线（4 阶段，全部真实调用）

**输入**：产品名称/描述 + 选择销售员（带人设标签）

**阶段 ① 脚本生成**（`ai-text-generate`，流式）：
- 根据产品信息 + 销售员人设标签拼接 prompt
- 流式输出脚本内容，实时渲染为 Markdown
- 产物：完整口播脚本

**阶段 ② 产品图生成**（`ai-text-to-image`，非流式）：
- 根据产品描述生成 2-3 张产品展示图
- 展示 loading + 生成完成后展示图片网格
- 产物：产品图片 URL 数组

**阶段 ③ 语音合成**（`ai-speech-synthesis`，轮询）：
- 将生成的脚本转为语音
- 展示处理进度
- 产物：音频 URL

**阶段 ④ 素材包输出**：
- 汇总脚本 + 产品图 + 语音，展示为「视频素材包」
- 提供下载/复制脚本/发布到素材库按钮
- 产物自动加入看板「已混剪」列

### 辅助功能

- 保留「从已有任务选脚本」的快捷入口
- 每阶段展示独立 loading 和完成状态
- 任一阶段失败展示错误提示，支持重试

## 具体步骤

1. **创建 3 个插件实例**：通过 `plugin_instance` 工具分别创建 ai-text-generate、ai-text-to-image、ai-speech-synthesis 实例
2. **重写 WorkflowSection**：用 `capabilityClient.load(id).callStream()` 调用脚本生成，`capabilityClient.load(id).call()` 调用图片生成和语音合成
3. **流式渲染脚本**：用 `react-markdown` + `remark-gfm` 渲染实时生成的脚本
4. **阶段间串联**：脚本生成完毕 → 自动触发图片生成；图片生成完毕 → 自动触发语音合成
5. **产物汇总**：4 阶段完成后展示素材包卡片，支持下载/发布操作

## 影响范围与风险

- 仅影响生产流水线「工作流」Tab，看板 Tab 不受影响
- 需要 3 个插件实例，创建后才能调用
- 插件调用有延迟（图片生成 5-15s，语音合成需轮询），需做好 loading 状态
- 语音合成限制 3000 字，长脚本需截断

## 验收标准

1. 工作流中输入产品名 + 选择销售员后点击「生成 AI 视频」
2. 阶段 ① 脚本以流式 Markdown 实时渲染
3. 阶段 ② 生成 2-3 张产品图，以网格展示
4. 阶段 ③ 生成语音并提供播放按钮
5. 阶段 ④ 汇总展示素材包，可下载/发布
6. 任一阶段失败显示错误提示，可重试
7. 最终产物自动加入看板「已混剪」列