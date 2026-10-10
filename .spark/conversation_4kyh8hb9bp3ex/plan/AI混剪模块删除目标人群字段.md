# 移除 AI 混剪"目标人群"字段

## 1. 目标与成功标准

- AI 混剪页面（`/clip-workbench`）的"目标人群"下拉选择字段整体移除
- 该字段相关的状态、Props 双向绑定、requirement 文本拼接、插件参数 `salesperson_persona` 全部清理
- 提交历史时 `requirement` 字段不再拼接"目标人群：xxx"
- 其他字段（产品名称/类型/卖点/时长/口播风格/拍摄要求）保持不变

## 2. 关键实现文件

| 文件 | 改动 |
|---|---|
| `client/src/pages/ClipWorkbenchPage/RequirementInput.tsx` | 移除"目标人群"Select UI（69-85）、组件 Props `targetAudience/onTargetAudienceChange`（26-27, 42-43, 71-72）；保留其他字段 |
| `client/src/pages/ClipWorkbenchPage/ClipWorkbenchPage.tsx` | 移除 `targetAudience` state（39 行）、向 RequirementInput 传参（273-274 行）、脚本生成调用中 `salesperson_persona` 参数（116 行）、`requirement` 文本拼接"目标人群"片段（104 行）、保存历史时 `requirement` 文本拼接"目标人群"片段（约 220-228） |

## 3. 关键事实（已验证）

- "目标人群"是 Select 下拉，选项：年轻白领/家庭用户/商务人士/户外爱好者/科技爱好者
- `targetAudience` 不作为独立字段入库（`shared/api.interface.ts` 中 `CreateClipHistoryDto` 无 audience 字段；`clip_history` 表无 audience 列）
- 现有两处使用：
  1. 拼入 `requirement` 文本，提交到 clip_history
  2. 作为 `salesperson_persona` 参数传给脚本生成插件
- 移除该字段后，这两处使用都会失效，需要一并清理

## 4. 实现方案

### 4.1 RequirementInput.tsx 清理
- 删除 Props 接口中的 `targetAudience: string` 与 `onTargetAudienceChange: (v: string) => void`
- 删除组件形参解构中的对应两项
- 删除"目标人群"Select UI 整段（行 69-85，含 Label + Select + SelectContent/Item）
- 保留其他字段：产品名称、产品类型、核心卖点、视频时长、口播风格、拍摄要求

### 4.2 ClipWorkbenchPage.tsx 清理
- 删除 `const [targetAudience, setTargetAudience] = useState('')` 状态声明
- 删除 `<RequirementInput>` 上的 `targetAudience={targetAudience}` 与 `onTargetAudienceChange={setTargetAudience}` 传参
- 脚本生成调用：
  - 移除 `requirement` 文本中 `${targetAudience ? \`目标人群：${targetAudience}，\` : ''}` 拼接片段（或对应判断）
  - 移除插件调用参数中的 `salesperson_persona: targetAudience` 字段
- 保存历史调用：移除 `requirement` 文本中"目标人群"相关拼接片段

## 5. 具体步骤

1. 编辑 `client/src/pages/ClipWorkbenchPage/RequirementInput.tsx`：
   - 从 `RequirementInputProps` 删 `targetAudience` / `onTargetAudienceChange`
   - 从形参解构删两项
   - 删"目标人群"对应的 Label + Select 块
2. 编辑 `client/src/pages/ClipWorkbenchPage/ClipWorkbenchPage.tsx`：
   - 删 `targetAudience` 状态
   - 删 RequirementInput 上的两个 prop
   - 删 requirement 拼接中"目标人群"片段（约 1-2 处）
   - 删插件调用中 `salesperson_persona` 字段
3. 检查 Lint / TS 编译，确认无残留引用

## 6. 影响范围与风险

- **无后端改动**：`targetAudience` 原本就不入库、不传 DTO 独立字段
- **无数据库改动**：`clip_history` 表无 audience 列
- **AI 生成内容变化**：脚本生成插件不再收到 `salesperson_persona`，生成的脚本可能风格略有不同
- **历史数据不受影响**：旧数据 `requirement` 文本里仍含"目标人群：xxx"，列表展示仍可见——这是预期行为，不动

## 7. 验收标准

- [ ] `/clip-workbench` 页表单中"目标人群"标签和下拉选择已消失
- [ ] 表单其他 6 个字段（产品名称/产品类型/核心卖点/视频时长/口播风格/拍摄要求）保留且可正常使用
- [ ] 点击"生成脚本"按钮，AI 插件调用参数中不含 `salesperson_persona` 字段
- [ ] 生成的 requirement 文本（提交历史的）不含"目标人群"字样
- [ ] TS 编译无 error
- [ ] Lint 无 unused 变量（targetAudience 引用应全部清零）
