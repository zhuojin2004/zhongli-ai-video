## 目标与成功标准

在现有三端角色体系基础上，修复素材上传与素材库之间的数据断层：运营上传的视频素材应出现在素材库的「产品素材库」Tab 中。

成功标准：运营上传视频后，切换到素材库页面 → 产品素材库 Tab 下能看到新上传的素材卡片。

## 关键实现文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `client/src/data/materials.ts` | 修改 | 新增 `addProductMaterial` 和 `getMaterialsSnapshot` 函数，与 video-tags 模式一致 |
| `client/src/pages/MaterialUploadPage/MaterialUploadPage.tsx` | 修改 | 上传入库时同时调用 `addProductMaterial`，将视频素材写入素材库 store |
| `client/src/pages/MaterialLibraryPage/MaterialLibraryPage.tsx` | 修改 | 使用 `getMaterialsSnapshot` 替代 `MOCK_MATERIALS`，产品素材库 Tab 展示合并后的数据 |

## 实现方案

### 1. 改造 materials.ts 数据模块

参照 `video-tags.ts` 的运行时可变数组模式：
- 新增模块级变量 `runtimeMaterials`，初始值从 `MOCK_MATERIALS` 深拷贝
- 导出 `addProductMaterial(video)` 函数：将 VideoTagData 转换为 IMaterial（type='product'）并插入数组头部
- 导出 `getMaterialsSnapshot()` 函数：返回当前运行时素材列表

VideoTagData → IMaterial 转换规则：
- `type` = `'product'`
- `productName` = `video.productModel`
- `thumbnailUrl` = video.shots[0] 的 keyframePath（如有）
- `sceneVideoCount` = `video.shotCount`
- `sellingPointTags` = 从 video.shots 中提取所有 coreSellingPoint（去重前 5 个）
- `sceneVideoUrls` = video.shots 的 keyframePath 数组
- `id` = `video.videoFile`
- `createdAt` = 当前时间

### 2. 改造素材上传页

在 `handleUploadComplete` 中，调用 `addVideoTagData` 之后，同步调用 `addProductMaterial`：
```ts
import { addProductMaterial } from '@/data/materials'
// 入库后：
addProductMaterial(uploadedVideoData)
```

### 3. 改造素材库页面

将 `MOCK_MATERIALS` 替换为 `getMaterialsSnapshot()`：
```ts
import { getMaterialsSnapshot } from '@/data/materials'
const filtered = useMemo(() => {
  return getMaterialsSnapshot().filter((m) => { ... })
}, [activeTab, keyword])
```

## 具体步骤

1. 修改 `client/src/data/materials.ts`：添加 `runtimeMaterials`、`addProductMaterial`、`getMaterialsSnapshot`
2. 修改 `client/src/pages/MaterialUploadPage/MaterialUploadPage.tsx`：入库时调用 `addProductMaterial`
3. 修改 `client/src/pages/MaterialLibraryPage/MaterialLibraryPage.tsx`：使用 `getMaterialsSnapshot()` 替代 `MOCK_MATERIALS`
4. 检查代码并提交

## 影响范围与风险

- 仅影响素材库页面的数据读取方式，现有 MOCK_MATERIALS 数据保持不变
- 不影响其他页面（Dashboard、ProductionLine 等）
- 素材卡片展示逻辑不变，只是数据源从静态改为动态
- VideoTagData 到 IMaterial 的转换是单向的，不反写

## 验收标准

1. 运营上传视频后，切换到素材库 → 产品素材库 Tab，新素材出现在卡片网格中
2. 产品名称、卖点标签、场景视频数正确显示
3. 员工素材库 Tab 不受影响，仍展示原有 mock 数据
4. 搜索和筛选功能对新素材生效
5. 无 TS 报错