// 多维度质检：对所有本地视频，验证飞书里的分镜记录是否符合预期
// 检查项：
//   1. 每个视频是否有分镜记录
//   2. startTime/endTime 是 number（秒）
//   3. endTime > startTime（合理）
//   4. 时长标签 格式正确（mm:ss.mmm）
//   5. 画面描述 长度 ≥ 60 字（或 fallback 4 字也认）
//   6. 关联的原视频 链接到主表
//   7. MAIN 表 时长显示 已填写
//   8. 行业 是三级分类（用 > 分隔）
const fs = require('fs')
const path = require('path')

const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const env = {}
for (const line of envRaw.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const APP = env.FEISHU_APP_ID
const SECRET = env.FEISHU_APP_SECRET
const APP_TOKEN = env.FEISHU_BITABLE_APP_TOKEN
const SHOT_TABLE = env.FEISHU_TABLE_ID
const MAIN_TABLE = env.FEISHU_MAIN_TABLE_ID
const VIDEO_DIR = '/Users/jensen/Desktop/自动搬运车'
const BASE = env.VITE_LARK_BASE || 'https://open.feishu.cn'

let _tk = null
async function getToken() {
  if (_tk && _tk.exp > Date.now() + 60000) return _tk.tk
  const r = await fetch(BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  }).then(r => r.json())
  _tk = { tk: r.tenant_access_token, exp: Date.now() + r.expire * 1000 }
  return r.tenant_access_token
}

async function listAll(tableId) {
  const token = await getToken()
  let pt = '', all = []
  do {
    const url = BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/records?page_size=500' + (pt ? '&page_token=' + pt : '')
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
    if (r.code !== 0) break
    all = all.concat(r.data?.items || [])
    pt = r.data?.page_token || ''
  } while (pt)
  return all
}

function listLocalVideos() {
  const result = []
  const dirs = fs.readdirSync(VIDEO_DIR)
  for (const d of dirs) {
    const dp = path.join(VIDEO_DIR, d)
    if (!fs.statSync(dp).isDirectory()) continue
    for (const f of fs.readdirSync(dp)) {
      if (f.toLowerCase().endsWith('.mp4')) result.push(f)
    }
  }
  return result
}

;(async () => {
  console.log('[' + new Date().toLocaleTimeString() + '] 开始多维度质检 ...')

  const localVideos = listLocalVideos()
  console.log('本地视频: ' + localVideos.length + ' 个')

  const shotRecords = await listAll(SHOT_TABLE)
  const mainRecords = await listAll(MAIN_TABLE)
  console.log('飞书 SHOT 表: ' + shotRecords.length + ' 条')
  console.log('飞书 MAIN 表: ' + mainRecords.length + ' 条')

  // 按 视频文件名 索引
  const shotsByFile = {}
  for (const r of shotRecords) {
    const fn = r.fields?.['视频文件名']
    if (!fn) continue
    if (!shotsByFile[fn]) shotsByFile[fn] = []
    shotsByFile[fn].push(r.fields || {})
  }

  const mainByFile = {}
  for (const r of mainRecords) {
    const fn = r.fields?.['视频文件名']
    if (!fn) continue
    mainByFile[fn] = r.fields || {}
  }

  // 统计
  const stats = {
    total: localVideos.length,
    hasShots: 0,
    shotCountOk: 0,         // 1-12 个分镜
    startTimeOk: 0,         // startTime 是 number
    endTimeGtStart: 0,      // endTime > startTime
    durationLabelOk: 0,     // 时长标签格式 mm:ss.mmm
    descLen: 0,             // 画面描述 ≥ 60 字（至少 1 个分镜满足）
    mainLinked: 0,          // 有关联的原视频
    mainHasDurLabel: 0,     // MAIN.时长显示 已填
    mainHasIndustry: 0,     // MAIN.行业 非空
    industry3level: 0,      // 行业有 2 个 > (3 级)
  }

  const issues = []

  for (const fn of localVideos) {
    const shots = shotsByFile[fn] || []
    const main = mainByFile[fn] || {}

    const problems = []
    if (shots.length === 0) problems.push('无分镜')
    else {
      stats.hasShots++
      if (shots.length >= 1 && shots.length <= 12) stats.shotCountOk++
      const validStart = shots.every(s => typeof s['开始时间 (s)'] === 'number' && s['开始时间 (s)'] >= 0)
      if (validStart) stats.startTimeOk++
      else problems.push('startTime 不是 number')
      const validEnd = shots.every(s => typeof s['结束时间 (s)'] === 'number' && s['结束时间 (s)'] > (s['开始时间 (s)'] || 0))
      if (validEnd) stats.endTimeGtStart++
      else problems.push('endTime <= startTime')
      const labelRe = /^\d{2}:\d{2}\.\d{3}$/
      const labelsOk = shots.filter(s => labelRe.test(s['时长标签'] || '')).length
      if (labelsOk === shots.length) stats.durationLabelOk++
      else if (labelsOk === 0) problems.push('无时长标签')
      const hasLongDesc = shots.some(s => (s['画面描述'] || '').length >= 60)
      if (hasLongDesc) stats.descLen++
      const hasLink = shots.some(s => s['关联的原视频'])
      if (hasLink) stats.mainLinked++
      else problems.push('无关联原视频')
    }
    if (main['时长显示']) stats.mainHasDurLabel++
    else problems.push('MAIN.时长显示 空')
    if (main['行业']) stats.mainHasIndustry++
    else problems.push('MAIN.行业 空')
    if (main['行业'] && (main['行业'].match(/>/g) || []).length >= 2) stats.industry3level++
    else problems.push('行业非 3 级')

    if (problems.length) issues.push({ fileName: fn, problems })
  }

  console.log('\n=== 质检结果 ===')
  console.log('总视频数:                ' + stats.total)
  console.log('有分镜:                  ' + stats.hasShots + ' (' + (stats.hasShots / stats.total * 100).toFixed(1) + '%)')
  console.log('分镜数合理 (1-12):       ' + stats.shotCountOk)
  console.log('startTime 是 number:     ' + stats.startTimeOk)
  console.log('endTime > startTime:     ' + stats.endTimeGtStart)
  console.log('时长标签 格式正确:       ' + stats.durationLabelOk)
  console.log('画面描述 ≥ 60 字:        ' + stats.descLen)
  console.log('有关联的原视频:          ' + stats.mainLinked)
  console.log('MAIN.时长显示 已填:      ' + stats.mainHasDurLabel)
  console.log('MAIN.行业 非空:          ' + stats.mainHasIndustry)
  console.log('MAIN.行业 3 级:          ' + stats.industry3level)

  console.log('\n=== 有问题的视频 (' + issues.length + ' 个) ===')
  for (const it of issues.slice(0, 30)) {
    console.log('  ✗ ' + it.fileName + ' → ' + it.problems.join(' / '))
  }
  if (issues.length > 30) console.log('  ... 还有 ' + (issues.length - 30) + ' 个')

  fs.writeFileSync('verify-report.json', JSON.stringify({ stats, issues, ts: Date.now() }, null, 2))
  console.log('\n报告已写入 verify-report.json')
})().catch(e => { console.error('致命:', e); process.exit(1) })
