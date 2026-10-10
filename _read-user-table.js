// 读用户新指向的表 tblEwFfTWRzrvBy4 的字段结构
const fs = require('fs')
const env = fs.readFileSync('.env', 'utf8')
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || ''
const APP = get('FEISHU_APP_ID')
const SECRET = get('FEISHU_APP_SECRET')
const APP_TOKEN = get('FEISHU_BITABLE_APP_TOKEN')
const BASE = get('VITE_LARK_BASE') || 'https://open.feishu.cn'

;(async () => {
  const tk = await fetch(BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  }).then(r => r.json())
  const token = tk.tenant_access_token

  const tid = 'tblEwFfTWRzrvBy4'
  const r = await fetch(BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tid + '/fields?page_size=100', {
    headers: { Authorization: 'Bearer ' + token },
  }).then(r => r.json())
  if (r.code !== 0) { console.error(r); return }
  console.log('=== TABLE ' + tid + ' 共 ' + r.data.items.length + ' 个字段 ===')
  for (const f of r.data.items) {
    console.log('  [' + f.type + ']\t' + f.field_name + '\t(field_id=' + f.field_id + ')')
  }
})()
