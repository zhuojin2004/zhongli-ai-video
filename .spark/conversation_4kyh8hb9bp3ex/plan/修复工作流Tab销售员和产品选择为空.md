# 修复：生产流水线-工作流 Tab 销售员/产品选择为空

## 1. 目标与成功标准

- 用户在 `/production` → 「工作流」Tab 能看到销售员列表并勾选
- 「选择产品」下拉有可选项，不是空的
- 素材库页面和工作流页面看到的销售员/产品数据一致（同源）
- 用户自己上传的员工素材换电脑也能看到（不落 localStorage）

## 2. 根因（已验证）

- `WorkflowSection.tsx:88-95` 调 `/api/materials`，然后 `data.filter(m => m.type === 'employee' || m.type === 'product')`
- 后端 `MaterialItem`（`shared/api.interface.ts:299-314`）**没有 `type` 字段**
- 后端 `materials.service.ts:22-37` 只从 `video_analyses` 表查，**这张表也没有 `type` 列**（schema.ts 确认）
- → 每条记录的 `m.type` 都是 `undefined` → 过滤后 `employees` 和 `products` 都是空数组
- 截图里只有"全选/取消全选"没有任何人，就是这个原因

**关于"你把我之前的销售员删了吗"**：没有删。之前能看到的销售员是 `client/src/data/materials.ts` 里的 `STATIC_MATERIALS`（3 个员工 mock），素材库页面同时引用了静态数据 + API，所以能看到；但工作流页面**只打 API、不用静态数据**，所以一直是空的——不是我删了，是这页从来就没接过真实数据源。

## 3. 关键实现文件

| 文件 | 改动 |
|---|---|
| `server/database/schema.ts` | `video_analyses` 表新增 `type varchar(20)` 列（employee/product） |
| `shared/api.interface.ts` | `MaterialItem` 加 `type: 'employee' | 'product'` 字段 |
| `server/modules/materials/materials.service.ts` | `dbToApi` 映射 `type`；list 默认不过滤 type；create/upload 时写入 type |
| `client/src/pages/ProductionLinePage/sections/WorkflowSection.tsx` | 仍按 type 过滤，但此时后端有值了；再加 loading 态避免白屏误解 |
| `client/src/pages/MaterialLibraryPage/MaterialLibraryPage.tsx` | 员工上传时调后端 API 落库，不再写 localStorage |
| `client/src/data/materials.ts` | 废弃 `STORAGE_KEY` / `md_materials` 读写逻辑（保留只读 fallback，不删） |
| `client/src/api/materials.ts` | 确认 `createMaterial / uploadMaterial` 接口存在且传 `type` |

## 4. 实现方案

### 4.1 数据库：`video_analyses` 加 `type` 列

- 列名：`type`，类型 `varchar(20)`，非空，默认 `'product'`
- 已有数据全部回填为 `'product'`（因为历史上这张表存的都是产品视频分析结果）
- 执行通道：按数据库 skill 的 `+db-execute` 跑 `ALTER TABLE video_analyses ADD COLUMN type varchar(20) NOT NULL DEFAULT 'product';`
- 执行后 codegen 自动更新 `schema.ts`

### 4.2 后端：MaterialsService 支持 type

- `shared/api.interface.ts` 的 `MaterialItem` 加 `type: 'employee' | 'product'`
- `materials.service.ts` 的 `dbToApi` 补 `type: row.type ?? 'product'`
- list 接口不过滤 type，全部返回；由前端按页面需求自行过滤
- create / import / upload 接口新增 `type` 参数（可选，默认 'product'）
- `video_analyses` 的 insert/update 里写入 `type` 字段

### 4.3 示例员工数据落库（一次性 seed）

- 当前 `STATIC_MATERIALS` 里 3 个员工示例是纯前端 mock，后端没有
- 为了让工作流页面一进来就有可选的销售员，把这 3 条示例员工数据插入 `video_analyses` 表，`type = 'employee'`
- 只在表中没有 `type='employee'` 记录时才 seed（幂等）
- 字段映射：`employeeName → videoName`、`avatarUrl → videoUrl`（占位）、`personaTags → category_tags`、`oralVideoCount → shot_count` 等，缺失字段填默认值

