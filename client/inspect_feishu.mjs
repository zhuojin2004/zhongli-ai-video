import { config } from 'dotenv'
import { resolve } from 'node:path'
for (const p of ['.env.local', '.env']) {
  try { config({ path: resolve(process.cwd(), p) }) } catch (e) {}
}

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN
const SHOT_TABLE_ID = process.env.SHOT_TABLE_ID || 'tblJEJtnvP4Rtlno'

console.log('APP_ID:', FEISHU_APP_ID)
console.log('APP_TOKEN:', FEISHU_APP_TOKEN)
console.log('SHOT_TABLE:', SHOT_TABLE_ID)

if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !FEISHU_APP_TOKEN) {
  console.error('missing feishu env')
  process.exit(1)
}

const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
})
const tokenData = await tokenRes.json()
const token = tokenData.tenant_access_token
console.log('token OK:', tokenData.code === 0 ? 'yes' : 'no, ' + (tokenData.msg || ''))

const listRes = await fetch(
  'https://open.feishu.cn/open-apis/bitable/v1/apps/' + FEISHU_APP_TOKEN + '/tables/' + SHOT_TABLE_ID + '/records?page_size=20',
  { headers: { Authorization: 'Bearer ' + token } }
)
const listData = await listRes.json()
const items = (listData.data && listData.data.items) || []
console.log('Total fetched:', items.length)
if (listData.code !== 0) {
  console.error('Feishu error:', JSON.stringify(listData).slice(0, 300))
  process.exit(1)
}

const allKeys = new Set()
for (const it of items) for (const k of Object.keys(it.fields || {})) allKeys.add(k)
console.log('\n字段清单（' + allKeys.size + ' 个）:')
console.log([...allKeys].sort().join(', '))

const hdc = items.find(it => {
  const pm = (it.fields && it.fields['产品型号']) || ''
  return String(pm).toLowerCase().includes('51hdc')
})
const target = hdc || items[0]
if (target) {
  console.log('\n=== 样本 record_id=' + target.record_id + (hdc ? ' (51HDC 命中)' : ' (第一条)') + ' ===')
  for (const k of Object.keys(target.fields)) {
    const v = target.fields[k]
    const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200)
    console.log('  [' + k + ']')
    console.log('    ' + val)
  }
}
