// 验证飞书 SHOT 表回填结果
const fs = require('fs')
const env = fs.readFileSync('.env', 'utf8')
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || ''
const APP = get('FEISHU_APP_ID')
const SECRET = get('FEISHU_APP_SECRET')
const APP_TOKEN = get('FEISHU_BITABLE_APP_TOKEN')
const SHOT_TABLE = get('FEISHU_TABLE_ID')
const FEISHU_BASE = get('VITE_LARK_BASE') || 'https://open.feishu.cn'

;(async () => {
  const tkRes = await fetch(FEISHU_BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  })
  const tkJ = await tkRes.json()
  const token = tkJ.tenant_access_token

  // 拉所有 SHOT 表记录
  const all = []
  let pageToken = ''
  while (true) {
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${SHOT_TABLE}/records?page_size=100${pageToken ? `&page_token=${pageToken}` : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json()
    if (j.code !== 0) { console.error('err:', j.msg); process.exit(1) }
    all.push(...(j.data?.items || []))
    if (!j.data?.has_more) break
    pageToken = j.data.page_token
  }
  console.log(`飞书 SHOT 表当前总记录数: ${all.length}`)

  // 按视频文件名分组
  const byFile = {}
  for (const r of all) {
    const fn = r.fields['视频文件名']
    if (typeof fn !== 'string') continue
    byFile[fn] = (byFile[fn] || 0) + 1
  }
  console.log('\n按视频文件名分组:')
  for (const [fn, count] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fn}: ${count} 条分镜`)
  }

  // 抽样看第一条记录的字段
  if (all.length > 0) {
    console.log('\n--- 第 1 条记录字段示例 ---')
    const sample = all[0]
    console.log('record_id:', sample.record_id)
    for (const [k, v] of Object.entries(sample.fields || {})) {
      let val = v
      if (Array.isArray(v)) val = `[array len=${v.length}]`
      else if (typeof v === 'string' && v.length > 50) val = v.slice(0, 50) + '...'
      console.log(`  ${k}: ${val}`)
    }
  }
})()