### 4.4 前端：员工上传从 localStorage 切到后端

- 素材库页的员工素材上传流程：
  - 上传文件到 dataloom（不动，现有逻辑）
  - 拿到下载 URL 后调 `POST /api/materials` 落库，带 `type: 'employee'` + `employeeName` + `personaTags` 等字段
  - 成功后刷新列表，不再写 `localStorage.setItem('md_materials', ...)`
- `client/src/data/materials.ts` 的 `loadUserMaterials / saveUserMaterials` 保留但**不再写入**，仅作为老数据迁移读取用（第一次打开时把 localStorage 里的存量调 API 同步到后端，然后清掉 localStorage）
- `WorkflowSection.tsx` 的 `useEffect` 里已经在调 `/api/materials`，过滤逻辑不变，后端补齐 type 后自然有数据

### 4.5 前端：工作流页面加空态与加载态

- 销售员卡片加载中显示骨架，避免用户以为"全选/取消全选下面是空白 = bug"
- 加载完成但确实为空时，显示"暂无销售员素材，请到素材库上传"引导文案
- 产品选择 Select 同理

## 5. 具体步骤

**Step 1 — 数据库加列 + seed**
- 调 `lark-cli apps +db-execute` 执行 `ALTER TABLE video_analyses ADD COLUMN type varchar(20) NOT NULL DEFAULT 'product';`
- 等 codegen 刷新 `schema.ts`
- 在 `MaterialsService.onModuleInit` 或一个独立 seed 脚本里，检查 `type='employee'` 记录数，为 0 则插入 3 条示例员工

**Step 2 — 后端类型与接口更新**
- `shared/api.interface.ts`：`MaterialItem` 加 `type`
- `materials.service.ts`：`dbToApi` 补 `type`；list 全量返回；create 接口接受 `type` 参数
- `materials.controller.ts`：确认 create/update DTO 支持 `type`

**Step 3 — 前端素材上传改走后端**
- `MaterialLibraryPage.tsx` 上传成功后调 `createMaterial({ type: 'employee', ... })` 而非写 localStorage
- 加一次 localStorage → 后端的迁移逻辑（首次进入素材库时执行一次）

**Step 4 — 前端工作流页面体验优化**
- `WorkflowSection.tsx` 给销售员列表加 loading / 空态
- 确认 `IMaterial` 类型和 `MaterialItem` 对齐（`type` 字段名一致）

## 6. 影响范围与风险

- **素材库页面**：员工和产品素材都会从 API 返回，不再依赖 localStorage；换电脑/清缓存后数据仍在
- **分镜标签查看器**：`video_analyses` 表加列不影响现有查询
- **视频分析接口**：新上传的视频需明确传 `type`，不传默认 'product'，兼容老逻辑
- **数据迁移**：localStorage 里的存量员工素材会被一次性同步到后端，不会丢失
- **回滚**：如果出问题，前端可以临时回退到 `STATIC_MATERIALS + localStorage` 的旧逻辑，数据不会丢

## 7. 验收标准

- [ ] `/production` → 工作流 Tab → 「选择销售员」卡片至少有 3 个示例员工（张磊/李婷/王芳 或对应姓名）
- [ ] 「选择产品」下拉至少有 3 个产品可选项
- [ ] 在素材库上传一个新的员工视频 → 工作流页面刷新后能看到这个新员工
- [ ] 换一台电脑 / 清浏览器缓存 / 隐身窗口打开 → 销售员和产品数据仍在
- [ ] 素材库页面的员工素材和工作流页面的销售员列表数量一致（同源）
- [ ] `/api/materials` 接口返回的每条记录都有 `type` 字段，值为 `employee` 或 `product`

## 8. 未决事项

无。所有技术决策均已给出，拿到方案即可执行。
