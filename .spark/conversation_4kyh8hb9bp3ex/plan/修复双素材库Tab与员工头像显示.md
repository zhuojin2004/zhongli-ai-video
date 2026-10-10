# 修复 /materials 双素材库：员工人像 + 产品运动画面分离展示

## 1. 根因（已验证）

- `client/src/pages/MaterialLibraryPage/sections/MaterialFilterSection.tsx` 早就有"员工素材库 / 产品素材库"双 Tab + 搜索框（41 行完整可复用），但**父页面没 import**——属于历史重构遗漏
- `MaterialLibraryPage.tsx` 现在把 3 个员工素材（`STATIC_EMPLOYEE_MATERIALS`，含 `avatarUrl`）+ 产品素材（API 返回，含 `thumbnailUrl`）混在同一个 `allMaterials` 数组里用同一张卡片渲染，且页面标题被改成"素材中心"
- `MaterialGridSection.tsx:93` 卡片图片只读 `m.thumbnailUrl`，员工素材 `thumbnailUrl` 为空 → 只显示 Film 占位图标，员工人像不显示
- AGENTS.md 规范是「双素材库」+ 顶部 Tab 切换，当前实现不符合

## 2. 目标与成功标准

- 页面标题恢复为"双素材库"
- 顶部出现"员工素材库 / 产品素材库"两个 Tab
- 切到「员工素材库」Tab：显示 3 个员工卡片，展示人像圆形头像 + 姓名 + 人设标签 + 口播视频数
- 切到「产品素材库」Tab：显示产品卡片，展示产品缩略图 + 产品名称 + 卖点标签 + 分镜数
- "当前分镜视频个数 X 个" 计数跟随当前 Tab
- 搜索、左侧筛选、批量操作（仅作用于产品素材）继续工作
- 上传/导入 Excel 仍作用于产品库，不影响员工库

## 3. 关键实现文件

| 文件 | 改动 |
|---|---|
| `client/src/pages/MaterialLibraryPage/MaterialLibraryPage.tsx` | 引入 `MaterialFilterSection` + `Tabs/TabsList/TabsTrigger` 所需类型；新增 `activeTab` 状态；过滤逻辑加 `activeTab` 维度；页面标题"素材中心"→"双素材库"；当前页面自带的搜索框（405-414）改由 `MaterialFilterSection` 接管 |
| `client/src/pages/MaterialLibraryPage/sections/MaterialGridSection.tsx` | 卡片图片源：`m.avatarUrl \|\| m.thumbnailUrl`；员工卡片视觉差异化（圆形头像 + 居中布局 + 显示口播视频数）；员工卡片不显示"分镜数/行业"等不适用字段；产品卡片保持原样 |

## 4. 实现方案

### 4.1 MaterialLibraryPage.tsx 主页面

```tsx
const [activeTab, setActiveTab] = useState<'employee' | 'product'>('product')

// 在过滤管线最前面按 tab 过滤
const filtered = useMemo(() => {
  return allMaterials
    .filter((m) => m.type === activeTab)   // ← 新增：按 tab 类型过滤
    .filter(...)  // 保留原有 keyword/industry/client/department/categoryTags/quality/timeRange
    .sort(...)
}, [allMaterials, activeTab, keyword, ...其他依赖])
```

页面结构（修改后）：

```
页面标题：双素材库
副标题：管理员工人像素材与产品运动画面，支持多维筛选与批量操作

┌────────────────────────────────────────────────────────┐
│ FilterPanel (左栏)  │  [Tabs: 员工素材库 | 产品素材库]   │  + 搜索框
│  行业/客户/部门/    │ ────────────────────────────────── │
│  标签/质量/时间     │  [排序] [上传素材] [导入Excel]     │
│                    │  [拷贝] [批量加签] [批量删除]      │
│                    │ 当前分镜视频个数 N 个              │
│                    │ ┌──────┬──────┬──────┬──────┐      │
│                    │ │ 卡片 │ 卡片 │ 卡片 │ 卡片 │      │
│                    │ └──────┴──────┴──────┴──────┘      │
└────────────────────────────────────────────────────────┘
```

### 4.2 MaterialFilterSection 直接复用

无需改动。它已经实现：
- `activeTab: 'employee' | 'product'`
- `onTabChange: (tab) => void`
- `keyword / onKeywordChange`
- 搜索框 placeholder 随 tab 切换（"搜索员工姓名或标签" / "搜索产品名称或标签"）

### 4.3 MaterialGridSection 卡片差异化

