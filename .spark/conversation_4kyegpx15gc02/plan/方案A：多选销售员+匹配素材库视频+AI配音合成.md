## 目标与成功标准

1. 销售员从单选改为多选，勾选多个销售员后一键批量生成，每个销售员独立走完整流水线并各自进入看板
2. 视频合成阶段改为匹配产品素材库中的场景视频 + 叠加 AI 语音
3. 用户提供的 3 个真实叉车视频文件（1.mp4 / 2.mp4 / 3.mp4）作为产品素材库的场景视频

## 关键实现文件

- `public/videos/` — 新建目录，存放 3 个用户上传的 mp4 视频
- `src/data/materials.ts` — `IMaterial` 新增 `sceneVideoUrls: string[]`，3 个产品各填入对应视频路径
- `src/pages/ProductionLinePage/sections/WorkflowSection.tsx` — 单选改多选 + 产品匹配 + 视频合成改为素材库视频+配音
- `src/pages/ProductionLinePage/sections/PipelineBoardSection.tsx` — 任务卡片 `videoUrl` 不为空时展示视频播放器

## 实现方案

### 1. 视频文件安置

将附件中的 3 个 mp4 复制到 `public/videos/`，文件命名保持原始或按产品重命名。运行时通过 `/videos/1.mp4` 等路径直接访问。

### 2. 视频→产品映射（待用户确认）

默认按顺序映射，用户可调整：
| 视频文件 | 默认映射产品 |
|---------|------------|
| 1.mp4 | 中力 E-TRUCK 电动平衡重叉车（3.5吨） |
| 2.mp4 | 中力 E-STACKER 电动堆高车（2吨） |
| 3.mp4 | 中力 E-PALLET 电动搬运车（1.5吨） |

### 3. 数据模型扩展

`IMaterial` 新增 `sceneVideoUrls?: string[]`，3 个产品 mock 数据各填入对应视频路径（如 `['/videos/1.mp4']`）。

### 4. 销售员多选

- 将 `Select` 下拉单选替换为 `Checkbox` 列表 + 已选标签展示
- 状态从 `selectedEmployeeId: string` 改为 `selectedEmployeeIds: string[]`
- 至少勾选 1 人才能生成

### 5. 产品选择新增

- 新增产品下拉选择（从 `MOCK_MATERIALS` 筛选 `type === 'product'`）
- 选择产品后自动填充产品名称到描述框，同时记录 `sceneVideoUrls`
- 手动输入产品描述时，不匹配产品视频（走关键帧轮播兜底）

### 6. 批量生成流水线

每个销售员独立走 4 阶段：
- ① 脚本生成（每人独立 prompt，人设不同）
- ② 关键帧生成（按脚本段落动态生成）
- ③ 语音合成（每人独立语音）
- ④ 视频合成：匹配到产品视频 → 取真实视频 URL + 音频；未匹配 → 关键帧轮播兜底

每个销售员完成后立即创建任务加入看板。

### 7. 看板视频展示

`PipelineBoardSection` 详情弹窗中，`videoUrl` 不为空时展示 `<video>` 播放器。

## 具体步骤

1. 将 3 个 mp4 从 attachments 复制到 `public/videos/`
2. 修改 `materials.ts`：`IMaterial` 加 `sceneVideoUrls?: string[]`，3 个产品各填对应视频路径
3. 重构 `WorkflowSection.tsx`：
   - 销售员卡片：`Select` → `Checkbox` 多选列表
   - 新增产品选择卡片
   - `handleGenerate`：循环 `selectedEmployeeIds`，每个员工独立走 4 阶段
   - 阶段④：有产品视频 URL → 直接使用；无 → 关键帧轮播兜底
4. 修改 `PipelineBoardSection.tsx`：详情弹窗中 `videoUrl` 不为空时渲染 `<video controls>` 标签

## 影响范围与风险

- 批量生成时间 = 单人时间 × 人数，需在 UI 显示进度
- 视频文件目前各产品只有 1 个，后续可追加更多

## 验收标准

1. 销售员卡片显示 3 人复选框列表，可多选
2. 新增产品选择卡片，选择产品后自动填充描述
3. 勾选 2 位销售员 + 选择产品 → 生成 → 两张任务卡片进入看板
4. 任务详情弹窗中视频区域展示 `<video>` 播放器，播放真实叉车视频
5. 不选产品、手动输入描述时，视频合成走关键帧轮播兜底

## 未决事项

- 3 个视频与 3 款叉车产品的对应关系，默认 1.mp4→E-TRUCK / 2.mp4→E-STACKER / 3.mp4→E-PALLET，请确认是否需要调整