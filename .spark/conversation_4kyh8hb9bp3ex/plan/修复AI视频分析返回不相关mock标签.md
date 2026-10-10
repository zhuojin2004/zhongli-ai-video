## 目标与成功标准
- 用户上传视频后，AI 分析返回的分镜标签与实际视频内容匹配
- 不再出现"上传叉车视频，标签却是搬运车/堆高车等完全不相关视频的标签"的情况

## 根因分析
后端 `server/modules/video-analysis/video-analysis.service.ts:36-71` 的 `analyze()` 方法：
- 先尝试用 Kimi API 做真实视频分析
- 当 `KIMI_API_KEY` 环境变量未配置时（当前沙箱环境），**回退到 `mockAnalyze()`**
- `mockAnalyze()` 从 `server/modules/video-analysis/mock-data.ts` 的 3 个预置 mock 视频中**随机选一个**，返回其标签
- 这 3 个 mock 视频（EPT20-20ETC / FE3R12N / ICE301B）的标签与用户上传的视频完全无关

## 关键实现文件
- `server/modules/video-analysis/video-analysis.service.ts:36-103` — analyze 方法和 mockAnalyze 回退逻辑
- `server/modules/video-analysis/mock-data.ts` — 3 个预置 mock 视频的标签数据

## 实现方案

### 方案：配置 Kimi API Key 启用真实分析
1. 通过 `lark-cli apps +env-set` 配置 `KIMI_API_KEY` 环境变量
2. 配置后，后端会走真实分析流程：下载视频 → 上传到 Kimi → Kimi 逐帧分析分镜 → 返回结构化标签
3. Kimi 的 prompt 已经写好（`video-analysis.service.ts:144-177`），会分析视频画面内容、场景、物体、动作、镜头语言、核心卖点等
4. Kimi 分析失败时仍会回退 mock，但这是合理的兜底而非默认行为

## 具体步骤
1. 确认用户有 Kimi API Key（Moonshot 平台）
2. 调用 `lark-cli apps +env-set --app-id "$app_id" --key KIMI_API_KEY --value <key>` 设置环境变量
3. 用户重新上传视频验证：分析结果应与视频内容匹配（不再随机返回不相关视频的标签）
4. 如果 Kimi 调用失败（额度/网络），日志会显示错误并回退 mock，需确认错误原因

## 影响范围与风险
- 仅影响 `/api/video/analyze` 接口的行为
- 配置 API Key 后，每次上传视频会调用 Kimi API，可能产生费用
- Kimi 视频分析需要一定时间（几十秒到几分钟），用户等待时间会变长

## 验收标准
1. 配置 KIMI_API_KEY 后，上传一个视频
2. 分析完成后，在素材库弹窗中查看分镜标签，标签内容应与视频画面一致（场景、物体、动作等描述匹配）
3. 上传不同视频，标签应随之变化，不再固定返回 EPT20-20ETC / FE3R12N / ICE301B 的标签

## 未决事项
- 用户是否有 Kimi (Moonshot) API Key？如果没有，需要先到 https://platform.moonshot.cn 注册获取