```tsx
const isEmployee = m.type === 'employee'

// 图片源
const imageSrc = isEmployee ? m.avatarUrl : m.thumbnailUrl

// 卡片形态分支
{isEmployee ? (
  // 员工卡片：顶部圆形头像居中 + 姓名 + 人设标签 + 口播视频数
  <div className="p-4 flex flex-col items-center text-center">
    <div className="size-20 rounded-full overflow-hidden border-2 border-border bg-muted">
      {m.avatarUrl ? <Image src={m.avatarUrl} /> : <User icon />}
    </div>
    <div className="mt-2 font-medium text-sm">{m.employeeName}</div>
    <div className="mt-1 text-xs text-muted-foreground">
      <Mic className="inline size-3 mr-1" />口播视频 {m.oralVideoCount ?? 0} 个
    </div>
    <div className="mt-2 flex flex-wrap gap-1 justify-center">
      {(m.personaTags ?? []).slice(0, 3).map(t => <Badge>{t}</Badge>)}
    </div>
  </div>
) : (
  // 产品卡片：保持原样
  <div className="aspect-video bg-muted ...">
    <Image src={m.thumbnailUrl} />
  </div>
)}
```

## 5. 具体步骤

1. **MaterialLibraryPage.tsx**：
   - 顶部 import 区块加入 `import MaterialFilterSection from './sections/MaterialFilterSection'`
   - 新增 `const [activeTab, setActiveTab] = useState<'employee' | 'product'>('product')`
   - 移除原页面自带的 `Search` 图标 + `Input` 搜索框（行 405-414），改用 `<MaterialFilterSection activeTab={activeTab} onTabChange={setActiveTab} keyword={keyword} onKeywordChange={setKeyword} />`
   - 过滤 useMemo 第一步加 `.filter((m) => m.type === activeTab)`
   - useMemo 依赖数组加 `activeTab`
   - 标题 `<h1>素材中心</h1>` → `<h1>双素材库</h1>`
   - 副标题文字微调："管理所有素材，支持多维筛选、批量操作与素材调用" → "管理员工人像素材与产品运动画面，支持多维筛选与批量操作"

2. **MaterialGridSection.tsx**：
   - import `User` from lucide-react（员工卡片头像占位用）
   - import `Mic` from lucide-react（口播视频数图标）
   - 在 `materials.map((m) => {` 里加 `const isEmployee = m.type === 'employee'`
   - 当前根 `<Card>` 改为：员工用 flex-col 居中布局，产品用现有布局
   - 卡片图片源：`{imageSrc ? <Image src={imageSrc} ... /> : ...}`
   - 员工卡片不显示"分镜数"右上角 chip（行 107-110），改为显示"口播 X"
   - 员工卡片底部不显示 industry（多为空），只显示"使用 N 次 / 消耗 N"

## 6. 影响范围与风险

- **数据源不变**：`STATIC_EMPLOYEE_MATERIALS` 3 条 + API 返回的 product materials，合并逻辑不变
- **API 不变**：依然调 `listMaterials` 拿产品素材
- **批量操作兼容**：现有 `handleDelete` / `handleBatchAddTags` 已用 `id.startsWith('emp-')` 排除员工素材，逻辑自动适配
- **筛选联动**：左侧 `FilterPanel` 的 industry/client/department/quality 等字段，员工素材大多为空，自然被筛掉；用户切到员工 Tab 时看到的就是全部 3 个员工
- **风险点**：MaterialFilterSection 是孤儿组件直接复用，但其中 Tabs 组件需确认项目 ui 库有 Tabs/TabsList/TabsTrigger——从 `ClipWorkbenchPage.tsx` 已 import 过 `Tabs, TabsList, TabsTrigger, TabsContent` 来看，ui 库齐全

## 7. 验收标准

- [ ] `/materials` 页面标题为"双素材库"
- [ ] 顶部出现"员工素材库 / 产品素材库"两个 Tab
- [ ] 默认 Tab 为"产品素材库"（API 数据较多时优先展示真实数据）
- [ ] 员工 Tab：3 个员工卡片，头像为人像圆形图，姓名 + 人设标签 + "口播视频 N 个"
- [ ] 产品 Tab：产品卡片，缩略图 + 产品名称 + 卖点标签 + 分镜数
- [ ] 切换 Tab 时"当前分镜视频个数 N 个"统计跟随变化
- [ ] 切换 Tab 时搜索框 placeholder 切换（员工/产品）
- [ ] 员工素材不可删除（现有逻辑保留）
- [ ] 上传素材 / 导入 Excel 按钮仅在产品 Tab 可见（或操作仍指向产品库）
- [ ] Lint / TS 编译无新增 error
