# 引入 ffmpeg 开源能力做真实视频混剪

## 1. 目标与成功标准

- 现状：混剪走阿里百炼 `video-synthesis`（外部 API），无 key 或失败时退化为 mock（1.5-3.5s 后返回 `videoUrls[0]`，本质是占位）。分镜数据（startTime/endTime/narrationText）服务端未消费，仅写进 `clip_history.shot_ids` 备查
- 目标：引入 GitHub 开源视频处理能力（`ffmpeg-static` + `ffprobe-static` + `srt`），做**纯本地**的"分镜裁剪 + 拼接 + 字幕烧制"混剪，复用既有 `videoShots` 数据
- 成功标准：
  - `POST /api/video-editing/clip` 入参支持按分镜列表（`{ url, startTime, endTime, narrationText }[]`）调用，输出**新生成的**拼接视频 URL
  - 生成的视频包含所有分镜的旁白 SRT 字幕（`narrationText` 烧入画面底部）
  - FaaS 沙箱可运行：二进制静态链接、不依赖系统 ffmpeg；冷启动可接受 +1-3s
  - 既有 bailian/mock 路径保留（向后兼容：未传分镜时走原逻辑）

## 2. 调研结论（GitHub 开源方案选型）

| 候选 | 结论 |
|---|---|
| `ffmpeg-static` v5.3.0 | ✅ **采用**。自带静态链接 ffmpeg 二进制（~70MB 解压），免系统依赖，专为 FaaS 设计 |
| `ffprobe-static` v3.1.0 | ✅ **采用**。读取素材时长/分辨率/编码信息，构造 concat list 前必备 |
| `srt` v0.0.4 | ✅ **采用**。程序化拼装 SRT 字幕（时间轴 + 文本） |
| `fluent-ffmpeg` | ❌ 上游已弃（GitHub 标 readonly，~2 年未发版） |
| `editly` (mifi) | ❌ 半停滞，next 版不稳；不必要抽象层 |
| `remotion` | ❌ 4+ 人公司按 $0.01/render 付费，渲染需 Chrome ~300MB，FaaS 装不下 |
| `@ffmpeg/ffmpeg` (wasm) | ❌ 比原生慢 5-10×，FaaS 批量任务跑不动 |
| `node-av` | 🟡 备选，未来 TS 类型安全升级时再考虑 |

## 3. 关键实现文件

- `server/package.json` — 新增 `ffmpeg-static` / `ffprobe-static` / `srt`
- `nest-cli.json` — `assets` 增加 `ffmpeg-static` 与 `ffprobe-static` 二进制资源，发布后运行时可定位
- `server/modules/video-editing/video-editing.service.ts` — 新增 `clipWithFfmpeg` 本地合成方法（裁剪/拼接/字幕烧制/上传），并接入 `clipVideos` 主流程
- `server/modules/video-editing/video-editing.controller.ts` — 扩展 `ClipRequestBody`，增加 `shots?: ShotClipItem[]`
- `shared/api.interface.ts` — 新增 `ShotClipItem` 类型（含 `url`/`startTime`/`endTime`/`narrationText?`），加入 `ClipRequest`/`ClipResponse`（若当前未在 shared 中）

无需改动：UI 端、流水线状态机、clip_history 表

## 4. 实现方案

### 4.1 新增依赖（`server/package.json`）

```jsonc
"dependencies": {
  "ffmpeg-static": "^5.3.0",
  "ffprobe-static": "^3.1.0",
  "srt": "^0.0.4"
}
```

### 4.2 二进制资源打包（`nest-cli.json`）

`compilerOptions.assets` 新增：
```jsonc
{ "include": "./node_modules/ffmpeg-static/**/*", "outDir": "dist/server" },
{ "include": "./node_modules/ffprobe-static/**/*", "outDir": "dist/server" }
```
代码内通过 `path.join(__dirname, "../node_modules/ffmpeg-static/bin/.../ffmpeg")` 相对**编译产物**定位（dev 跑源码能命中，发布跑 `dist/` 同样能命中）

### 4.3 视频混剪核心方法（`server/modules/video-editing/video-editing.service.ts`）

新增私有方法 `clipWithFfmpeg(shots: ShotClipItem[]): Promise<ClipResponse>`，流程：

1. 创建临时工作目录 `/tmp/clip-<uuid>/`（已有编码指南 `/tmp` 规则）
2. **下载源视频**：`this.fileService.download(shot.url).asStream()` 写入 `source/<index>.mp4`（依赖现有 `FileService`，与打标模块同模式）
3. **逐分镜裁剪**：
   ```bash
   ffmpeg -y -ss {startTime} -i source/N.mp4 -t {endTime-startTime} -c:v libx264 -c:a aac cutN.mp4
   ```
   不用 `-c copy` 因为分镜边界需要精确到帧；H.264/AAC 通用兼容
4. **生成 SRT**：用 `srt` npm 包把 `narrationText` 按累计时长拼成多段字幕；字体用 `Noto Sans CJK SC`（中文混剪必备）
5. **拼接 + 烧字幕**：
   ```bash
   ffmpeg -y -f concat -safe 0 -i list.txt -vf "subtitles=subs.srt:force_style='FontName=Noto Sans CJK SC,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2'" -c:v libx264 -c:a aac -shortest out.mp4
   ```
