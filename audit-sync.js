#!/usr/bin/env node
/**
 * 自动搬运车 飞书同步审计脚本
 * 1. 列本地所有视频文件
 * 2. 拉飞书所有主表 + 分镜表记录
 * 3. 交叉对比，输出每个文件的状态：
 *    - NOT_IN_FEISHU: 未同步，需上传 + AI 分析
 *    - IN_FEISHU_BRIEF: 已同步但标签简陋（description<60字 或 缺封面图 或 缺时长标签），需重新分镜打标
 *    - IN_FEISHU_DETAILED: 已同步且标签详细，跳过
 * 4. 输出 JSON 到 ./sync-audit.json 给后续 batch 处理使用
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─── 加载 .env ───
const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}

const APP_ID = env.FEISHU_APP_ID
const APP_SECRET = env.FEISHU_APP_SECRET
const BITABLE_TOKEN = env.FEISHU_BITABLE_APP_TOKEN
const MAIN_TABLE_ID = env.FEISHU_MAIN_TABLE_ID
const SHOT_TABLE_ID = env.FEISHU_TABLE_ID
const FEISHU_BASE = env.FEISHU_BASE || 'https://open.feishu.cn'

const VIDEO_ROOT = '/Users/jensen/Desktop/自动搬运车'

// ─── Feishu API helpers ───
let _tokenCache = null
async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60000) return _tokenCache.token
  const r = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  }).then(r => r.json())
  if (r.code !== 0) throw new Error(`getToken failed: ${r.msg}`)
  _tokenCache = { token: r.tenant_access_token, expiresAt: Date.now() + r.expire * 1000 }
  return r.tenant_access_token
}

async function fetchAllRecords(tableId, fieldName = '视频文件名') {
  const token = await getToken()
  const all = []
  let pageToken = ''
  do {
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${tableId}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
    if (r.code !== 0) {
      console.error(`fetch ${tableId} failed:`, r.msg)
      break
    }
    if (r.data?.items) all.push(...r.data.items)
    pageToken = r.data?.page_token || ''
  } while (pageToken)
  return all
}

// ─── 列出本地所有视频文件 ───
function listLocalVideos() {
  const out = []
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(mp4|mov|avi|mkv|webm)$/i.test(e.name)) {
        const rel = path.relative(VIDEO_ROOT, p)
        const stat = fs.statSync(p)
        out.push({
          path: p,
          relPath: rel,
          fileName: e.name,
          industry: rel.split('/')[0] || '',
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        })
      }
    }
  }
  walk(VIDEO_ROOT)
  return out
}

// ─── 主流程 ───
;(async () => {
  console.log('🔍 列出本地视频...')
  const localFiles = listLocalVideos()
  console.log(`   本地视频: ${localFiles.length} 个`)

  console.log('📥 拉飞书主表所有记录...')
  const mainRecs = await fetchAllRecords(MAIN_TABLE_ID, '视频文件名')
  console.log(`   主表: ${mainRecs.length} 条`)

  console.log('📥 拉飞书分镜表所有记录...')
  const shotRecs = await fetchAllRecords(SHOT_TABLE_ID, '视频文件名')
  console.log(`   分镜表: ${shotRecs.length} 条`)

  // 构建 fileName → 主表 / 分镜 索引
  const mainByFn = new Map()
  for (const r of mainRecs) {
    const fn = r.fields?.['视频文件名'] || r.fields?.['fileName'] || ''
    if (fn) mainByFn.set(fn, r)
  }

  // 分镜按视频文件名分组
  const shotsByFn = new Map()
  for (const r of shotRecs) {
    const fn = r.fields?.['视频文件名'] || ''
    if (!fn) continue
    if (!shotsByFn.has(fn)) shotsByFn.set(fn, [])
    shotsByFn.get(fn).push(r)
  }

  // 匹配函数：本地 fileName 可能只是 basename 或包含子目录
  function findMainRecord(localFile) {
    // 精确匹配
    if (mainByFn.has(localFile.fileName)) return mainByFn.get(localFile.fileName)
    // 路径匹配：飞书可能存的是 "自动搬运车/xxx/yyy.mp4"
    for (const [fn, rec] of mainByFn.entries()) {
      if (fn === localFile.relPath) return rec
      if (fn.endsWith('/' + localFile.fileName) && fn.includes(localFile.industry)) return rec
    }
    return null
  }

  // 评估分镜标签质量
  function assessShotQuality(shots) {
    if (!shots.length) return { quality: 'NO_SHOTS', score: 0, issues: ['no_shots'] }
    let descTotal = 0
    let hasCover = 0
    let hasDurationLabel = 0
    let timeStampValid = 0
    const issues = []
    for (const s of shots) {
      const f = s.fields || {}
      const desc = String(f['画面描述'] || '')
      descTotal += desc.length
      if (String(f['封面图'] || '')) hasCover++
      if (String(f['时长标签'] || '')) hasDurationLabel++
      const st = Number(f['开始时间 (s)'] || -1)
      const et = Number(f['结束时间 (s)'] || -1)
      if (st >= 0 && et > st) timeStampValid++
    }
    const avgDesc = Math.round(descTotal / shots.length)
    if (avgDesc < 60) issues.push(`avg_desc=${avgDesc}<60`)
    if (hasCover < shots.length) issues.push(`missing_cover=${shots.length - hasCover}`)
    if (hasDurationLabel < shots.length) issues.push(`missing_dur_label=${shots.length - hasDurationLabel}`)
    if (timeStampValid < shots.length) issues.push(`bad_timestamp=${shots.length - timeStampValid}`)

    if (issues.length === 0) return { quality: 'DETAILED', score: 100, issues: [], avgDesc, hasCover, hasDurationLabel, timeStampValid }
    if (issues.length >= 2) return { quality: 'BRIEF', score: 30, issues, avgDesc, hasCover, hasDurationLabel, timeStampValid }
    return { quality: 'PARTIAL', score: 60, issues, avgDesc, hasCover, hasDurationLabel, timeStampValid }
  }

  // 评估每个本地文件
  const matrix = []
  for (const f of localFiles) {
    const main = findMainRecord(f)
    if (!main) {
      matrix.push({ ...f, status: 'NOT_IN_FEISHU', action: 'UPLOAD_AND_ANALYZE' })
      continue
    }
    const shots = shotsByFn.get(f.fileName) || []
    const fnInShots = shotsByFn.get(f.relPath) || []
    const allShots = [...shots, ...fnInShots]
    if (!allShots.length) {
      matrix.push({ ...f, status: 'IN_FEISHU_NO_SHOTS', action: 'RE_ANALYZE', mainRecordId: main.record_id, shotCount: 0 })
      continue
    }
    const assess = assessShotQuality(allShots)
    const status = assess.quality === 'DETAILED' ? 'IN_FEISHU_DETAILED' : (assess.quality === 'PARTIAL' ? 'IN_FEISHU_PARTIAL' : 'IN_FEISHU_BRIEF')
    const action = assess.quality === 'DETAILED' ? 'SKIP' : 'RE_ANALYZE'
    matrix.push({
      ...f,
      status,
      action,
      mainRecordId: main.record_id,
      shotCount: allShots.length,
      assessment: assess,
    })
  }

  // 统计
  const stats = {
    total: matrix.length,
    NOT_IN_FEISHU: matrix.filter(m => m.status === 'NOT_IN_FEISHU').length,
    IN_FEISHU_BRIEF: matrix.filter(m => m.status === 'IN_FEISHU_BRIEF').length,
    IN_FEISHU_PARTIAL: matrix.filter(m => m.status === 'IN_FEISHU_PARTIAL').length,
    IN_FEISHU_DETAILED: matrix.filter(m => m.status === 'IN_FEISHU_DETAILED').length,
    IN_FEISHU_NO_SHOTS: matrix.filter(m => m.status === 'IN_FEISHU_NO_SHOTS').length,
    needsAction: matrix.filter(m => m.action !== 'SKIP').length,
  }

  // 输出
  console.log('\n📊 同步状态矩阵:')
  console.log(`   总计: ${stats.total}`)
  console.log(`   ❌ 未同步: ${stats.NOT_IN_FEISHU}`)
  console.log(`   ⚠️ 标签简陋: ${stats.IN_FEISHU_BRIEF}`)
  console.log(`   🟡 部分缺失: ${stats.IN_FEISHU_PARTIAL}`)
  console.log(`   ✅ 详细: ${stats.IN_FEISHU_DETAILED}`)
  console.log(`   ⚪ 已同步但无分镜: ${stats.IN_FEISHU_NO_SHOTS}`)
  console.log(`   👉 需处理: ${stats.needsAction}`)

  fs.writeFileSync(path.join(__dirname, 'sync-audit.json'), JSON.stringify({ stats, matrix }, null, 2))
  console.log(`\n✅ 审计结果写入 sync-audit.json`)
})().catch(e => {
  console.error('❌', e)
  process.exit(1)
})
