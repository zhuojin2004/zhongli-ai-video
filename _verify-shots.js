// 验证批量同步是否真的写入了分镜
const fs = require('fs')
const env = fs.readFileSync('.env', 'utf8')
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || ''
const APP = get('FEISHU_APP_ID'); const SECRET = get('FEISHU_APP_SECRET')
const APP_TOKEN = get('FEISHU_BITABLE_APP_TOKEN')
const SHOT_TABLE = get('FEISHU_TABLE_ID')
const BASE = get('VITE_LARK_BASE') || 'https://open.feishu.cn'

;(async () => {
  const tk = await fetch(BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  }).then(r => r.json())
  const token = tk.tenant_access_token

  const samples = ['RPG-凯圣兰.mp4', 'RPG-凯顺.mp4', 'RPG-和泰.mp4', 'RPG-丰融.mp4', 'RPG-善源.mp4', 'RPG-大德玉.mp4']
  for (const fn of samples) {
    let pt = '', total = 0, withLabel = 0, withLink = 0, withStart = 0
    do {
      const url = BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/records?page_size=500' + (pt ? '&page_token=' + pt : '')
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
      if (r.code !== 0) break
      for (const it of (r.data?.items || [])) {
        if (it.fields?.['视频文件名'] === fn) {
          total++
          if (it.fields?.['时长标签']) withLabel++
          if (it.fields?.['关联的原视频']) withLink++
          if (typeof it.fields?.['开始时间 (s)'] === 'number') withStart++
        }
      }
      pt = r.data?.page_token || ''
    } while (pt)
    console.log(fn + ' → shots=' + total + ' 有时长标签=' + withLabel + ' 有startTime=' + withStart + ' 有关联=' + withLink)
  }
})()