6. **上传到 dataloom**：`this.fileService.upload(...)` 拿到 `downloadUrl`
7. **清理临时目录**：`fs.rm(workDir, { recursive: true, force: true })`（即使中途失败也清理，用 try/finally 兜底）
8. 返回 `{ videoUrl, duration }`

### 4.4 主流程集成（`clipVideos`）

```ts
if (dto.shots && dto.shots.length > 0) {
  try { return await this.clipWithFfmpeg(dto.shots) }
  catch (err) { log + fall through to bailian/mock }
}
// 原 bailian → mock 逻辑保留
```

### 4.5 扩展 DTO（`video-editing.controller.ts`）

```ts
interface ClipRequestBody {
  script: string
  videoUrls: string[]
  duration?: number
  shots?: ShotClipItem[]   // 新增；存在则走 ffmpeg 本地合成
}
```

## 5. 具体步骤

1. `package_manager install ffmpeg-static ffprobe-static srt`
2. 编辑 `nest-cli.json`，在 `compilerOptions.assets` 数组里追加两条 ffmpeg/ffprobe 资源声明
3. 编辑 `shared/api.interface.ts`，新增 `ShotClipItem` 类型（注意：先读文件确认位置与命名风格）
4. 编辑 `server/modules/video-editing/video-editing.controller.ts`，在 `ClipRequestBody` 加 `shots?: ShotClipItem[]`
5. 编辑 `server/modules/video-editing/video-editing.service.ts`：
   - 顶部 import `ffmpeg-static`、`ffprobe-static`、`srt`、`FileService`、`path`、`fs/promises`
   - 注入 `FileService`（与 `video-analysis.service.ts:47` 一致）
   - 新增 `clipWithFfmpeg` 私有方法（裁剪/拼接/字幕/上传/清理）
   - 修改 `clipVideos`：入参含 `shots` 时先尝试 ffmpeg，失败再走 bailian/mock
6. 提交代码 → devServer 自动重启
7. 用 `api_request POST /api/video-editing/clip` 测一次：body 含 2-3 个分镜（用现有 video_analyses 的 `videoUrl` + `videoShots` 的 startTime/endTime），验证返回 200 + 新 videoUrl
8. 检查 server 日志确认走的是 ffmpeg 路径（"clip with ffmpeg" 关键字）
9. 用数据库 `+db-execute` 查 `clip_history` 关联记录是否正确写入

## 6. 影响范围与风险

- **包体积**：`ffmpeg-static` ~70MB 解压/50MB 压缩，部署包膨胀；FaaS 冷启动 +1-3s
- **并发**：多请求并行会各起一个 ffmpeg 进程（默认单实例），CPU 密集；如需高并发后续加 BullMQ 队列
- **临时目录**：FaaS `/tmp` 跨请求隔离，单请求 `try/finally` 必须清理，避免磁盘膨胀
- **二进制定位**：`ffmpeg-static` 包路径含平台子目录（如 `bin/linux/x64/ffmpeg`），需用 `os.platform()` / `os.arch()` 选路径，或直接 `require('ffmpeg-static')` 拿字符串
- **SRT 字体**：FaaS 容器未必有 `Noto Sans CJK SC` 字体，烧字幕可能回退到默认字体；保守做法是用系统通用的 `WenQuanYi Zen Hei` 或 `DejaVu Sans`；先用 ffmpeg 自带默认，字体渲染异常再调整
- **音轨缺失**：部分分镜可能没有音轨，`-c:a aac` 会失败；用 `ffprobe` 探测后动态选 `-c:a copy` 或省略音频流
- **失败兜底**：ffmpeg 路径失败立即落回 bailian/mock，UI 端无感

## 7. 验收标准

- `grep -r "ffmpeg-static\|ffprobe-static\|srt" server/package.json` 命中
- `grep -c "ffmpeg-static" nest-cli.json` ≥ 1
- `POST /api/video-editing/clip` 带 shots 入参：响应 200 且 `videoUrl` 与任何入参 `shots[].url` 不同（证明是新生成的拼接视频）
- server 日志出现 `clip with ffmpeg` 关键字 + `Downloaded shot N`、`Concatenated N shots` 等步骤日志
- 临时目录 `/tmp/clip-*/` 在请求结束后被清理（`ls /tmp/clip-*` 为空）
- 旧 bailian/mock 路径仍可用：`POST /api/video-editing/clip` 不带 shots 时行为与改动前一致

## 8. 未决事项

- `shared/api.interface.ts` 是否已经有 `ClipRequest` / `ShotClipItem` 类型？方案默认要新增，但实现前需先读 `shared/api.interface.ts` 确认既有命名/位置
- ffmpeg 烧字幕字体：先用 ffmpeg 默认字体，渲染异常再切到 `WenQuanYi Zen Hei` 或 `Noto Sans CJK SC`（需验证 FaaS 镜像是否预装）
- `ffmpeg-static` 二进制路径在 dev/prod 一致性：先 `require('ffmpeg-static')` 拿绝对路径；只有在沙箱 dev/prod 不一致时才用 `path.join(__dirname, ...)`
