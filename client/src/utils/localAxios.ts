/**
 * 本地 axios 实例，替代 @lark-apaas/client-toolkit/utils/getAxiosForBackend
 * 所有请求通过 Vite proxy 转发到 localhost:9099 mock server
 */
import axios from 'axios'
import { installStaticDemo } from '@/static-demo'

// 创建 axios 实例，baseURL 为 /（通过 Vite proxy 转发）
// ⚠️ 上传链路耗时：本地写文件 1-5s + OSS 上传 1-3 分钟 + 飞书写主表 3-5s + AI 分析 0-180s
//    实测 22MB 视频普遍需要 90-180s，30MB+ 经常超过 5 分钟导致 axios timeout → 用户看到 Network Error
//    + 任务从「待上传」tab 消失（status: waiting → error），误以为"页面刷新"
// 修复：timeout 调到 10 分钟（与 analyzeAxios / clipAxios 一致），避免误杀大文件上传
const localAxios = axios.create({
  baseURL: '/',
  timeout: 600000,
})

// 响应拦截器：axios 返回 {config, data, status, ...}
// 外层 data = mock server 的 {data: ...}，直接返回内层 data
localAxios.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.message || error.message || '请求失败'
    console.error(`[API Error] ${error.config?.method?.toUpperCase()} ${error.config?.url}`, message)
    return Promise.reject(new Error(message))
  },
)

/**
 * AI 分析专用 axios 实例（独立超时）
 *
 * AI 分析全链路耗时（mockApiServer.js analyzeWithMiniMaxFrames）：
 *   1. FFmpeg 抽帧 3-8 张           5-15s
 *   2. 顺序上传帧到阿里云 OSS        10-30s
 *   3. MiniMax-M3 多模态识别        30-120+s   ← 瓶颈
 *   4. 飞书批量写分镜                5-15s
 * 实测 60-86MB 视频普遍需要 60-180s，旧 60s timeout 会在第 3 步被打断。
 * 这里给到 10 分钟冗余，避免误杀长分析任务。
 */
const analyzeAxios = axios.create({
  baseURL: '/',
  timeout: 600000, // 10 分钟
})
analyzeAxios.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.message || error.message || 'AI 分析失败'
    console.error(`[API Error] ${error.config?.method?.toUpperCase()} ${error.config?.url}`, message)
    return Promise.reject(new Error(message))
  },
)

/**
 * 混剪合成专用 axios 实例（独立超时）
 *
 * /api/video-editing/clip 链路耗时：
 *   1. 下载 OSS 源视频                3-15s（取决于视频大小）
 *   2. FFmpeg 多段剪切 + 字幕         5-20s
 *   3. 豆包 TTS 配音（经常失败）       1-5s
 *   4. OSS 上传剪辑结果               5-20s
 *   5. 飞书写入新生成视频表            2-5s
 * 实测 2-4 个分镜普遍需要 20-60s，多分镜或大视频可达 90-120s。
 * 旧 60s timeout 会在第 4-5 步被打断，导致「点了合成没反应」的现象。
 * 这里给到 10 分钟冗余，匹配 analyzeAxios。
 */
const clipAxios = axios.create({
  baseURL: '/',
  timeout: 600000, // 10 分钟
})
clipAxios.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.message || error.message || '混剪失败'
    console.error(`[API Error] ${error.config?.method?.toUpperCase()} ${error.config?.url}`, message)
    return Promise.reject(new Error(message))
  },
)

// 静态演示构建（VITE_STATIC_DEMO=true）：所有 axios 请求改由本地 mock 数据响应，
// 无需后端，可直接部署到 GitHub Pages 等纯静态托管。
if (import.meta.env.VITE_STATIC_DEMO === 'true') {
  installStaticDemo(localAxios)
  installStaticDemo(analyzeAxios)
  installStaticDemo(clipAxios)
}

export { localAxios, analyzeAxios, clipAxios }
