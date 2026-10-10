// 回填 MAIN 表的 时长显示 字段（封面图需要 Feishu file_token，无法用 OSS URL）
//   - tblHAulQSuPQyDfE = 主视频表（有时长显示 text + 封面图 attachment）
//   - tblEwFfTWRzrvBy4 = 用户表（用户提到的表，但只有 用户名/密码/姓名/角色）
//
// 如果用户表需要新增这两个字段，启用 ADD_TO_USER_TABLE=true
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
const USER_TABLE = env.FEISHU_USER_TABLE_ID
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

function formatCN(seconds) {
  if (!seconds || seconds <= 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return h + '小时' + m + '分' + s + '秒'
  if (m > 0) return m + '分' + s + '秒'
  return s + '秒'
}

async function listAllRecords(tableId) {
  const token = await getToken()
  let pt = '', all = []
  do {
    const url = BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/records?page_size=500' + (pt ? '&page_token=' + pt : '')
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
    if (r.code !== 0) throw new Error('list ' + tableId + ': ' + r.msg)
    all = all.concat(r.data?.items || [])
    pt = r.data?.page_token || ''
  } while (pt)
  return all
}

async function patchRecord(tableId, recordId, fields) {
  const token = await getToken()
  const r = await fetch(BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/records/' + recordId, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }).then(r => r.json())
  return r.code === 0
}

async function ensureField(tableId, fieldName, type) {
  const token = await getToken()
  const r = await fetch(BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/fields?page_size=100', {
    headers: { Authorization: 'Bearer ' + token },
  }).then(r => r.json())
  if (r.code !== 0) return false
  const exists = (r.data?.items || []).some(f => f.field_name === fieldName)
  if (exists) return true
  const cr = await fetch(BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/fields', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ field_name: fieldName, type }),
  }).then(r => r.json())
  if (cr.code === 0) {
    console.log('  ✓ 新建字段:', fieldName, '(type=' + type + ') field_id=' + cr.data.field.field_id)
    return true
  }
  console.error('  ✗ 新建字段失败:', fieldName, cr.msg)
  return false
}

;(async () => {
  console.log('[' + new Date().toLocaleTimeString() + '] 回填 MAIN.时长显示 ...')

  // 1) 列出 MAIN 表记录
  const mainRecords = await listAllRecords(MAIN_TABLE)
  console.log('主视频表共 ' + mainRecords.length + ' 条')

  let needFill = 0, ok = 0, fail = 0, skip = 0
  for (const rec of mainRecords) {
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
    const success = await patchRecord(MAIN_TABLE, rec.record_id, { '时长显示': label })
    if (success) { ok++; console.log('  ✓ ' + fn + ' → 时长显示="' + label + '" (' + dur + 's)') }
    else { fail++; console.error('  ✗ ' + fn) }
    if (needFill % 10 === 0) await new Promise(r => setTimeout(r, 500))
  }

  console.log('\nMAIN.时长显示 回填：需回填=' + needFill + ' 成功=' + ok + ' 失败=' + fail + ' 跳过=' + skip)

  // 2) MAIN.封面图：无法用 OSS URL 写入（需要 Feishu file_token），提示用户
  const needCover = mainRecords.filter(r => {
    const f = r.fields || {}
    return f['视频文件名'] && !f['封面图']
  }).length
  console.log('\nMAIN.封面图 字段：' + needCover + ' 条记录还没有封面图（需要 Feishu file_token，不能用 OSS URL）')

  // 3) 如果用户希望也给 tblEwFfTWRzrvBy4 加这两个字段（启用 ADD_TO_USER_TABLE）
  if (process.env.ADD_TO_USER_TABLE === 'true') {
    console.log('\n=== 给用户表 tblEwFfTWRzrvBy4 新增 封面图 + 时长显示 字段 ===')
    await ensureField(USER_TABLE, '时长显示', 1)              // SingleLineText
    await ensureField(USER_TABLE, '封面图', 17)               // Attachment
  } else {
    console.log('\n（如需给 tblEwFfTWRzrvBy4 也加这两个字段，运行：ADD_TO_USER_TABLE=true node _backfill.js）')
  }

  console.log('\n[' + new Date().toLocaleTimeString() + '] 全部完成')
})().catch(e => { console.error('致命:', e); process.exit(1) })
