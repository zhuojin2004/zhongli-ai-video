#!/usr/bin/env node
/**
 * 批量同步脚本：处理 104 个视频
 * 策略：
 * - NOT_IN_FEISHU: 调用 /api/upload（自动 OSS + AI 分析 + 写飞书）
 * - IN_FEISHU_BRIEF / NO_SHOTS: 先 Feishu API 删旧分镜 → 再 /api/upload
 * - 并发 = 2（避免 MiniMax 限流）
 * - 每处理完 1 个就写 checkpoint（崩溃可恢复）
 *
 * 用法: node batch-sync.js
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const AUDIT_PATH = path.join(__dirname, 'sync-audit.json')
const CHECKPOINT_PATH = path.join(__dirname, 'batch-sync-checkpoint.json')
const MOCK_BASE = 'http://localhost:9099'

// ─── 加载 env ───
const env = {}
for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}

const APP_ID = env.FEISHU_APP_ID
const APP_SECRET = env.FEISHU_APP_SECRET
const BITABLE_TOKEN = env.FEISHU_BITABLE_APP_TOKEN
const SHOT_TABLE_ID = env.FEISHU_TABLE_ID
const FEISHU_BASE = env.FEISHU_BASE || 'https://open.feishu.cn'

// ─── Feishu API helpers ───
let _tokenCache = null
async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60000) return _tokenCache.token
  const r = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  }).then(r => r.json())
  if (r.code !== 0) throw new Error(`getToken: ${r.msg}`)
  _tokenCache = { token: r.tenant_access_token, expiresAt: Date.now() + r.expire * 1000 }
  return r.tenant_access_token
}

async function deleteShotRecord(recordId) {
  const token = await getToken()
  const r = await fetch(`${FEISHU_BASE}/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${SHOT_TABLE_ID}/records/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json())
  return r.code === 0
}

// ─── Mock API helpers ───
async function uploadVideo(filePath, fileName, uploaderName = '系统补同步') {
  const FormData = require('form-data')
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath), fileName)
    const req = http.request({
      method: 'POST',
      hostname: 'localhost',
      port: 9099,
      path: '/api/upload',
      headers: {
        ...form.getHeaders(),
        // 中文 header 必须用 latin1 编码，否则 Node HTTP 模块会抛 ERR_INVALID_CHAR
        'x-uploader-name': Buffer.from(uploaderName, 'utf8').toString('latin1'),
        'x-uploader-role': 'admin',
      },
      timeout: 600000, // 10 分钟超时（AI 分析慢）
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) reject(new Error(`upload ${res.statusCode}: ${parsed.message || data}`))
          else resolve(parsed)
        } catch (e) { reject(new Error(`parse response: ${data.slice(0, 500)}`)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('upload timeout 10min')) })
    form.pipe(req)
  })
}

// ─── Checkpoint 加载/保存 ───
function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_PATH)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'))
  }
  return { processed: {}, failed: {}, startedAt: Date.now() }
}
function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2))
}

// ─── 处理单个视频 ───
async function processOne(item, cp) {
  const { fileName, path: filePath, mainRecordId, status } = item
  if (cp.processed[fileName]) {
    return { fileName, status: 'SKIPPED', reason: 'already_done' }
  }

  console.log(`\n🎬 [${fileName}] (${status})`)

  // 1) 如果已同步过，先删旧分镜
  if ((status === 'IN_FEISHU_BRIEF' || status === 'IN_FEISHU_NO_SHOTS') && mainRecordId) {
    // 查主表关联的旧分镜记录
    const token = await getToken()
    // 通过「关联的原视频」反向查分镜
    // 或者用主表自身的 shots 引用（如果有）
    // 简化：直接从分镜表查 fileName 匹配的记录
    let pageToken = ''
    let deleted = 0
    do {
      const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${SHOT_TABLE_ID}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
      if (r.code !== 0) break
      for (const item of (r.data?.items || [])) {
        if (item.fields?.['视频文件名'] === fileName) {
          if (await deleteShotRecord(item.record_id)) deleted++
        }
      }
      pageToken = r.data?.page_token || ''
    } while (pageToken)
    console.log(`   🗑️  删除旧分镜 ${deleted} 条`)
  }

  // 2) 上传 + AI 分析 + 写飞书
  const uploadRes = await uploadVideo(filePath, fileName)
  const shotCount = uploadRes.shotCount || uploadRes.data?.shotCount || 0
  console.log(`   ✅ 上传完成，${shotCount} 个分镜`)

  return { fileName, status: 'DONE', shotCount, duration: uploadRes.totalDuration || uploadRes.data?.totalDuration }
}

// ─── 主流程（并发执行） ───
;(async () => {
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'))
  const { matrix } = audit
  const toProcess = matrix.filter(m => m.action !== 'SKIP')
  console.log(`📋 待处理: ${toProcess.length} 个`)

  const cp = loadCheckpoint()
  console.log(`♻️  已处理: ${Object.keys(cp.processed).length} 个（checkpoint 恢复）`)

  const CONCURRENCY = 2
  let success = 0, failed = 0, skipped = 0
  const queue = [...toProcess]

  async function worker(id) {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) break
      try {
        const result = await processOne(item, cp)
        if (result.status === 'DONE') {
          cp.processed[item.fileName] = { ok: true, shotCount: result.shotCount, at: Date.now() }
          success++
        } else if (result.status === 'SKIPPED') skipped++
      } catch (e) {
        console.error(`   ❌ [${item.fileName}] 失败: ${e.message.slice(0, 200)}`)
        cp.processed[item.fileName] = { ok: false, error: e.message.slice(0, 200), at: Date.now() }
        cp.failed[item.fileName] = e.message.slice(0, 500)
        failed++
      }
      saveCheckpoint(cp)
      const done = success + failed + skipped
      const remaining = queue.length
      console.log(`📊 进度: ${done}/${toProcess.length} (成功 ${success} / 失败 ${failed} / 跳过 ${skipped}) | 队列剩 ${remaining}`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)))

  console.log('\n' + '='.repeat(60))
  console.log(`✅ 完成: 成功 ${success} | 失败 ${failed} | 跳过 ${skipped}`)
  console.log(`📄 Checkpoint: ${CHECKPOINT_PATH}`)
})().catch(e => {
  console.error('❌ 致命:', e)
  process.exit(1)
})
