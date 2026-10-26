/**
 * 批量把 HEVC(H.265) 视频转码为浏览器兼容的 H.264，并上传到 OSS 的 transcoded/ 路径。
 *
 * 背景：约 47% 的原始视频是手机录制的 HEVC Main10，Chromium 内核浏览器
 * （Chrome / Edge / 微信内置浏览器 / 安卓）无法播放，只有 Safari 能硬解。
 * 转成 H.264(yuv420p) 后所有浏览器可播。
 *
 * 用法：
 *   node client/vite/transcode-hevc-batch.mjs [并发数] [起始行] [数量]
 *   node client/vite/transcode-hevc-batch.mjs 2        # 全量，2 并发
 *   node client/vite/transcode-hevc-batch.mjs 1 0 3    # 先跑前 3 个验证
 *
 * 输出映射：/tmp/hevc-transcode-map.json  { 原始URL: 转码URL }
 * 断点续跑：已完成的视频会自动跳过。
 */
import dotenv from 'dotenv'
import https from 'node:https'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import OSS from 'ali-oss'
import mediaPipeline from './media-pipeline.js'

const require = createRequire(import.meta.url)
const urllib = require('urllib')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const { transcodeToMp4 } = mediaPipeline

const CONCURRENCY = Number(process.argv[2] || 2)
const START = Number(process.argv[3] || 0)
const LIMIT = Number(process.argv[4] || 0) // 0 = 全部
const MAX_RETRY = 2

const allUrls = readFileSync('/tmp/hevc-urls.txt', 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean)
const urls = LIMIT ? allUrls.slice(START, START + LIMIT) : allUrls.slice(START)

const MAP_FILE = '/tmp/hevc-transcode-map.json'
const map = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) : {}

/**
 * 自定义 urllib：覆盖每个请求的超时。
 * ali-oss 默认把数字 timeout 同时作为 connect 和 response 超时（10 分钟），
 * 热点网络下连接表面 ESTABLISHED 但实际不传输（僵死），要等 10 分钟才报错。
 * 这里改成 [connect=10s, response=45s]：
 * 连接建立后，无论是发送请求体还是等待响应头，45s 无进展就 abort，
 * 让上层（分片重试）快速换连接。
 */
const customUrllib = {
  request(url, params) {
    const p = { ...params, timeout: [10000, 45000] }
    return urllib.request(url, p)
  },
}

function createHttpsAgent() {
  return new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 15000,
    maxSockets: 16,
    maxFreeSockets: 4,
  })
}

