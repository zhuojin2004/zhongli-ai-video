import type { Plugin, UserConfig } from 'vite'
import { defineConfig } from '@lark-apaas/coding-preset-vite-react'

// ────────────────────────────────────────────────────────────────────────────
// 品牌定制：把平台预设 og-meta 注入的 <title>{{appName}}</title> / og / favicon
// 占位符替换为「AI 短视频运营」。
//
// 触发链路：
//   1. coding-preset-vite-react 的 og-meta plugin 会把任意 <title>...</title>
//      强制替换成 <title>{{appName}}</title>
//   2. 部署运行时（vefaas / miaoda app pack）会把 {{appName}} 替换成「妙搭」
//   3. 因此直接改 index.html 不够 —— 必须在 og-meta 之后**再覆盖一次**，
//      把 {{appName}} / {{appDescription}} / {{appAvatar}} 在 title / og /
//      favicon 上改成我们自己的品牌
//
// 实现：enforce:'post' 的 transformIndexHtml hook，最后一次写死品牌信息。
// ────────────────────────────────────────────────────────────────────────────

const BRAND_NAME = 'AI短视频运营'
const BRAND_DESCRIPTION = `${BRAND_NAME} - 智能分镜 + 标签 + 一键运营素材库`
// 内联 SVG favicon：纯蓝底白播放键，无外链资源
const BRAND_FAVICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
       <rect width="32" height="32" rx="6" fill="#1f6feb"/>
       <path d="M11 9v14l12-7z" fill="#fff"/>
     </svg>`,
  )

function brandOverridePlugin(): Plugin {
  return {
    name: 'brand-override',
    enforce: 'post',
    transformIndexHtml(html) {
      let out = html
      // 1) <title> —— 不留任何 {{appName}} 残留
      out = out.replace(
        /<title>[^<]*<\/title>/gi,
        `<title>${BRAND_NAME}</title>`,
      )
      // 2) og:title
      out = out.replace(
        /(<meta\s+[^>]*property=["']og:title["'][^>]*content=["'])[^"']*(["'][^>]*>)/gi,
        `$1${BRAND_NAME}$2`,
      )
      // 3) og:description
      out = out.replace(
        /(<meta\s+[^>]*property=["']og:description["'][^>]*content=["'])[^"']*(["'][^>]*>)/gi,
        `$1${BRAND_DESCRIPTION}$2`,
      )
      // 4) og:image —— 换成我们的 favicon（避免引用 Miaoda 的 logo URL）
      out = out.replace(
        /(<meta\s+[^>]*property=["']og:image["'][^>]*content=["'])[^"']*(["'][^>]*>)/gi,
        `$1${BRAND_FAVICON}$2`,
      )
      // 5) <meta name="description">
      out = out.replace(
        /(<meta\s+[^>]*name=["']description["'][^>]*content=["'])[^"']*(["'][^>]*>)/gi,
        `$1${BRAND_DESCRIPTION}$2`,
      )
      // 6) favicon —— 替换所有 rel="icon" / rel="shortcut icon" 的 href
      out = out.replace(
        /(<link\s+[^>]*rel=["']?(?:icon|shortcut icon)["']?[^>]*href=["'])[^"']*(["'][^>]*>)/gi,
        `$1${BRAND_FAVICON}$2`,
      )
      // 7) window._appInfo / window.appInfo.name —— JS 内部用的 brand 信息
      //    （如果有组件读 window._appInfo.name 展示品牌，要一并改掉）
      out = out.replace(
        /(window\._appInfo\s*=\s*\{[\s\S]*?name:\s*["'])[^"']*(["'])/,
        `$1${BRAND_NAME}$2`,
      )
      out = out.replace(
        /(const\s+appInfo\s*=\s*\{[\s\S]*?name:\s*["'])[^"']*(["'])/,
        `$1${BRAND_NAME}$2`,
      )
      out = out.replace(
        /(const\s+appInfo\s*=\s*\{[\s\S]*?description:\s*["'])[^"']*(["'])/,
        `$1${BRAND_DESCRIPTION}$2`,
      )
      out = out.replace(
        /(const\s+appInfo\s*=\s*\{[\s\S]*?avatar:\s*["'])[^"']*(["'])/,
        `$1${BRAND_FAVICON}$2`,
      )
      return out
    },
  }
}

// Clear preset's proxy and set our own /api → localhost:9099
// AI 分析链路（抽帧 + OSS + MiniMax-M3 + 飞书写入）实测 60-180s，
// 这里把 proxy timeout 拉到 10 分钟，避免 Vite / node 默认的 2 分钟切断长请求。

// 静态演示版（GitHub Pages）：资源路径需要带仓库名子目录
const isStaticDemo = process.env.VITE_STATIC_DEMO === 'true'

export default defineConfig({
  // 部署到 https://zhuojin2004.github.io/zhongli-ai-video/ 时，
  // 所有静态资源前缀必须是 /zhongli-ai-video/
  base: isStaticDemo ? '/zhongli-ai-video/' : '/',
  plugins: [brandOverridePlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9099',
        changeOrigin: true,
        logLevel: 'silent' as const,
        timeout: 600000,
      },
    },
  },
  build: {
    outDir: 'dist',
    // 视频数据 JSON 约 1.5MB，放宽 chunk 警告
    chunkSizeWarningLimit: 2000,
  },
} as UserConfig)