// 烟测：用最小的 1 个视频走通完整流程（OSS + AI + 写飞书 + 封面图）
const fs = require('fs')
const http = require('http')
const path = require('path')
require('dotenv').config?.() || null

// ─── env ───
const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const env = {}
for (const line of envRaw.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const APP_ID = env.FEISHU_APP_ID
const APP_SECRET = env.FEISHU_APP_SECRET
const APP_TOKEN = env.FEISHU_BITABLE_APP_TOKEN
const SHOT_TABLE = env.FEISHU_TABLE_ID
const FEISHU_BASE = env.VITE_LARK_BASE || 'https://open.feishu.cn'

const FormData = require('form-data')

async function getToken() {
  const r = await fetch(FEISHU_BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  }).then(r => r.json())
  return r.tenant_access_token
}

function uploadVideo(filePath, fileName) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath), fileName)
    const req = http.request({
      method: 'POST',
      hostname: 'localhost',
      port: 9099,
      path: '/api/upload',
      headers: {
        ...form.getHeaders(),
        // 中文 header 必须用 latin1 编码，否则 Node HTTP 模块会抛 ERR_INVALID_CHAR
        'x-uploader-name': Buffer.from('系统补同步', 'utf8').toString('latin1'),
        'x-uploader-role': 'admin',
      },
      timeout: 600000,
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const p = JSON.parse(data)
          if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + ': ' + (p.message || data).slice(0, 300)))
          else resolve(p)
        } catch (e) { reject(new Error('parse: ' + data.slice(0, 500))) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    form.pipe(req)
  })
}

async function queryShotsByFileName(token, fileName) {
  let token_p = ''
  const results = []
  do {
    const url = FEISHU_BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/records?page_size=500' + (token_p ? '&page_token=' + token_p : '')
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
    if (r.code !== 0) break
    for (const item of (r.data?.items || [])) {
      if (item.fields?.['视频文件名'] === fileName) results.push(item)
    }
    token_p = r.data?.page_token || ''
  } while (token_p)
  return results
}

;(async () => {
  const testFile = '/Users/jensen/Desktop/自动搬运车/机械制造业/RPG-卧龙.mp4'
  const fileName = path.basename(testFile)
  console.log('=== 烟测视频:', fileName, '(' + (fs.statSync(testFile).size / 1024 / 1024).toFixed(1) + ' MB) ===')

  // 先删除同名旧分镜（避免误判）
  const tk = await getToken()
  console.log('\n[1] 清理同名旧分镜...')
  let pageToken = ''
  let del = 0
  do {
    const url = FEISHU_BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/records?page_size=500' + (pageToken ? '&page_token=' + pageToken : '')
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk } }).then(r => r.json())
    if (r.code !== 0) break
    for (const it of (r.data?.items || [])) {
      if (it.fields?.['视频文件名'] === fileName) {
        const delR = await fetch(FEISHU_BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/records/' + it.record_id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tk } }).then(r => r.json())
        if (delR.code === 0) del++
      }
    }
    pageToken = r.data?.page_token || ''
  } while (pageToken)
  console.log('   删了', del, '条')

  // 上传
  console.log('\n[2] 上传 + AI 分析 + 写飞书...')
  const t0 = Date.now()
  const res = await uploadVideo(testFile, fileName)
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('   响应时间:', dt + 's')
  console.log('   返回:', JSON.stringify(res).slice(0, 500))

  // 拉分镜验证
  console.log('\n[3] 验证飞书 SHOT 表记录...')
  await new Promise(r => setTimeout(r, 3000)) // 给 Feishu 一点时间同步
  const shots = await queryShotsByFileName(tk, fileName)
  console.log('   写入分镜数:', shots.length)
  if (shots.length > 0) {
    console.log('\n[4] 多维度质检:')
    for (const s of shots.slice(0, 3)) {
      const f = s.fields || {}
      const startOK = typeof f['开始时间 (s)'] === 'number' && f['开始时间 (s)'] >= 0
      const endOK = typeof f['结束时间 (s)'] === 'number' && f['结束时间 (s)'] > f['开始时间 (s)']
      const descOK = (f['画面描述'] || '').length >= 60
      const labelOK = !!f['时长标签']
      const coverOK = !!f['封面图']
      console.log('   - shot_id=' + s.record_id)
      console.log('     时间 [' + f['开始时间 (s)'] + 's → ' + f['结束时间 (s)'] + 's]', startOK && endOK ? '✓' : '✗')
      console.log('     描述长度=' + (f['画面描述'] || '').length, descOK ? '✓' : '✗')
      console.log('     时长标签=' + f['时长标签'], labelOK ? '✓' : '✗')
      console.log('     封面图=' + (f['封面图'] ? f['封面图'].toString().slice(0, 80) : '(空)'), coverOK ? '✓' : '✗')
      console.log('     场景=' + (f['场景'] || '').slice(0, 50))
      console.log('     物体=' + (f['物体'] || '').slice(0, 50))
      console.log('     动作=' + (f['动作'] || '').slice(0, 50))
      console.log('     镜头=' + (f['镜头'] || '').slice(0, 50))
      console.log('     卖点=' + (f['卖点'] || '').slice(0, 50))
    }
  }
})().catch(e => { console.error('致命:', e); process.exit(1) })
