import { config } from 'dotenv'
import { resolve } from 'node:path'
for (const p of ['.env.local', '.env']) {
  try { config({ path: resolve(process.cwd(), p) }) } catch (e) {}
}

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN
const SHOT_TABLE_ID = process.env.SHOT_TABLE_ID || 'tblJEJtnvP4Rtlno'

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
if (tokenData.code !== 0) {
  console.error('token failed:', tokenData.msg)
  process.exit(1)
}

// 拉所有分镜（分页）
let all = []
let pageToken = ''
let page = 0
const fieldName = '人物姓名（如果有）'
const personCount = {}
const samples = {}
const emptyPersonCount = 0

do {
  const url = 'https://open.feishu.cn/open-apis/bitable/v1/apps/' + FEISHU_APP_TOKEN + '/tables/' + SHOT_TABLE_ID + '/records?page_size=500' + (pageToken ? '&page_token=' + pageToken : '')
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
  const data = await res.json()
  if (data.code !== 0) {
    console.error('page', page, 'error:', data.msg)
    break
  }
  const items = data.data?.items || []
  all = all.concat(items)
  pageToken = data.data?.page_token || ''
  page++
  if (page > 20) break  // 安全阈值
} while (pageToken)

console.log(`总共拉取 ${all.length} 条分镜记录`)
console.log('---')

let withName = 0
let emptyName = 0
const nameFreq = {}
for (const it of all) {
  const f = it.fields || {}
  const val = String(f[fieldName] || '').trim()
  if (!val) {
    emptyName++
    continue
  }
  withName++
  // 按多种分隔符 split
  const parts = val.split(/[,，、;\/]/).map(s => s.trim()).filter(Boolean)
  for (const p of parts) {
    nameFreq[p] = (nameFreq[p] || 0) + 1
    if (!samples[p]) {
      const fn = f['视频文件名'] || ''
      samples[p] = fn.split('/').pop()
    }
  }
}

console.log(`有 人物姓名：${withName} 条`)
console.log(`空 人物姓名：${emptyName} 条`)
console.log('---')
console.log(`独立姓名 token 数: ${Object.keys(nameFreq).length}`)
console.log('---')
console.log('Top 30:')
const sorted = Object.entries(nameFreq).sort((a, b) => b[1] - a[1])
for (const [n, c] of sorted.slice(0, 30)) {
  console.log(`  ${String(c).padStart(4)} × "${n}"  [样本: ${samples[n]}]`)
}

console.log('---')
// 启发式：长度<=4 且不含明显描述词的可能为真名
const realNames = sorted.filter(([n]) => {
  if (n.length > 4) return false
  if (/穿|戴|岁|男|女|站|坐|走|手|面|头|黑|白|灰|红|蓝|绿|黄|紫|粉|棕|讲解|介绍|主持|销售|店员|老板|经理|总监|领导|嘉宾|客户|人物|路人|小孩|婴儿|婴儿|戴眼镜|口罩|头盔|安全帽|工服|工装|围裙|西装|衬衫|外套|连衣裙|套装/.test(n)) return false
  return true
})
console.log(`启发式「真名」候选（长度≤4 且不含描述词）: ${realNames.length} 个`)
for (const [n, c] of realNames.slice(0, 30)) {
  console.log(`  ${String(c).padStart(4)} × "${n}"`)
}
