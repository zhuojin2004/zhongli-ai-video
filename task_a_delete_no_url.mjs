// Task A: 列出并删除 51HDC 中「原视频地址」+「关联的原视频」都空的记录
import { config } from 'dotenv'
config({ path: '/Users/jensen/Downloads/zhongli-src/.env' })
const APP_ID = process.env.FEISHU_APP_ID
const APP_SECRET = process.env.FEISHU_APP_SECRET
const APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN
const SHOT_TABLE = 'tblJEJtnvP4Rtlno'

async function getToken() {
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  })
  return (await r.json()).tenant_access_token
}

const token = await getToken()
// 1) 拉全表
const all = []
let page = ''
while (true) {
  const u = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${SHOT_TABLE}/records?page_size=100${page ? '&page_token=' + page : ''}`
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } })
  const d = await r.json()
  all.push(...(d.data.items || []))
  if (!d.data.has_more) break
  page = d.data.page_token
}
console.log('Total in 分镜任务库:', all.length)

// 2) 找 51HDC 中两边都空的
const hdc = all.filter(it => {
  const pm = (it.fields || {})['产品型号'] || ''
  return String(pm).toLowerCase().includes('51hdc')
})
console.log('51HDC records:', hdc.length)

const noUrl = hdc.filter(it => {
  const f = it.fields || {}
  const orig = f['原视频地址'] || ''
  const link = f['关联的原视频']
  const hasLink = Array.isArray(link) && link[0] && link[0].record_ids && link[0].record_ids.length > 0
  return !orig && !hasLink
})
console.log('51HDC records with no source (will delete):', noUrl.length)
for (const r of noUrl) {
  const desc = (r.fields['画面描述'] || '').slice(0, 50)
  console.log(`  ${r.record_id} | ${r.fields['产品型号']} | ${desc}`)
}

// 3) 删
let ok = 0, fail = 0
for (const r of noUrl) {
  const u = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${SHOT_TABLE}/records/${r.record_id}`
  const res = await fetch(u, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
  const d = await res.json()
  if (d.code === 0) { ok++ } else { fail++; console.log(`  ✗ ${r.record_id}: ${d.msg}`) }
}
console.log(`\n=== Task A done: deleted ${ok}, failed ${fail} ===`)
