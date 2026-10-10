// Batch ingest: 把 /tmp/zhongli-videos/upload_*.mp4 全量入库到飞书
// 流程: 选文件 -> 上传 OSS (public-read) -> M3 video_url 智能分镜 + 标签 -> 写主视频表 -> 写分镜任务库 N 行
import { config } from 'dotenv'
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import OSS from 'ali-oss'

config({ path: '/Users/jensen/Downloads/zhongli-src/.env' })

const F_APP_ID = process.env.FEISHU_APP_ID
const F_APP_SECRET = process.env.FEISHU_APP_SECRET
const F_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN
const F_MAIN_TABLE = process.env.FEISHU_MAIN_TABLE_ID  // tblHAulQSuPQyDfE
const F_SHOT_TABLE = 'tblJEJtnvP4Rtlno'                 // 分镜任务库（user confirmed）
const F_NEW_VID_TABLE = process.env.FEISHU_NEW_VIDEO_TABLE_ID || 'tbly8R5zwud22O58'

const OSS_KEY = process.env.ALI_OSS_ACCESS_KEY_ID
const OSS_SECRET = process.env.ALI_OSS_ACCESS_KEY_SECRET
const OSS_BUCKET = process.env.ALI_OSS_BUCKET
const OSS_REGION = process.env.ALI_OSS_REGION

const M3_BASE = process.env.MINIMAX_BASE || 'https://api.minimaxi.com/v1'
const M3_KEY = process.env.MINIMAX_API_KEY
const M3_MODEL = 'MiniMax-M3'

const SRC_DIR = '/tmp/zhongli-videos'
const COMP_DIR = '/tmp/zhongli-videos/_compressed'
const STATE_FILE = '/tmp/zhongli-ingest-state.json'

const oss = new OSS({ accessKeyId: OSS_KEY, accessKeySecret: OSS_SECRET, bucket: OSS_BUCKET, region: OSS_REGION })

// ─── helpers ───
async function getFeishuToken() {
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: F_APP_ID, app_secret: F_APP_SECRET }),
  })
  const d = await r.json()
  if (d.code !== 0) throw new Error('Feishu token fail: ' + d.msg)
  return d.tenant_access_token
}

async function fList(tableId, pageSize = 100) {
  const all = []
  const token = await getFeishuToken()
  let page = ''
  while (true) {
    const u = `https://open.feishu.cn/open-apis/bitable/v1/apps/${F_APP_TOKEN}/tables/${tableId}/records?page_size=${pageSize}${page ? '&page_token=' + page : ''}`
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } })
    const d = await r.json()
    if (d.code !== 0) throw new Error('Feishu list fail: ' + d.msg)
    all.push(...(d.data.items || []))
    if (!d.data.has_more) break
    page = d.data.page_token
  }
  return all
}

