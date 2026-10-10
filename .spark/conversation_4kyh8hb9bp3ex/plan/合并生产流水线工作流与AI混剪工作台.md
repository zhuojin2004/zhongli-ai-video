# 合并生产流水线"工作流"与 AI 混剪工作台

## 1. 目标与成功标准

- **统一入口**：所有 AI 视频生成需求 → `/clip-workbench`（已在侧边栏 `AI 混剪`）
- **生产流水线页面** `/production` 移除"工作流" Tab，只保留看板
- **批量能力**：在 `/clip-workbench` 增加"批量模式"开关，开启后可选多销售员循环生成
- **舍弃关键帧**：不再调用 `product_image_generator_1` 插件，不再生成关键帧
- **历史合并**：所有产物写入 `clip_history`；`workflow_runs` 表保留但前端不再写入
- 用户在 `/clip-workbench` 单条模式下保持当前交互（生成脚本→分镜匹配→手动选候选→混剪）
- 用户在 `/clip-workbench` 批量模式下，选员工+产品→一键循环生成，结果列表展示每位员工的脚本与视频

## 2. 关键实现文件

| 文件 | 改动 |
|---|---|
| `client/src/pages/ClipWorkbenchPage/ClipWorkbenchPage.tsx` | 主页面：新增 `mode` 切换、批量状态、批量进度、批量结果；单条模式保留；批量模式新增循环生成逻辑 |
| `client/src/pages/ClipWorkbenchPage/ModeSwitcher.tsx`（新增） | 顶部 Tab 切换"单条生成 / 批量生成" |
| `client/src/pages/ClipWorkbenchPage/BatchEmployeeSelect.tsx`（新增） | 员工多选卡片列表（仿 WorkflowSection 的 `Card` 列表样式） |
| `client/src/pages/ClipWorkbenchPage/BatchProgressList.tsx`（新增） | 批量生成进度与结果列表（每行一个员工，显示脚本预览/视频） |
| `client/src/pages/ClipWorkbenchPage/RequirementInput.tsx` | 适配批量模式：员工区条件渲染在 RequirementInput 内或外置，依拆分后行数决定 |
| `client/src/pages/ProductionLinePage/ProductionLinePage.tsx` | 移除 `Workflow` Tab 与 `WorkflowSection` 引用 |
| `client/src/pages/ProductionLinePage/sections/ProductionHeaderSection.tsx` | "新建生产任务"按钮改为 `navigate('/clip-workbench')`（移除原 Dialog） |
| `client/src/pages/ProductionLinePage/sections/WorkflowSection.tsx` | 整文件删除 |
| `client/src/api/clip-history/index.ts` | `createClipHistory` 支持 `employeeName/employeeId` 入参；`listClipHistory` 返回值带这两个字段 |
| `client/src/api/workflow/index.ts` | 保留文件（后端接口存在），前端不再 import；亦可删除 |
| `client/src/api/production/index.ts` | 批量模式结果落看板时调 `createTask` |
| `shared/api.interface.ts` | `ClipHistoryItem` / `CreateClipHistoryDto` 添加 `employeeName?: string` / `employeeId?: string` |
| `server/modules/clip-history/*` | service/dto 支持新字段 |
| 数据库 DDL | `ALTER TABLE clip_history ADD COLUMN employee_name varchar(100), ADD COLUMN employee_id varchar(100)` |

## 3. 实现方案

### 3.1 ClipWorkbenchPage 顶层结构

```tsx
const [mode, setMode] = useState<'single' | 'batch'>('single')

// 批量模式专属
const [employees, setEmployees] = useState<IMaterial[]>([])
const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([])
const [batchProgress, setBatchProgress] = useState({
  current: 0, total: 0, employeeName: '', stage: '' 
})
const [batchResults, setBatchResults] = useState<BatchResult[]>([])

// 单条模式专属
const [script, setScript] = useState('')
const [matchedShots, setMatchedShots] = useState<...>([])
const [selectedCandidates, setSelectedCandidates] = useState<Map<number, number>>(new Map())
const [videoUrl, setVideoUrl] = useState('')
```

页面布局：

```
┌──────────────────────────────────────────────┐
│ ModeSwitcher:  [单条生成] [批量生成]          │
├──────────────────────────────────────────────┤
│ 【单条模式】                                  │
│   RequirementInput（5 字段）                  │
│   [生成脚本] → [分镜匹配] → 选候选 → [混剪]  │
│   HistoryPanel                                │
├──────────────────────────────────────────────┤
│ 【批量模式】                                  │
│   RequirementInput（5 字段，禁用员工无关项）  │
│   BatchEmployeeSelect（员工多选）             │
│   [一键批量生成]                              │
│   BatchProgressList（每位员工一行：脚本/视频）│
└──────────────────────────────────────────────┘
```

