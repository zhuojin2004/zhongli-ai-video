import { config } from 'dotenv'
import { resolve } from 'node:path'
for (const p of ['.env.local', '.env', '../.env']) {
  try { config({ path: resolve(process.cwd(), p) }) } catch (e) {}
}
const APP_ID = process.env.FEISHU_APP_ID
const SECRET = process.env.FEISHU_APP_SECRET
const TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN
const SHOT_TABLE = process.env.FEISHU_TABLE_ID
const MAIN_TABLE = process.env.FEISHU_MAIN_TABLE_ID

const tk = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({app_id:APP_ID, app_secret:SECRET})
})
const td = await tk.json()
const T = td.tenant_access_token

async function fetchAll(tableId) {
  let all = [], pageToken = ''
  do {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${TOKEN}/tables/${tableId}/records?page_size=500${pageToken ? '&page_token=' + pageToken : ''}`
    const d = await fetch(url, { headers: { Authorization: 'Bearer ' + T } }).then(r => r.json())
    if (d.code !== 0) { console.error(d.msg); return all }
    all = all.concat(d.data?.items || [])
    pageToken = d.data?.page_token || ''
  } while (pageToken)
  return all
}

const mainRecs = await fetchAll(MAIN_TABLE)
const shotRecs = await fetchAll(SHOT_TABLE)
console.log(`主表: ${mainRecs.length} 条，分镜表: ${shotRecs.length} 条\n`)

// 按主表 record_id 索引主记录
const mainById = new Map()
for (const r of mainRecs) mainById.set(r.record_id, r)

// 分镜按「关联的原视频」分组（取第一个 record_id）
const shotsByMainId = new Map()
const shotsByFn = new Map()  // 备用：按 fileName 也建索引
for (const r of shotRecs) {
  const link = r.fields?.['关联的原视频']
  const fn = String(r.fields?.['视频文件名'] || '').trim()
  let mainId = null
  if (Array.isArray(link) && link.length > 0) {
    if (typeof link[0] === 'string') mainId = link[0]
    else if (typeof link[0] === 'object' && link[0]?.record_ids) mainId = link[0].record_ids[0]
  }
  if (mainId && !shotsByMainId.has(mainId)) shotsByMainId.set(mainId, [])
  if (mainId) shotsByMainId.get(mainId).push(r)
  if (fn && !shotsByFn.has(fn)) shotsByFn.set(fn, [])
  if (fn) shotsByFn.get(fn).push(r)
}

console.log(`通过 关联的原视频 链接到主表的分镜组数: ${shotsByMainId.size}`)
console.log(`按 fileName 直接命中的分镜组数: ${shotsByFn.size}\n`)

// 用 mainId 优先，按主记录聚合
const rows = []
for (const main of mainRecs) {
  const fn = String(main.fields?.['视频文件名'] || '').trim()
  if (!fn) continue
  const totalDur = Number(main.fields?.['总时长 (s)'] || 0) || (() => {
    const d = String(main.fields?.['时长显示'] || '')
    const m = d.match(/^(\d+):(\d+)/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0
  })()
  const shots = shotsByMainId.get(main.record_id) || shotsByFn.get(fn) || []
  if (shots.length === 0) {
    rows.push({ fn, totalDur, shots: 0, lastEnd: 0, sumDur: 0, source: shotsByMainId.has(main.record_id) ? 'mainId' : 'fn' })
    continue
  }
  const sorted = shots.slice().sort((a, b) => Number(a.fields?.['开始时间 (s)'] || 0) - Number(b.fields?.['开始时间 (s)'] || 0))
  const lastEnd = Number(sorted[sorted.length - 1].fields?.['结束时间 (s)'] || 0)
  const sumDur = sorted.reduce((acc, s) => acc + Math.max(0, Number(s.fields?.['结束时间 (s)'] || 0) - Number(s.fields?.['开始时间 (s)'] || 0)), 0)
  rows.push({ fn: fn.split('/').pop(), totalDur, shots: sorted.length, lastEnd, sumDur, source: shotsByMainId.has(main.record_id) ? 'mainId' : 'fn' })
}

// 按偏差排序
rows.sort((a, b) => {
  const ra = a.totalDur ? a.lastEnd / a.totalDur : 0
  const rb = b.totalDur ? b.lastEnd / b.totalDur : 0
  return rb - ra
})

console.log('=== 异常样本 (top 15 by ratio) ===')
console.log('fileName'.padEnd(35) + ' shots  lastEnd     sumDur      videoDur   ratio')
for (const r of rows.filter(r => r.totalDur > 0 && r.shots > 0).slice(0, 15)) {
  const ratio = r.totalDur ? (r.lastEnd / r.totalDur).toFixed(2) : '?'
  console.log(
    r.fn.padEnd(35) +
    String(r.shots).padStart(5) + '   ' +
    (r.lastEnd.toFixed(1) + 's').padStart(8) + '   ' +
    (r.sumDur.toFixed(1) + 's').padStart(8) + '   ' +
    (r.totalDur.toFixed(1) + 's').padStart(8) + '   ' +
    String(ratio).padStart(5)
  )
}

console.log('\n=== 异常样本 (bottom 15 by ratio, 接近 0) ===')
for (const r of rows.filter(r => r.totalDur > 0 && r.shots > 0).slice(-15)) {
  const ratio = r.totalDur ? (r.lastEnd / r.totalDur).toFixed(2) : '?'
  console.log(
    r.fn.padEnd(35) +
    String(r.shots).padStart(5) + '   ' +
    (r.lastEnd.toFixed(1) + 's').padStart(8) + '   ' +
    (r.sumDur.toFixed(1) + 's').padStart(8) + '   ' +
    (r.totalDur.toFixed(1) + 's').padStart(8) + '   ' +
    String(ratio).padStart(5)
  )
}

console.log('\n=== 总体统计 ===')
const valid = rows.filter(r => r.totalDur > 0 && r.shots > 0)
console.log(`有效记录（有主表时长+有分镜）: ${valid.length}`)
const matched = valid.filter(r => r.lastEnd / r.totalDur > 0.8 && r.lastEnd / r.totalDur < 1.2).length
const short = valid.filter(r => r.lastEnd / r.totalDur <= 0.8).length
const long = valid.filter(r => r.lastEnd / r.totalDur >= 1.2).length
console.log(`分镜时间区间 ≈ 视频时长 (ratio 0.8-1.2): ${matched}`)
console.log(`分镜时间区间 << 视频时长 (ratio ≤ 0.8): ${short}`)
console.log(`分镜时间区间 >> 视频时长 (ratio ≥ 1.2): ${long}`)
console.log(`无分镜记录: ${rows.filter(r => r.shots === 0 && r.totalDur > 0).length}`)
