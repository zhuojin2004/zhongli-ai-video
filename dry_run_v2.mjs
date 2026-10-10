// dry_run.mjs: 跑 2 个视频（1 原始 + 1 压缩版），验证完整链路
// 用 node --env-file=.env 跑（避免 import hoisting 问题）

import { statSync, existsSync, createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import OSS from 'ali-oss'

const oss = new OSS({
  accessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET,
  bucket: process.env.ALI_OSS_BUCKET,
  region: process.env.ALI_OSS_REGION,
})

const M3_KEY = process.env.MINIMAX_API_KEY
const F_APP_ID = process.env.FEISHU_APP_ID
const F_APP_SECRET = process.env.FEISHU_APP_SECRET
const F_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN
const F_MAIN_TABLE = process.env.FEISHU_MAIN_TABLE_ID
const F_SHOT_TABLE = 'tblJEJtnvP4Rtlno'

async function getFeishuToken() {
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: F_APP_ID, app_secret: F_APP_SECRET }),
  })
  return (await r.json()).tenant_access_token
}
async function ffprobe(p) {
  return new Promise(r => execFile('/Users/jensen/miniconda3/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', p], { timeout: 30000 }, (e, o) => r(e ? 0 : parseFloat(o.trim()) || 0)))
}
async function md5(p) {
  return new Promise((res, rej) => {
    const h = createHash('md5')
    const s = createReadStream(p)
    s.on('data', d => h.update(d))
    s.on('end', () => res(h.digest('hex')))
    s.on('error', rej)
  })
}
async function fCreate(tableId, fields) {
  const token = await getFeishuToken()
  const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${F_APP_TOKEN}/tables/${tableId}/records`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  const d = await r.json()
  if (d.code !== 0) return { ok: false, error: d.msg }
  return { ok: true, recordId: d.data.record.record_id }
}
async function fUpdate(tableId, recordId, fields) {
  const token = await getFeishuToken()
  const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${F_APP_TOKEN}/tables/${tableId}/records/${recordId}`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  const d = await r.json()
  if (d.code !== 0) return { ok: false, error: d.msg }
  return { ok: true }
}

const ANALYZE_PROMPT = `你是专业的工业/营销视频内容分析专家。任务: 分析这段视频，按画面内容变化智能切分镜头（不是固定秒数），并对每个分镜打多维度标签。

输出严格 JSON Schema:
{
  "productModel": "识别到的产品品牌/型号（看Logo/标牌/外形）",
  "industry": "所属行业",
  "totalDuration": <秒数>,
  "shots": [
    {
      "startTime": <开始秒>,
      "endTime": <结束秒>,
      "description": "画面描述（人物外貌/服饰/产品特征/动作/背景）",
      "scene": "场景（仓库/工厂/户外/展厅/办公室/测试场）",
      "objects": "画面里的物体",
      "action": "人物/产品的动作",
      "camera": "镜头语言（特写/全景/中景/跟拍/航拍/固定机位）",
      "coreSellingPoint": "这段传递的核心卖点",
      "people": "人物（不可辨识则描述特征）"
    }
  ]
}

严格 JSON 输出，无 markdown 包裹。`

async function m3(url, dur) {
  const r = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + M3_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: [
        { type: 'video_url', video_url: { url } },
        { type: 'text', text: ANALYZE_PROMPT + `\n\n视频总时长约 ${dur.toFixed(1)} 秒。` },
      ]}],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
    }),
  })
  if (!r.ok) throw new Error('M3 ' + r.status + ': ' + (await r.text()).slice(0, 200))
  let raw = (await r.json()).choices?.[0]?.message?.content
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) raw = fence[1].trim()
  return JSON.parse(raw)
}

async function process(file) {
  const sz = (statSync(file).size / 1024 / 1024).toFixed(2)
  const dur = await ffprobe(file)
  console.log(`\n=== ${file} (${sz}MB, ${dur.toFixed(1)}s) ===`)
  if (dur <= 0) { console.log('  skip: dur=0'); return }
  const hash = await md5(file)
  const key = `videos/dryrun_${Date.now()}_${file.split('/').pop()}`
  const r = await oss.put(key, file, { headers: { 'x-oss-object-acl': 'public-read' } })
  console.log('  uploaded:', r.url)
  const head = await fetch(r.url, { method: 'HEAD' })
  console.log('  HEAD:', head.status, '(需 200)')
  if (head.status !== 200) throw new Error('OSS not public')
  const t0 = Date.now()
  const analyzed = await m3(r.url, dur)
  console.log(`  M3 (${((Date.now()-t0)/1000).toFixed(1)}s): productModel="${analyzed.productModel}", shots=${analyzed.shots?.length}`)
  if (analyzed.shots?.[0]) {
    console.log('  shot[0]:', JSON.stringify(analyzed.shots[0], null, 2).slice(0, 400))
  }

  // 写主视频表
  const main = await fCreate(F_MAIN_TABLE, {
    '视频文件名': file.split('/').pop(),
    '文件 Hash 值': hash,
    'OSS 云端地址': r.url,
    '总时长 (s)': dur.toFixed(3),
    '分析状态': '已分析',
    '入库时间': Date.now(),
  })
  if (!main.ok) { console.log('  MAIN FAIL:', main.error); return }
  console.log('  MAIN →', main.recordId)

  // 写分镜
  const shotIds = []
  for (let i = 0; i < (analyzed.shots || []).length; i++) {
    const s = analyzed.shots[i]
    const shot = await fCreate(F_SHOT_TABLE, {
      '产品型号': String(analyzed.productModel || ''),
      '产品型号_分镜': String(analyzed.productModel || '') + '_' + (i + 1),
      '分镜 ID': file.split('/').pop().replace('.mp4', '') + '_shot_' + (i + 1),
      '视频文件名': file.split('/').pop(),
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
      '原视频地址': r.url,
      '关联的原视频': JSON.stringify([{ record_id: main.recordId, table_id: F_MAIN_TABLE }]),
    })
    if (shot.ok) shotIds.push(shot.recordId)
  }
  if (shotIds.length) await fUpdate(F_MAIN_TABLE, main.recordId, { '反向关联分镜': shotIds })
  console.log('  SHOTS:', shotIds.length, '条')
}

const candidates = [
  '/tmp/zhongli-videos/upload_1788327937279.mp4',
  '/tmp/zhongli-videos/_compressed/upload_1788329355709.mp4',
]
for (const f of candidates) {
  if (existsSync(f)) {
    try { await process(f) } catch (e) { console.log('  ERR:', e.message) }
  } else {
    console.log('  NOT FOUND:', f)
  }
}
