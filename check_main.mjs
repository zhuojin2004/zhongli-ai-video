import { config } from 'dotenv'
config({ path: '/Users/jensen/Downloads/zhongli-src/.env' })
const APP_ID = process.env.FEISHU_APP_ID
const APP_SECRET = process.env.FEISHU_APP_SECRET
const APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN
const TABLE = process.env.FEISHU_MAIN_TABLE_ID
const t = (await (await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({app_id:APP_ID, app_secret:APP_SECRET})})).json()).tenant_access_token
const r = await fetch('https://open.feishu.cn/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TABLE + '/records?page_size=1', { headers: { Authorization: 'Bearer ' + t } })
const d = await r.json()
console.log('主视频表 total:', d.data?.total || 'N/A')
console.log('records returned:', d.data?.items?.length || 0)
if (d.data?.items?.[0]) {
  const f = d.data.items[0].fields
  console.log('sample fields:', Object.keys(f).join(', '))
  console.log('sample oss:', f['OSS 云端地址'] || '(空)')
}