async function fCreate(tableId, fields) {
  const token = await getFeishuToken()
  const u = `https://open.feishu.cn/open-apis/bitable/v1/apps/${F_APP_TOKEN}/tables/${tableId}/records`
  const r = await fetch(u, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  const d = await r.json()
  if (d.code !== 0) {
    console.error('  Feishu create fail:', d.msg, JSON.stringify(fields).slice(0, 200))
    return { ok: false, error: d.msg }
  }
  return { ok: true, recordId: d.data.record.record_id }
}

async function fUpdate(tableId, recordId, fields) {
  const token = await getFeishuToken()
  const u = `https://open.feishu.cn/open-apis/bitable/v1/apps/${F_APP_TOKEN}/tables/${tableId}/records/${recordId}`
  const r = await fetch(u, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  const d = await r.json()
  if (d.code !== 0) return { ok: false, error: d.msg }
  return { ok: true }
}

async function getVideoDuration(localPath) {
  return new Promise((resolve) => {
    execFile('/Users/jensen/miniconda3/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', localPath], { timeout: 30000 }, (err, stdout) => {
      if (err) return resolve(0)
      resolve(parseFloat(stdout.trim()) || 0)
    })
  })
}

async function uploadToOssPublic(localPath, key) {
  const r = await oss.put(key, localPath, { headers: { 'x-oss-object-acl': 'public-read' } })
  return r.url
}

function fileMd5(localPath) {
  return new Promise((resolve, reject) => {
    const h = createHash('md5')
    const stream = require('node:fs').createReadStream(localPath)
    stream.on('data', d => h.update(d))
    stream.on('end', () => resolve(h.digest('hex')))
    stream.on('error', reject)
  })
}

// M3: 直接给视频 URL，输出分镜 + 标签
const ANALYZE_PROMPT = `你是一个专业的工业/营销视频内容分析专家。任务: 分析这段视频，按画面内容变化智能切分镜头，并对每个分镜打上多维度标签。

【分镜规则】
- 必须根据实际画面内容智能切分，不是固定秒数
- 同一场景/同一动作/同一角度延续 → 合并为一段
- 场景切换、镜头转换、人物/产品动作明显变化 → 切分
- 通常一段 3-10 秒，极端单帧 <1s 也接受

【输出 JSON Schema】
{
  "productModel": "识别到的产品品牌/型号（看图中的Logo/标牌/外形特征）",
  "industry": "所属行业（工业设备/家电/消费品/物流/食品等）",
  "totalDuration": <视频总时长秒数>,
  "shots": [
    {
      "startTime": <本段开始秒数>,
      "endTime": <本段结束秒数>,
      "description": "这一段的画面描述（含人物外貌、服饰、产品特征、动作、背景等关键信息）",
      "scene": "场景（仓库/工厂/户外/展厅/办公室/测试场等）",
      "objects": "画面里的物体（产品型号、标牌、其他道具）",
      "action": "人物/产品的动作",
      "camera": "镜头语言（特写/全景/中景/跟拍/固定机位/航拍等）",
      "coreSellingPoint": "这一段传递的核心卖点（如「防水」「载重 3 吨」「高效率」）",
      "people": "人物姓名（如不可辨识则描述特征，如：戴橙色安全帽的中年男性驾驶员）"
    }
  ]
}

严格输出 JSON，不要任何 markdown 代码块包裹，不要 <think> 标签外的任何文字。`

async function analyzeWithM3(ossUrl, duration) {
  const res = await fetch(`${M3_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + M3_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: M3_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'video_url', video_url: { url: ossUrl } },
          { type: 'text', text: ANALYZE_PROMPT + `\n\n视频总时长约 ${duration.toFixed(1)} 秒。` },
        ],
      }],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`M3 ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  let raw = data.choices?.[0]?.message?.content
  if (!raw) throw new Error('M3 returned empty')
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) raw = fence[1].trim()
  return JSON.parse(raw)
}

// 状态
let state = { done: {}, failed: {} }
if (existsSync(STATE_FILE)) {
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch {}
}
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

// 主流程
const allFiles = readdirSync(SRC_DIR)
  .filter(f => f.startsWith('upload_') && f.endsWith('.mp4'))
  .map(f => ({
    name: f,
    src: existsSync(join(COMP_DIR, f)) ? join(COMP_DIR, f) : join(SRC_DIR, f),
    isCompressed: existsSync(join(COMP_DIR, f)),
  }))
  // 过滤：< 10KB 的占位空文件
  .filter(f => {
    const sz = statSync(f.src).size
    if (sz < 10 * 1024) {
      console.log(`[skip-empty] ${f.name} (${sz} bytes)`)
      return false
    }
    return true
  })

// 去重: 已有 OSS URL 在主视频表里 → 跳过
console.log('=== 拉主视频表已有 OSS URL 去重 ===')
const existing = await fList(F_MAIN_TABLE)
const existingUrls = new Set()
for (const r of existing) {
  const url = r.fields?.['OSS 云端地址'] || r.fields?.['OSS 云端地址']?.[0]?.text
  if (url) existingUrls.add(url)
}
console.log(`主视频表已有: ${existingUrls.size} 条 OSS URL`)

const todo = []
for (const f of allFiles) {
  if (state.done[f.name]) {
    console.log(`[skip-state] ${f.name}`)
    continue
  }
  todo.push(f)
}
console.log(`待处理: ${todo.length} 个 (去重前 ${allFiles.length})`)

let ok = 0, fail = 0
for (let i = 0; i < todo.length; i++) {
  const f = todo[i]
  const prefix = `[${i + 1}/${todo.length}] ${f.name}`
  console.log(`\n${prefix} ${f.isCompressed ? '(压缩版)' : ''}`)
  try {
    // 1) ffprobe duration
    const dur = await getVideoDuration(f.src)
    if (dur <= 0) throw new Error('duration 0, 视频损坏?')
    const sizeMB = (statSync(f.src).size / 1024 / 1024).toFixed(1)
    console.log(`  duration=${dur.toFixed(1)}s, size=${sizeMB}MB`)

    // 2) md5
    const hash = await fileMd5(f.src)
    console.log(`  md5=${hash.slice(0, 12)}`)

    // 3) 上传 OSS
    const key = `videos/ingest_${Date.now()}_${f.name}`
    const url = await uploadToOssPublic(f.src, key)
    console.log(`  oss: ${url.slice(0, 70)}...`)

    // 4) 验 OSS public
    const head = await fetch(url, { method: 'HEAD' })
    if (head.status !== 200) throw new Error(`OSS not public: HTTP ${head.status}`)

    // 5) M3 分析
    const analyzed = await analyzeWithM3(url, dur)
    const shots = Array.isArray(analyzed.shots) ? analyzed.shots : []
    console.log(`  M3 → productModel="${analyzed.productModel}", shots=${shots.length}`)
    if (shots.length === 0) throw new Error('M3 returned 0 shots')

    // 6) 写主视频表
    const mainRes = await fCreate(F_MAIN_TABLE, {
      '视频文件名': f.name,
      '文件 Hash 值': hash,
      'OSS 云端地址': url,
      '总时长 (s)': dur.toFixed(3),
      '分析状态': '已分析',
      '入库时间': Date.now(),
    })
    if (!mainRes.ok) throw new Error('主视频表写入失败: ' + mainRes.error)
    const mainRecordId = mainRes.recordId
    console.log(`  主视频表 → ${mainRecordId}`)

    // 7) 写分镜任务库 N 行
    const shotRecordIds = []
    for (let j = 0; j < shots.length; j++) {
      const s = shots[j]
      const shotRes = await fCreate(F_SHOT_TABLE, {
        '产品型号': String(analyzed.productModel || ''),
        '产品型号_分镜': String(analyzed.productModel || '') + '_' + (j + 1),
        '分镜 ID': f.name.replace('.mp4', '') + '_shot_' + (j + 1),
        '视频文件名': f.name,
        '画面描述': String(s.description || ''),
        '场景': String(s.scene || ''),
        '物体': String(s.objects || ''),
        '动作': String(s.action || ''),
        '镜头': String(s.camera || ''),
        '卖点': String(s.coreSellingPoint || ''),
        '人物姓名（如果有）': String(s.people || ''),
        '开始时间 (s)': Number(s.startTime || 0),
        '结束时间 (s)': Number(s.endTime || 0),
        '时长 (s)': Math.max(0, (Number(s.endTime || 0) - Number(s.startTime || 0))).toFixed(2),
        '原视频地址': url,
        '关联的原视频': JSON.stringify([{ record_id: mainRecordId, table_id: F_MAIN_TABLE }]),
      })
      if (shotRes.ok) {
        shotRecordIds.push(shotRes.recordId)
        console.log(`    shot${j + 1} → ${shotRes.recordId} (${(Number(s.endTime) - Number(s.startTime)).toFixed(1)}s)`)
      } else {
        console.log(`    shot${j + 1} 写入失败: ${shotRes.error}`)
      }
    }

    // 8) 回填主视频表的「反向关联分镜」
    if (shotRecordIds.length > 0) {
      await fUpdate(F_MAIN_TABLE, mainRecordId, { '反向关联分镜': shotRecordIds })
    }

    state.done[f.name] = { ossKey: key, mainRecordId, shotRecordIds, duration: dur, productModel: analyzed.productModel, shotCount: shotRecordIds.length }
    saveState()
    ok++
    console.log(`  ✓ DONE (${shotRecordIds.length} shots → 飞书)`)
  } catch (e) {
    console.log(`  ✗ FAIL: ${e.message}`)
    state.failed[f.name] = { error: e.message, time: Date.now() }
    saveState()
    fail++
    // 失败继续下一个
  }

  // 礼貌 throttle
  await new Promise(r => setTimeout(r, 500))
}

console.log(`\n=== ALL DONE: ok=${ok}, fail=${fail}, state=${STATE_FILE} ===`)