### 3.2 批量模式核心逻辑

```tsx
const handleBatchGenerate = async () => {
  if (!productName.trim() || selectedEmployeeIds.length === 0) {
    toast.error('请填写产品名称并至少选择一位销售员')
    return
  }
  setIsBatchGenerating(true)
  setBatchResults([])

  const targetDuration = parseInt(duration, 10)
  const requirement = buildRequirement(productName, scenario, coreSellingPoint, videoContent, targetDuration)

  for (let i = 0; i < selectedEmployeeIds.length; i++) {
    const employee = employees.find(e => e.id === selectedEmployeeIds[i])
    if (!employee) continue
    setBatchProgress({ current: i + 1, total: selectedEmployeeIds.length, employeeName: employee.employeeName || '', stage: '脚本生成' })

    try {
      // 1. 脚本生成（带员工人设）
      const script = await callScriptPlugin({
        product_info: requirement,
        salesperson_persona: employee.personaTags?.join('、') || '专业严谨',
      })
      if (!script) continue

      setBatchProgress(prev => ({ ...prev, stage: '分镜匹配' }))
      const { data: matchData } = await axiosForBackend({
        url: '/api/video-editing/match-shots',
        method: 'POST',
        data: { script, topK: 3 },
      })

      setBatchProgress(prev => ({ ...prev, stage: '混剪中' }))
      const selected = matchData.segments.map(seg => seg.candidates[0]?.id).filter(Boolean)
      const { data: clipData } = await axiosForBackend({
        url: '/api/video-editing/clip',
        method: 'POST',
        data: { script, shotIds: selected, duration: targetDuration },
      })

      // 2. 落库
      await createClipHistory({
        title: `${productName} - ${employee.employeeName}`,
        requirement,
        duration: targetDuration,
        scriptContent: script,
        videoUrl: clipData.videoUrl,
        shotIds: selected,
        employeeName: employee.employeeName,
        employeeId: employee.id,
      })

      // 3. 推看板
      await productionApi.createTask({
        title: `${productName} - ${employee.employeeName}`,
        productName,
        assignee: employee.employeeName || '未知',
        assigneeType: 'subsidiary',
        scriptContent: script,
        videoUrl: clipData.videoUrl,
        status: 'clipping_done',
      })

      setBatchResults(prev => [...prev, {
        employeeId: employee.id,
        employeeName: employee.employeeName,
        script: script.slice(0, 80) + '...',
        videoUrl: clipData.videoUrl,
        status: 'success',
      }])
    } catch (err) {
      setBatchResults(prev => [...prev, {
        employeeId: employee.id, employeeName: employee.employeeName,
        status: 'failed', error: err instanceof Error ? err.message : String(err),
      }])
    }
  }

  setBatchProgress({ current: 0, total: 0, employeeName: '', stage: '' })
  setIsBatchGenerating(false)
  toast.success(`批量生成完毕：${batchResults.filter(r => r.status === 'success').length}/${selectedEmployeeIds.length}`)
}
```

### 3.3 BatchEmployeeSelect 组件

复用 WorkflowSection 中员工列表的 Card 形态（`Card > Checkbox + Avatar + 姓名 + 人设 tag + 口播数`），但去掉"选择生成模式"那段无关内容。Props：`employees: IMaterial[]` `selectedIds: string[]` `onChange: (ids: string[]) => void` `disabled: boolean`

### 3.4 路由与页面清理

- `/production` 页面只保留看板 Tab；删除 Tabs 组件与 `WorkflowSection` 引用；删除文件
- `ProductionHeaderSection` 的"新建生产任务"按钮改为 `useNavigate()('/clip-workbench')` 跳转；删除内部 Dialog 逻辑
- `/clip-workbench` 路由保留（已在 `app.tsx` 注册 + 侧边栏 "AI 混剪" 入口）

### 3.5 数据库

```sql
ALTER TABLE clip_history 
  ADD COLUMN employee_name varchar(100),
  ADD COLUMN employee_id varchar(100);
```

字段均为可空（单条模式无员工信息时不填）。

### 3.6 共享类型（shared/api.interface.ts）

