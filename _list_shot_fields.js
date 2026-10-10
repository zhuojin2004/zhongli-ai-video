// List SHOT table fields to verify 开始时间 / 结束时间 exist
const fs = require('fs')
const env = fs.readFileSync('.env', 'utf8')
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || ''
const APP = get('FEISHU_APP_ID')
const SECRET = get('FEISHU_APP_SECRET')
const APP_TOKEN = get('FEISHU_BITABLE_APP_TOKEN')
const SHOT_TABLE = get('FEISHU_TABLE_ID')
const BASE = get('VITE_LARK_BASE') || 'https://open.feishu.cn'

;(async () => {
  const tk = (await (await fetch(BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  })).json()).tenant_access_token
  const r = await fetch(
    BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/fields?page_size=100',
    { headers: { Authorization: 'Bearer ' + tk } }
  )
  const j = await r.json()
  if (j.code !== 0) { console.error(JSON.stringify(j, null, 2)); process.exit(1) }
  console.log('SHOT TABLE [' + SHOT_TABLE + '] ' + j.data.items.length + ' fields:')
  for (const f of j.data.items) {
    const name = String(f.field_name || '').padEnd(20)
    console.log('  [' + f.type + ']  ' + name + ' id=' + f.field_id)
  }
})().catch(e => { console.error(e); process.exit(1) })