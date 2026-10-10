## 目标与成功标准

删除 Header 中两个不需要的元素：
1. 右上角通知铃铛图标（含未读角标 "3"）
2. 中间「冲刺目标剩余 2600 台」胶囊（销售数据，与之前删除销售模块的方向一致）

## 关键实现文件

- `src/components/Header.tsx` — 删除 Bell 图标 + Badge 按钮，删除冲刺目标胶囊

## 实现方案

Header 右侧区域（`flex items-center gap-3`）当前包含冲刺胶囊和铃铛按钮，两者一并删除后，右侧为空。左侧保留 SidebarTrigger 和系统标题。

## 具体步骤

1. 删除 `import { Bell }` 和 `import { Badge }` 行（如无其他引用）
2. 删除冲刺目标胶囊 `<div className="hidden md:flex items-center...">` 整个 JSX 块
3. 删除铃铛按钮 `<Button variant="ghost" size="icon" className="relative">` 整个 JSX 块
4. 右侧 `flex items-center gap-3` 容器可保留空壳或删除，视布局需要

## 影响范围与风险

- 仅影响 Header 组件，不影响页面内容
- 如果系统中其他页面使用了 Header 中的铃铛通知，一并移除

## 验收标准

1. Header 右上角不再显示铃铛通知图标
2. Header 中部不再显示冲刺目标胶囊
3. Header 左侧标题和 SidebarTrigger 正常显示