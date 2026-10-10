// 第 3 次重试：剩下 9 个失败，用更长间隔避免撞 mock server
const fs = require('fs')
const path = require('path')
const http = require('http')
const FormData = require('form-data')

const CP = path.join(__dirname, 'batch-sync-checkpoint.json')
const VIDEO_DIR = '/Users/jensen/Desktop/自动搬运车'

const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const env = {}
for (const line of envRaw.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const APP = env.FEISHU_APP_ID
const SECRET = env.FEISHU_APP_SECRET
const APP_TOKEN = env.FEISHU_BITABLE_APP_TOKEN
const SHOT_TABLE = env.FEISHU_TABLE_ID
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

async function findLocalFile(fileName) {
  const dirs = fs.readdirSync(VIDEO_DIR)
  for (const d of dirs) {
    const p = path.join(VIDEO_DIR, d, fileName)
    if (fs.existsSync(p)) return p
  }
  return null
}

async function deleteOldShots(fileName) {
  const token = await getToken()
  let pt = '', del = 0
  do {
    const url = BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/records?page_size=500' + (pt ? '&page_token=' + pt : '')
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
    if (r.code !== 0) break
    for (const it of (r.data?.items || [])) {
      if (it.fields?.['视频文件名'] === fileName) {
        const dr = await fetch(BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/records/' + it.record_id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
        if (dr.code === 0) del++
      }
    }
    pt = r.data?.page_token || ''
  } while (pt)
  return del
}

function uploadVideo(filePath, fileName) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath), fileName)
    const req = http.request({
      method: 'POST', hostname: 'localhost', port: 9099, path: '/api/upload',
      headers: {
        ...form.getHeaders(),
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

;(async () => {
  const cp = JSON.parse(fs.readFileSync(CP, 'utf8'))
  const failedNames = Object.keys(cp.failed || {})
  console.log('[' + new Date().toLocaleTimeString() + '] 第 3 次重试 ' + failedNames.length + ' 个...')

  let ok = 0, fail = 0
  for (const fileName of failedNames) {
    const localPath = await findLocalFile(fileName)
    if (!localPath) { fail++; continue }
    console.log('  → ' + fileName)
    let attempts = 0
    while (attempts < 3) {
      attempts++
      try {
        const del = await deleteOldShots(fileName)
        if (del > 0) console.log('    删 ' + del + ' 条旧分镜')
        await uploadVideo(localPath, fileName)
        console.log('    ✓ 上传成功 (尝试 ' + attempts + ')')
        cp.processed[fileName] = { ok: true, at: Date.now(), retry: true }
        delete cp.failed[fileName]
        ok++
        break
      } catch (e) {
        console.log('    尝试 ' + attempts + ' 失败: ' + e.message.slice(0, 80))
        if (attempts >= 3) {
          cp.failed[fileName] = e.message.slice(0, 500)
          fail++
        } else {
          await new Promise(r => setTimeout(r, 5000))
        }
      }
    }
    fs.writeFileSync(CP, JSON.stringify(cp, null, 2))
    await new Promise(r => setTimeout(r, 8000))
  }
  console.log('\n完成: 成功=' + ok + ' 失败=' + fail)
})().catch(e => { console.error('致命:', e); process.exit(1) })