```typescript
export interface ClipHistoryItem {
  // ... 现有字段
  employeeName?: string
  employeeId?: string
}

export interface CreateClipHistoryDto {
  // ... 现有字段
  employeeName?: string
  employeeId?: string
}
```

### 3.7 后端 clip-history 模块

- DTO 添加 `IsOptional` 的 `employeeName` / `employeeId` 字段
- service 的 create / list 都映射新字段
- 不动 `workflow_runs` 相关代码（保留兼容历史数据）

## 4. 具体步骤

1. **数据库 DDL**：执行 `ALTER TABLE clip_history ADD COLUMN employee_name varchar(100), ADD COLUMN employee_id varchar(100)`（通过数据库操作 skill 的执行通道），系统自动 codegen
2. **shared/api.interface.ts**：给 `ClipHistoryItem` / `CreateClipHistoryDto` 加 `employeeName?` / `employeeId?`
3. **后端 clip-history module**：DTO + service 支持新字段
4. **client/src/api/clip-history/index.ts**：传 employeeName/employeeId
5. **新增 ModeSwitcher.tsx**：单条/批量 Tab 切换
6. **新增 BatchEmployeeSelect.tsx**：员工多选卡片
7. **新增 BatchProgressList.tsx**：结果列表
8. **改造 ClipWorkbenchPage.tsx**：
   - 新增 mode / 批量状态
   - mode === 'single'：保持现状
   - mode === 'batch'：渲染 BatchEmployeeSelect + 批量按钮 + BatchProgressList
   - 批量时调用 productionApi.createTask 推看板
9. **ProductionLinePage.tsx**：删除 Tabs + Workflow Section 相关代码
10. **删除** `client/src/pages/ProductionLinePage/sections/WorkflowSection.tsx`
11. **ProductionHeaderSection.tsx**：替换 Dialog 为 `navigate('/clip-workbench')`
12. **清理** workflow 引用：`client/src/api/workflow/index.ts` 文件保留（不删），如有其他引用则移除
13. **commit**

## 5. 影响范围与风险

- **`/production` 简化**：移除工作流 Tab 后只剩看板（单 Tab 页面），更聚焦
- **侧边栏不变**：`AI 混剪` 入口已在 `AppSidebar.tsx:32` 存在
- **历史数据兼容**：`workflow_runs` 表数据保留可读；前端不再写入；后端接口保留
- **批量模式 UX 简化**：不暴露手动选候选（自动选每段 top-1），放弃部分可干预性换取效率
- **生产任务看板接入**：批量模式生成后自动 push 到 `production_tasks`（`status='clipping_done'`），看板会自动出现
- **关键帧资源浪费**：`product_image_generator_1` 插件在批量流程中不再被调用；之前生成的 `keyframeUrls` 数据保留在 `workflow_runs` 不动
- **风险点 1**：批量循环中任一员工失败不应阻塞其他人（已 try/catch 单员工）
- **风险点 2**：批量模式下 SCRIPT_PLUGIN_ID 调用频率高（每员工一次），AI 配额与速率需关注
- **风险点 3**：单条模式下的"手动选候选"交互如果用户想批量场景下也手动选，初期不提供；如确有必要可在 `BatchProgressList` 的行上加"查看/编辑"按钮

## 6. 验收标准

- [ ] `/production` 页面只剩看板（无 Tab 切换），无"工作流"入口
- [ ] `ProductionLinePage.tsx` 已移除 `Workflow` import 与 Tabs 组件
- [ ] `WorkflowSection.tsx` 文件已删除
- [ ] `/clip-workbench` 页面顶部出现"单条生成 / 批量生成"切换
- [ ] 切到批量模式：出现员工多选卡片列表（Checkbox + 头像 + 姓名 + 人设 tag + 口播数）
- [ ] 勾选员工 + 填产品信息 → 点击"批量生成" → 实时显示 `当前 N/M：员工名 - 阶段名`
- [ ] 每位员工完成后，`BatchProgressList` 出现新行：员工名 + 脚本摘要 + 视频链接 + 成功/失败状态
- [ ] 批量完成后，`clip_history` 表新增对应记录（含 employee_name/employee_id）
- [ ] 批量完成后，`production_tasks` 表新增对应记录（看板可见）
- [ ] 切回单条模式：原 5 字段 + 3 步交互完全保留
- [ ] 旧 `workflow_runs` 数据仍可读（不影响）
- [ ] 数据库新增两列成功（codegen 后 schema.ts 含 employeeName/Id）
- [ ] TS 编译无新 error；旧 WorkflowSection 引用清零
