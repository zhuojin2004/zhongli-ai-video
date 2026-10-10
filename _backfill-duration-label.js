// 批量回填「飞书主视频表」的 时长显示 字段
// 格式：把 总时长 (s) (字符串如 "89.583") 转成 "1分29秒" 或 "01:29"
// 注意：MAIN.封面图 需要 Feishu file_token，跳过（OSS URL 不行）
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
const MAIN_TABLE = env.FEISHU_MAIN_TABLE_ID
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

// 把秒数格式化成两种格式
//   中文："1分29秒"（用于 时长显示 字段，肉眼友好）
//   mm:ss："01:29"（备用）
function formatCN(seconds) {
  if (!seconds || seconds <= 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return h + '分' + (m > 0 ? m + '分' : '') + s + '秒'
  if (m > 0) return m + '分' + s + '秒'
  return s + '秒'
}

async function listAllMainRecords() {
  const token = await getToken()
  let pt = '', all = []
  do {
    const url = BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + MAIN_TABLE + '/records?page_size=500' + (pt ? '&page_token=' + pt : '')
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
    if (r.code !== 0) throw new Error('list: ' + r.msg)
    all = all.concat(r.data?.items || [])
    pt = r.data?.page_token || ''
  } while (pt)
  return all
}

async function patchMainRecord(recordId, fields) {
  const token = await getToken()
  const r = await fetch(BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + MAIN_TABLE + '/records/' + recordId, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }).then(r => r.json())
  return r.code === 0
}

;(async () => {
  console.log('[' + new Date().toLocaleTimeString() + '] 开始回填 MAIN.时长显示 ...')
  const records = await listAllMainRecords()
  console.log('主视频表共 ' + records.length + ' 条')

  let needFill = 0, ok = 0, skip = 0, fail = 0
  for (const rec of records) {
    const f = rec.fields || {}
    const fn = f['视频文件名'] || ''
    const durStr = f['总时长 (s)'] || ''
    const dur = parseFloat(durStr) || 0
    const existing = String(f['时长显示'] || '').trim()

    if (!dur || dur <= 0) { skip++; continue }
    if (existing && existing === formatCN(dur)) { skip++; continue }
    if (!fn) { skip++; continue }

    needFill++
    const label = formatCN(dur)
    const success = await patchMainRecord(rec.record_id, { '时长显示': label })
    if (success) {
      ok++
      console.log('  ✓ ' + fn + ' → 时长显示="' + label + '" (' + dur + 's)')
    } else {
      fail++
      console.error('  ✗ ' + fn + ' PATCH 失败')
    }
    // 轻节流
    if (needFill % 10 === 0) await new Promise(r => setTimeout(r, 500))
  }

  console.log('\n[' + new Date().toLocaleTimeString() + '] 完成：需回填=' + needFill + ', 成功=' + ok + ', 失败=' + fail + ', 跳过=' + skip)
})().catch(e => { console.error('致命:', e); process.exit(1) })
