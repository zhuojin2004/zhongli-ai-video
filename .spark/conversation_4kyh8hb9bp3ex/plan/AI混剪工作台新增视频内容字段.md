# AI 混剪工作台新增"视频内容"字段（Textarea，多行文本）

## 1. 目标与成功标准

- 在 AI 混剪页面（`/clip-workbench`）表单中，"核心卖点"字段之后插入"视频内容"字段
- 字段类型为多行文本（Textarea），与"使用场景"风格一致（rows=3，相同 spacing）
- 字段内容参与 AI 脚本生成，与"场景""核心卖点"同样拼入 requirement 提示词
- 提交历史时该字段随 `requirement` 一并保存到 clip_history
- 其他字段（产品名称/使用场景/核心卖点/目标时长）保持不变
- 不改数据库、不改 DTO、不改后端（与之前"目标人群"同款设计：仅作为前端 prompt 构造输入）

## 2. 关键实现文件

| 文件 | 改动 |
|---|---|
| `client/src/pages/ClipWorkbenchPage/RequirementInput.tsx` | Props 新增 `videoContent: string` 与 `onVideoContentChange: (v: string) => void`；形参解构同步加入；在"核心卖点"和"目标时长"之间插入 Textarea UI |
| `client/src/pages/ClipWorkbenchPage/ClipWorkbenchPage.tsx` | 新增 `videoContent` 状态；`<RequirementInput>` 传 `videoContent` / `setVideoContent`；requirement 数组追加 `videoContent ? \`视频内容：${videoContent}\` : ''`；`handleGenerate` 与"等待重新生成"流程的依赖数组加入 `videoContent` |

## 3. 字段位置与样式

```
产品名称（Input）
使用场景（Textarea，rows=3）
核心卖点（Input）
视频内容（Textarea，rows=3）   ← 新增
目标时长（RadioGroup）
[一键生成混剪]
```

UI 形态（与"使用场景"一致，仅 placeholder 不同）：

```tsx
<div className="space-y-1.5">
  <label className="text-sm font-medium text-foreground">视频内容</label>
  <Textarea
    value={videoContent}
    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
      onVideoContentChange(e.target.value)
    }
    placeholder="描述视频要传达的内容/主题，如：突出底盘调校与越野性能、对比同级竞品、强调家庭出行安全..."
    rows={3}
    disabled={generating}
  />
</div>
```

## 4. AI 提示词拼接

按"有则拼接、空则跳过"的方式，与"场景""核心卖点"同样处理（`requirement` 数组 + `.filter(Boolean).join('，')`）：

```ts
const requirement = [
  `产品：${productName}`,
  scenario ? `场景：${scenario}` : '',
  coreSellingPoint ? `核心卖点：${coreSellingPoint}` : '',
  videoContent ? `视频内容：${videoContent}` : '',   // 新增
  `严格要求：脚本总时长必须控制在 ${targetDuration} 秒左右，总字数约 ${targetWordCount} 字（语速按每秒 ${SPEAKING_RATE} 字计算），请严格控制字数`,
]
  .filter(Boolean)
  .join('，')
```

## 5. 具体步骤

1. **RequirementInput.tsx**：
   - `RequirementInputProps` 新增 `videoContent: string` / `onVideoContentChange: (v: string) => void`
   - 形参解构中加 `videoContent, onVideoContentChange`
   - 在"核心卖点"div 后、"目标时长"div 前，插入新的"视频内容"div（见上方代码块）
2. **ClipWorkbenchPage.tsx**：
   - 紧接 `coreSellingPoint` 状态后加 `const [videoContent, setVideoContent] = useState('')`
   - `<RequirementInput>` 上加 `videoContent={videoContent} onVideoContentChange={setVideoContent}`
   - requirement 数组中加 `videoContent ? \`视频内容：${videoContent}\` : ''`
   - `handleGenerate` 依赖数组 `[productName, scenario, coreSellingPoint, duration]` → `[productName, scenario, coreSellingPoint, videoContent, duration]`
   - `createClipHistory` 的 `requirement` 拼接同步加 `视频内容：${videoContent || ''}`，与其他字段同样处理

## 6. 影响范围与风险

- **无后端改动**：与"目标人群"一致，不入 DTO 独立字段，仅作为前端 prompt 构造
- **无数据库改动**：`clip_history.requirement` 仍是 text 字段，附加"视频内容：xxx"即可
- **AI 脚本生成效果变化**：插件会收到更明确的内容指引（与"使用场景""核心卖点"互补），生成脚本的内容贴合度可能提升
- **历史数据不受影响**：旧数据的 `requirement` 文本里无"视频内容：xxx"，新生成数据才有——预期行为

## 7. 验收标准

- [ ] `/clip-workbench` 表单在"核心卖点"下方、"目标时长"上方出现"视频内容"多行文本框
- [ ] placeholder 提示用户描述视频要传达的内容/主题
- [ ] 输入内容后生成脚本，AI 插件收到的 `product_info` 文本含"视频内容：xxx"片段
- [ ] 提交历史时 `requirement` 字段含"视频内容：xxx"片段
- [ ] 不填视频内容时，requirement 文本与改造前一致（`.filter(Boolean)` 自动剔除空字符串）
- [ ] TS 编译无 error；`videoContent` 引用全部清零（或与本次新增一致）
- [ ] `useCallback` 依赖数组补齐，无 lint/react-hooks/exhaustive-deps 报错

## 8. 未决事项

无。字段形态、位置、是否喂 AI 均已确认。
