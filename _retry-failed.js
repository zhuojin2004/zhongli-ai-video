// 重试 batch-sync 失败的视频
// 读取 checkpoint.failed 列表，对每个文件重新调用 /api/upload
const fs = require('fs')
const path = require('path')
const http = require('http')
const FormData = require('form-data')

const CP = path.join(__dirname, 'batch-sync-checkpoint.json')
const AUDIT = path.join(__dirname, 'sync-audit.json')
const VIDEO_DIR = '/Users/jensen/Desktop/自动搬运车'
const MOCK_PORT = 9099

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
      method: 'POST', hostname: 'localhost', port: MOCK_PORT, path: '/api/upload',
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
  console.log('[' + new Date().toLocaleTimeString() + '] 重试 ' + failedNames.length + ' 个失败视频...')

  let ok = 0, fail = 0
  for (const fileName of failedNames) {
    const localPath = await findLocalFile(fileName)
    if (!localPath) {
      console.error('  ✗ 本地找不到:', fileName)
      cp.failed[fileName] = 'local file missing'
      fail++
      continue
    }
    try {
      console.log('  → ' + fileName + '  (从 ' + path.basename(path.dirname(localPath)) + '/)')
      const del = await deleteOldShots(fileName)
      console.log('    删 ' + del + ' 条旧分镜')
      await uploadVideo(localPath, fileName)
      console.log('    ✓ 上传成功')
      cp.processed[fileName] = { ok: true, at: Date.now(), retry: true }
      delete cp.failed[fileName]
      ok++
    } catch (e) {
      console.error('    ✗ 失败:', e.message.slice(0, 150))
      cp.failed[fileName] = e.message.slice(0, 500)
      fail++
    }
    fs.writeFileSync(CP, JSON.stringify(cp, null, 2))
    // 串行 + 短暂等待，避免再次撞上 mock server 限流
    await new Promise(r => setTimeout(r, 3000))
  }

  console.log('\n[' + new Date().toLocaleTimeString() + '] 重试完成：成功=' + ok + ' 失败=' + fail)
})().catch(e => { console.error('致命:', e); process.exit(1) })