function createClient() {
  return new OSS({
    accessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET,
    bucket: process.env.ALI_OSS_BUCKET,
    region: process.env.ALI_OSS_REGION,
    timeout: 600000,
    secure: true,
    httpsAgent: createHttpsAgent(),
    urllib: customUrllib,
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 上传文件：自己实现分片，每片独立超时+重试，避免僵死连接拖垮整个文件 */
async function uploadFile(client, key, file) {
  const info = await stat(file)
  const headers = { 'x-oss-object-acl': 'public-read' }
  const PART = 3 * 1024 * 1024
  const total = Math.ceil(info.size / PART)

  // 小文件直接 put（独立超时）
  if (total <= 1) {
    return withTimeout(client.put(key, file, { headers }), 60000, 'put')
  }

  const buf = await readFile(file)
  const init = await withTimeout(
    client.initMultipartUpload(key, { headers }), 30000, 'initMultipart',
  )
  const uploadId = init.uploadId || init.res?.uploadId
  const parts = []
  try {
    for (let p = 1; p <= total; p++) {
      const start = (p - 1) * PART
      const partBuf = buf.subarray(start, Math.min(start + PART, info.size))
      let uploaded = false
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const r = await withTimeout(
            client.uploadPart(key, uploadId, p, partBuf), 45000, `分片${p}/${total}`,
          )
          parts.push({ number: p, etag: r.res.headers.etag })
          uploaded = true
          break
        } catch (e) {
          if (attempt === 4) throw e
          await sleep(1500 * attempt)
        }
      }
      if (!uploaded) throw new Error(`分片 ${p} 多次失败`)
    }
    return withTimeout(
      client.completeMultipartUpload(key, uploadId, parts, { headers }), 30000, 'completeMultipart',
    )
  } catch (e) {
    await client.abortMultipartUpload(key, uploadId).catch(() => {})
    throw e
  }
}

/** 给 Promise 加超时，防止网络挂起时永久等待 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error(`${label}超时(${Math.round(ms / 1000)}s)`)
      err.code = 'WRAP_TIMEOUT'
      reject(err)
    }, ms)
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

/** 从 OSS URL 解析对象 key，如 videos/xxx.mp4 */
function keyFromUrl(u) {
  const m = u.match(/aliyuncs\.com\/(.+)$/)
  if (!m) throw new Error('无法解析 OSS key: ' + u)
  return decodeURIComponent(m[1])
}

/** 转码 key：videos/ → transcoded/，保留子目录结构 */
function transKeyFrom(origKey) {
  return origKey.replace(/^videos\//, 'transcoded/')
}

function publicUrl(client, key) {
  return `https://${client.options.bucket}.${client.options.region}.aliyuncs.com/${key}`
}

/** 检查对象是否存在（HEAD，不下载内容） */
async function objectExists(client, key) {
  try {
    await withTimeout(client.head(key), 30000, 'head')
    return true
  } catch (e) {
    if (e.code === 'NoSuchKey' || e.status === 404) return false
    throw e
  }
}

async function processOne(rawUrl, client) {
  const origKey = keyFromUrl(rawUrl)
  const transKey = transKeyFrom(origKey)
  const transUrl = publicUrl(client, transKey)

  // 已在映射里且 OSS 上存在 → 跳过
  if (map[rawUrl] && await objectExists(client, transKey)) {
    return { rawUrl, transUrl, skipped: true }
  }

  // 本地临时输出（文件名纯 ASCII，避免 ffmpeg 路径问题）
  const asciiName = path.basename(origKey).replace(/[^\w.\-]/g, '_')
  const tmp = path.join(os.tmpdir(), 'hevc-trans', `${asciiName}.${Date.now()}.mp4`)
  mkdirSync(path.dirname(tmp), { recursive: true })

  try {
    // 转码（内部 480s 超时会杀死 ffmpeg；这里外层给 490s 兜底）
    await withTimeout(transcodeToMp4({ input: rawUrl, output: tmp }), 490000, '转码')
    // 上传（10 分钟，大文件分片）
    await withTimeout(uploadFile(client, transKey, tmp), 600000, '上传')
  } finally {
    // 无论成功失败都清理临时文件
    if (existsSync(tmp)) rmSync(tmp, { force: true })
  }

  map[rawUrl] = transUrl
  writeFileSync(MAP_FILE, JSON.stringify(map, null, 2))
  return { rawUrl, transUrl }
}

async function processWithRetry(rawUrl, client) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      return await processOne(rawUrl, client)
    } catch (e) {
      lastErr = e
      if (attempt < MAX_RETRY) {
        await new Promise(r => setTimeout(r, 3000 * attempt))
      }
    }
  }
  throw lastErr
}

async function main() {
  console.log(`待处理 ${urls.length} 个，并发 ${CONCURRENCY}，每任务最多重试 ${MAX_RETRY} 次`)
  let done = 0
  let failed = 0
  const failures = []

  let cursor = 0
  async function worker() {
    // 每个 worker 独立 client，避免连接共享互相拖垮
    const client = createClient()
    while (cursor < urls.length) {
      const idx = cursor++
      const u = urls[idx]
      try {
        const r = await processWithRetry(u, client)
        done++
        console.log(`[${done}/${urls.length}] ${r.skipped ? '跳过' : '完成'} ${path.basename(keyFromUrl(u))}`)
      } catch (e) {
        failed++
        failures.push({ url: u, error: e.message })
        console.error(`[失败] ${u} :: ${e.message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  writeFileSync(MAP_FILE, JSON.stringify(map, null, 2))
  if (failures.length) writeFileSync('/tmp/hevc-transcode-failures.json', JSON.stringify(failures, null, 2))
  console.log(`\n结束：成功 ${done}，失败 ${failed}，累计映射 ${Object.keys(map).length}`)
  if (failed) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exit(1) })
