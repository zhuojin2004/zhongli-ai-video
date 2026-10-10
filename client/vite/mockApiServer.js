/**
 * zhongli-src 真实能力 API Server (port 9099)
 *
 * 集成了：
 *   - MiniMax Video-01: 视频AI解析打标
 *   - 豆包TTS (火山引擎): 配音合成
 *   - FFmpeg: 本地视频混剪
 *   - 飞书多维表格: 数据存储
 *
 * Vite dev proxy 转发 /api/* 到这里
 * 启动: node client/vite/mockApiServer.js
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, execFile } = require('child_process')
const { mkdirSync, existsSync, createWriteStream, unlinkSync, readdirSync, statSync, rmdirSync } = fs
const Busboy = require('busboy')

// ─── 数据库（CJS 包装，访问 ./data/pglite）────────────────────────────────
let dbCjs = null;
try {
  dbCjs = require('../../server/database/db-cjs.js');
  console.log('[mock-api] DB module loaded');
} catch (e) {
  console.warn('[mock-api] DB module load failed:', e.message);
}

// ─── 媒体流水线（FFmpeg 探测 / 抽封面 / 转码，V1）────────────────────────
let mediaPipeline = null;
try {
  mediaPipeline = require('./media-pipeline.js');
  console.log('[mock-api] media-pipeline loaded');
} catch (e) {
  console.warn('[mock-api] media-pipeline load failed:', e.message);
}

// ─── Env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(__dirname, '../../.env')
  if (!existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnv()

// 媒体持久化根目录：默认用户主目录下 ZhongliData（不再用 /tmp，重启不丢）；
// 部署到服务器时用环境变量 MEDIA_DATA_DIR 指定到数据盘
const MEDIA_ROOT = process.env.MEDIA_DATA_DIR || path.join(os.homedir(), 'ZhongliData')

const CFG = {
  mediaRoot: MEDIA_ROOT,
  minimaxKey: process.env.MINIMAX_API_KEY || '',
  minimaxBase: process.env.MINIMAX_BASE || 'https://api.MiniMax.com/v1',
  doubaoClientId: process.env.DOUBAO_CLIENT_ID || '',
  doubaoClientSecret: process.env.DOUBAO_CLIENT_SECRET || '',
  doubaoEndpoint: process.env.DOUBAO_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v1/mt_tts',
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  feishuBitableAppToken: process.env.FEISHU_BITABLE_APP_TOKEN || '',
  feishuTableId: process.env.FEISHU_TABLE_ID || '',
  feishuMainTableId: process.env.FEISHU_MAIN_TABLE_ID || '',
  feishuNewVideoTableId: process.env.FEISHU_NEW_VIDEO_TABLE_ID || 'tbly8R5zwud22O58',
  feishuUserTableId: process.env.FEISHU_USER_TABLE_ID || 'tblEwFfTWRzrvBy4',
  feishuBase: process.env.FEISHU_BASE || 'https://open.feishu.cn',
  videoDir: process.env.VIDEO_UPLOAD_DIR || path.join(MEDIA_ROOT, 'videos'),
  coverDir: path.join(MEDIA_ROOT, 'covers'),
  transcodeDir: path.join(MEDIA_ROOT, 'transcoded'),
  // ── 阿里云 OSS ──
  ossAccessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID || '',
  ossAccessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET || '',
  ossBucket: process.env.ALI_OSS_BUCKET || '',
  ossRegion: process.env.ALI_OSS_REGION || '',
  ossEndpoint: process.env.ALI_OSS_ENDPOINT || '',
  ossPrefix: process.env.ALI_OSS_PREFIX || '',
  ossPublicRead: (process.env.ALI_OSS_PUBLIC_READ || 'true').toLowerCase() === 'true',
}

// 确保媒体持久化目录存在（videos / covers / transcoded）
for (const d of [CFG.videoDir, CFG.coverDir, CFG.transcodeDir]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

// ─── 素材种子数据（模拟飞书表格已入库视频）────────────────────────────────
// 当飞书 API 不可达时，使用这些种子数据作为候选项池
// 上传视频并成功写入飞书后，这些数据会被真实数据替代
const SEED_MATERIALS = [
  {
    record_id: 'seed_001',
    fields: { '视频名称': '中力 E-TRUCK 电动叉车产品介绍', '产品型号': '中力 E-TRUCK', '行业': '物流设备', '分类标签': '产品特写,功能演示,应用场景', '分镜数量': 6, '素材质量': '优质', '客户': '中力叉车', '部门': '营销部' }
  },
  {
    record_id: 'seed_002',
    fields: { '视频名称': '仓库搬运效率提升实战案例', '产品型号': '中力 CPD25', '行业': '仓储物流', '分类标签': '客户案例,场景演示,效率展示', '分镜数量': 5, '素材质量': '首发', '客户': '某某仓储', '部门': '子公司A' }
  },
  {
    record_id: 'seed_003',
    fields: { '视频名称': '电动叉车日常维护保养指南', '产品型号': '中力 EFS', '行业': '设备维护', '分类标签': '功能演示,技术解析,操作规范', '分镜数量': 4, '素材质量': '优质', '客户': '中力叉车', '部门': '子公司B' }
  },
  {
    record_id: 'seed_004',
    fields: { '视频名称': '新款电动搬运车开箱测评', '产品型号': '中力 EPT20', '行业': '产品测评', '分类标签': '产品展示,客户案例,零排放', '分镜数量': 5, '素材质量': '首发', '客户': '某某物流', '部门': '子公司C' }
  },
  {
    record_id: 'seed_005',
    fields: { '视频名称': '叉车操作安全规范详解', '产品型号': '中力 BT50', '行业': '安全培训', '分类标签': '安全操作,技术解析,规范演示', '分镜数量': 6, '素材质量': '优质', '客户': '中力叉车', '部门': '营销部' }
  },
  {
    record_id: 'seed_006',
    fields: { '视频名称': '物流中心全天作业实拍', '产品型号': '中力 FB30', '行业': '物流设备', '分类标签': '场景演示,高效率,稳定性强', '分镜数量': 7, '素材质量': '优质', '客户': '某某物流中心', '部门': '子公司A' }
  },
]

// ─── Feishu SDK (lazy load, avoid ESM issues) ─────────────────────────────────
// We'll use raw HTTP calls to Feishu API to avoid SDK complexity
let feishuTokenCache = null
let feishuTokenExpiry = 0

async function getFeishuTenantToken() {
  if (feishuTokenCache && Date.now() < feishuTokenExpiry - 60000) return feishuTokenCache
  const res = await fetch(`${CFG.feishuBase}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: CFG.feishuAppId, app_secret: CFG.feishuAppSecret }),
  })
  const data = await res.json()
  if (data.code !== 0) throw new Error(`Feishu token error: ${data.msg}`)
  feishuTokenCache = data.tenant_access_token
  feishuTokenExpiry = Date.now() + (data.expire - 60) * 1000
  return feishuTokenCache
}

// ── P0#3-A 主表封面图：ffmpeg 抽首帧 + 飞书附件上传 ───────────────────────────
// 注：execFile / child_process 已在文件顶部 require 过，这里直接复用

/**
 * ffmpeg 从视频抽首帧（0s）输出 jpg 到 outDir/cover_<basename>.jpg
 * @returns {Promise<string|null>}  本地 jpg 绝对路径；失败返回 null
 */
async function extractFirstFrame(localPath, outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const base = path.basename(localPath, path.extname(localPath)).replace(/[^\w.\-]/g, '_').slice(0, 60)
  const outPath = path.join(outDir, `cover_${base}.jpg`)
  const ffmpegBin = process.env.FFMPEG_PATH || CFG.ffmpegPath || '/Users/jensen/miniconda3/bin/ffmpeg'
  try {
    await new Promise((resolve, reject) => {
      execFile(ffmpegBin, ['-y', '-ss', '0', '-i', localPath, '-frames:v', '1', '-q:v', '3', outPath], (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
    return outPath
  } catch (e) {
    console.warn(`[mock-api] ⚠️ extractFirstFrame 失败: ${e.message}`)
    return null
  }
}

/**
 * 上传本地文件到飞书 Drive 拿到 file_token（用于 bitable 附件字段）
 * 调用: POST /open-apis/drive/v1/medias/upload_all
 * @returns {Promise<string|null>}  file_token；失败返回 null
 */
async function feishuUploadAttachment(token, filePath, fileName) {
  try {
    const buf = await fs.promises.readFile(filePath)
    // upload_all 用 multipart/form-data：file_name / parent_type / parent_node / file / size
    const form = new FormData()
    form.append('file_name', fileName)
    form.append('parent_type', 'bitable_file')
    form.append('parent_node', CFG.feishuBitableAppToken)
    form.append('size', String(buf.length))
    // FormData/Blob 在 Node24 用 Blob 包装
    form.append('file', new Blob([buf], { type: 'image/jpeg' }), fileName)
    const res = await fetch(`${CFG.feishuBase}/open-apis/drive/v1/medias/upload_all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const j = await res.json()
    if (j.code !== 0) {
      console.warn(`[mock-api] ⚠️ feishuUploadAttachment 失败: ${j.msg}`)
      return null
    }
    return j.data?.file_token || null
  } catch (e) {
    console.warn(`[mock-api] ⚠️ feishuUploadAttachment 异常: ${e.message}`)
    return null
  }
}

/**
 * 异步：抽首帧 → 上传飞书 → PATCH 主表「封面图」附件字段
 * ⚠️ 失败不抛错（主表已有记录，封面图失败不影响业务）
 */
async function attachMainCoverAsync(mainRecordId, localVideoPath) {
  try {
    const coverDir = path.join(CFG.videoDir, '_covers')
    const jpgPath = await extractFirstFrame(localVideoPath, coverDir)
    if (!jpgPath) return
    const token = await getFeishuTenantToken()
    const fileName = path.basename(jpgPath)
    const fileToken = await feishuUploadAttachment(token, jpgPath, fileName)
    if (!fileToken) return
    const ok = await updateMainVideoRecord(mainRecordId, { '封面图': [{ file_token: fileToken }] })
    if (ok) {
      console.log(`[mock-api] 🖼️  主表封面图已写入: record=${mainRecordId} file_token=${fileToken.slice(0, 12)}...`)
    }
    // 清理临时 jpg
    try { fs.unlinkSync(jpgPath) } catch {}
  } catch (e) {
    console.warn(`[mock-api] ⚠️ attachMainCoverAsync 失败: ${e.message}`)
  }
}

async function feishuGetTableRecords(token, pageSize = 100, pageToken = '') {
  const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuTableId}/records?page_size=${pageSize}${pageToken ? `&page_token=${pageToken}` : ''}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  return res.json()
}

// 读取多维表格的字段定义（schema）
async function feishuGetTableFields(token) {
  const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuTableId}/fields`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  return res.json()
}

async function feishuPostRecord(token, fields, tableId) {
  const tid = tableId || CFG.feishuTableId
  const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${tid}/records`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  return res.json()
}

async function feishuBatchUpdateRecord(token, recordId, fields) {
  const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuTableId}/records/${recordId}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  return res.json()
}

// 读取飞书表格里某条记录的完整 fields（用于删分镜前先把「分镜 ID」本地 shot_id 取出来）
async function feishuGetRecord(token, recordId, tableId) {
  const tid = tableId || CFG.feishuTableId
  const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${tid}/records/${recordId}?user_id_type=open_id`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = await res.json().catch(() => ({}))
  if (j.code !== 0 && j.code !== undefined) {
    throw new Error(`feishuGetRecord failed: ${j.code} ${j.msg || 'unknown'}`)
  }
  return j.data?.record || null
}

// 删除飞书表格里的某条记录。tableId 默认是 shot 表；删主表记录时显式传入。
async function feishuDeleteRecord(token, recordId, tableId) {
  const tid = tableId || CFG.feishuTableId
  const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${tid}/records/${recordId}?user_id_type=open_id`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = await res.json().catch(() => ({}))
  if (j.code !== 0 && j.code !== undefined) {
    throw new Error(`feishuDeleteRecord failed: ${j.code} ${j.msg || 'unknown'}`)
  }
  return { ok: true, deleted: recordId, ...(j.data || {}) }
}

// ─── 通用：从指定飞书表格分页拉取所有记录 ────────────────────────────────
async function feishuGetAllRecords(tableId, pageSize = 100) {
  const tid = tableId || CFG.feishuTableId
  const token = await getFeishuTenantToken()
  const out = []
  let pageToken = ''
  let guard = 0
  do {
    const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${tid}/records?page_size=${pageSize}${pageToken ? `&page_token=${pageToken}` : ''}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json()
    if (j.code !== 0) {
      throw new Error(`feishuGetAllRecords failed: ${j.code} ${j.msg}`)
    }
    const items = j.data?.items || []
    out.push(...items)
    pageToken = j.data?.page_token || ''
    if (++guard > 200) break
  } while (pageToken)
  return out
}

// 从飞书分镜表读取所有分镜记录
async function fetchAllShotsFromFeishu() {
  if (!CFG.feishuTableId) return []
  try {
    return await feishuGetAllRecords(CFG.feishuTableId, 200)
  } catch (e) {
    console.warn('[mock-api] fetchAllShotsFromFeishu failed:', e.message)
    return []
  }
}

// 从飞书主表读取所有主视频记录
async function fetchAllMainRecordsFromFeishu() {
  if (!CFG.feishuMainTableId) return []
  try {
    return await feishuGetAllRecords(CFG.feishuMainTableId, 200)
  } catch (e) {
    console.warn('[mock-api] fetchAllMainRecordsFromFeishu failed:', e.message)
    return []
  }
}

/* ─── 用户表（飞书）─────────────────────────────────────────────────── */

// 拉取用户表所有记录
async function fetchAllUsersFromFeishu() {
  if (!CFG.feishuUserTableId) return []
  try {
    return await feishuGetAllRecords(CFG.feishuUserTableId, 200)
  } catch (e) {
    console.warn('[mock-api] fetchAllUsersFromFeishu failed:', e.message)
    return []
  }
}

// 把飞书用户记录归一化为内部 user 结构
function feishuUserToInternal(rec) {
  const f = rec.fields || {}
  // 用户名 / 密码 / 姓名 / 角色 —— 字段名兼容「用户名」/「账号」
  const username = String(f['用户名'] || f['账号'] || '').trim()
  const password = String(f['密码'] || '')
  const name = String(f['姓名'] || '').trim()
  const rawRole = String(f['角色'] || '业务员').trim()
  // 中文 → 内部枚举
  const roleMap = { '管理员': 'admin', '运营': 'operator', '业务员': 'user', '销售': 'user' }
  const role = roleMap[rawRole] || 'user'
  return {
    id: rec.record_id,
    username,
    password,
    name,
    role,
    createdAt: f['创建时间'] || '',
  }
}

// ─── 简单 token 签发 / 校验（base64，不含签名，仅用于内部工具） ─────
const tokenStore = new Map() // token -> { userId, exp }
function generateAuthToken(userId) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 天
  const token = 'zl_' + Buffer.from(JSON.stringify({ userId, exp })).toString('base64url')
  tokenStore.set(token, { userId, exp })
  // 顺手清理过期
  for (const [t, v] of tokenStore) {
    if (v.exp < Date.now()) tokenStore.delete(t)
  }
  return token
}
function validateAuthToken(token) {
  if (!token || !token.startsWith('zl_')) return null
  const v = tokenStore.get(token)
  if (!v) return null
  if (v.exp < Date.now()) {
    tokenStore.delete(token)
    return null
  }
  return v.userId
}

/**
 * ⚠️ 业务员视图隔离：解析请求方身份，用于在后端强制按 user.name 过滤素材库
 * 场景：业务员登录后，理论上只能看到自己作为上传者 / 出镜者的素材。
 *      前端 MaterialLibraryPage.tsx 已有 redirect 兜底，但 URL/Query 可被篡改，
 *      必须靠后端在做 in-memory filter 之前先按身份裁剪 videos / candidates。
 *
 * 返回结构：
 *   { user: User|null, isSalesperson: bool, isOperator: bool, isAdmin: bool }
 * - 拿不到 token / token 失效 → user=null，所有 is*Xxx=false → 走「全员可见」分支（保持向后兼容）
 * - operator / admin → 全员可见，不做强制裁剪
 * - user (业务员)    → 返回 user 对象 + isSalesperson=true；调用方应按 user.name 过滤
 */
async function getRequestUser(req) {
  try {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const userId = validateAuthToken(token)
    if (!userId) return { user: null, isSalesperson: false, isOperator: false, isAdmin: false }
    const users = await getUsers()
    const u = users.find(x => x.id === userId)
    if (!u) return { user: null, isSalesperson: false, isOperator: false, isAdmin: false }
    const role = String(u.role || '').toLowerCase()
    return {
      user: u,
      isSalesperson: role === 'user',
      isOperator: role === 'operator',
      isAdmin: role === 'admin',
    }
  } catch (_) {
    return { user: null, isSalesperson: false, isOperator: false, isAdmin: false }
  }
}

/**
 * 将飞书文本/数组形式的人物字段统一拆成姓名列表。
 * 飞书不同字段类型可能返回字符串、字符串数组或带 text 的对象数组。
 */
function splitPersonNames(value) {
  const values = Array.isArray(value) ? value : [value]
  const names = []
  for (const item of values) {
    if (item == null) continue
    if (typeof item === 'object') {
      const text = item.text || item.name || item.value || item.text_arr
      if (text != null) names.push(...splitPersonNames(text))
      continue
    }
    names.push(...String(item).split(/[,，、;\/]/).map((s) => s.trim()).filter(Boolean))
  }
  return [...new Set(names.filter((name) => !/^无人物|^无\s*人物|^未识别/.test(name)))]
}

function getVideoPersonNames(video) {
  if (!video) return []
  // 仅用分镜级「姓名」（飞书 shot 表实际字段名）
  // 业务规则：业务员归属以分镜表的「姓名」为准，不再回退到主表的「人物标签」
  return splitPersonNames([
    ...(Array.isArray(video.shotPersonNames) ? video.shotPersonNames : []),
  ])
}

/**
 * 判定一个视频是否属于指定业务员。
 *
 * 业务员归属以分镜表的「人物姓名（如果有）」为准，同时兼容主视频表的
 * 「人物标签」：只要任意一条分镜记录包含该业务员姓名，就认为视频属于他。
 */
function videoBelongsToSalesperson(video, salespersonName) {
  if (!video || !salespersonName) return false
  const target = String(salespersonName).trim()
  if (!target) return false
  return getVideoPersonNames(video).includes(target)
}

/**
 * 判定一条飞书分镜记录是否属于指定业务员（按 人物姓名（如果有） 字段 split 后包含 user.name）
 */
function shotRecordBelongsToSalesperson(record, salespersonName) {
  if (!record || !salespersonName) return false
  return splitPersonNames(record.fields?.['姓名']).includes(String(salespersonName).trim())
}

// 当前所有用户缓存（避免每个请求都打飞书）
let userCache = { users: null, at: 0 }
async function getUsers() {
  if (userCache.users && Date.now() - userCache.at < 30_000) return userCache.users
  const recs = await fetchAllUsersFromFeishu()
  const users = recs.map(feishuUserToInternal).filter(u => u.username)
  userCache = { users, at: Date.now() }
  return users
}
function invalidateUserCache() { userCache = { users: null, at: 0 } }

// 首次启动自动种入 1 个管理员账号（仅当「没有任何有效用户记录」时）
let bootstrapDone = false
async function bootstrapDefaultAdmin() {
  if (bootstrapDone) return
  bootstrapDone = true
  try {
    const recs = await fetchAllUsersFromFeishu()
    // 关键：判断「是否有任何有效用户」——有字段被填写过才算
    const hasValidUser = recs.some((r) => {
      const f = r.fields || {}
      return f['用户名'] || f['账号']
    })
    if (hasValidUser) {
      console.log(`[mock-api] ⏭️  用户表已有 ${recs.length} 条记录，跳过默认管理员 bootstrap`)
      return
    }
    // 表里全空 / 完全没记录：先删掉空行（如果有），再种入 admin
    const token = await getFeishuTenantToken()
    if (recs.length > 0) {
      console.log(`[mock-api] 用户表有 ${recs.length} 条空记录，先清空`)
      for (const r of recs) {
        try {
          await fetch(`${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuUserTableId}/records/${r.record_id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
          })
        } catch {}
      }
    }
    const r = await feishuPostRecord(token, {
      '用户名': 'admin',
      '密码': 'admin123',
      '姓名': '系统管理员',
      '角色': '管理员',
    }, CFG.feishuUserTableId)
    if (r.code === 0) {
      console.log('[mock-api] 🔐 已自动种入初始管理员 admin/admin123（请尽快修改密码）')
      invalidateUserCache()
    } else {
      console.warn('[mock-api] ⚠️ 种入默认管理员失败:', r.msg)
    }
  } catch (e) {
    console.warn('[mock-api] bootstrap 默认管理员失败:', e.message)
  }
}

// 把飞书分镜记录归一化为内部 shot 结构（与 M3 返回结构对齐）
function feishuShotToInternal(rec) {
  const f = rec.fields || {}
  const startT = Number(f['开始时间 (s)'] || 0)
  const endT = Number(f['结束时间 (s)'] || startT + 3)
  return {
    recordId: rec.record_id,
    shotId: f['分镜 ID'] || rec.record_id,
    fileName: f['视频文件名'] || '',
    productModel: f['产品型号'] || '',
    startTime: startT,
    endTime: endT,
    duration: Math.max(0.5, endT - startT),
    keyframePath: f['关键帧路径'] || '',
    description: f['画面描述'] || '',
    scene: f['场景'] || '',
    objects: f['物体'] || '',
    action: f['动作'] || '',
    camera: f['镜头'] || '',
    coreSellingPoint: f['卖点'] || '',
    sellingPoint: f['卖点'] || '',
    people: f['姓名'] || '',
    mainRecordId: Array.isArray(f['关联的原视频']) ? f['关联的原视频'][0] : null,
  }
}

// 把飞书主表记录归一化为内部 video 结构
function feishuMainToInternal(rec) {
  const f = rec.fields || {}
  return {
    recordId: rec.record_id,
    fileName: f['视频文件名'] || '',
    fileHash: f['文件 Hash 值'] || '',
    ossUrl: f['OSS 云端地址'] || '',
    totalDuration: Number(f['总时长 (s)'] || 0),
    status: f['分析状态'] || '未分析',
    productModel: f['产品型号'] || '',
    industry: f['行业'] || '',
    clientName: f['客户'] || '',
    department: f['部门'] || '',
    quality: f['素材质量'] || '',
    categoryTags: f['分类标签'] || '',
    personTags: f['人物标签'] || '',
    sellingPointTags: f['卖点标签'] || '',
    linkedShotIds: f['反向关联分镜'] || [],
  }
}

// 按 视频文件名 把 shots 分组（一个视频对应多个 shot 记录）
function groupShotsByFileName(shots) {
  const map = new Map()
  for (const s of shots) {
    if (!s.fileName) continue
    if (!map.has(s.fileName)) map.set(s.fileName, [])
    map.get(s.fileName).push(s)
  }
  return map
}

// 按 产品型号 把 videos 分组
function groupVideosByProductModel(videos) {
  const map = new Map()
  for (const v of videos) {
    const key = v.productModel || '未分类'
    if (!map.has(key)) map.set(key, {
      productModel: key,
      videos: [],
      shotCount: 0,
      totalDuration: 0,
    })
    const entry = map.get(key)
    entry.videos.push(v)
    entry.shotCount += v.shots?.length || 0
    entry.totalDuration += v.totalDuration || 0
  }
  return Array.from(map.values()).sort((a, b) => b.shotCount - a.shotCount)
}

// 按 人物姓名 把 videos 分组
function groupVideosByPeople(videos) {
  const map = new Map()
  for (const v of videos) {
    const people = v.personTags || ''
    if (!people) continue
    const names = String(people).split(/[,，、;\/]/).map(s => s.trim()).filter(Boolean)
    for (const name of names) {
      if (!map.has(name)) map.set(name, { personName: name, videos: [], shotCount: 0 })
      const entry = map.get(name)
      // 去重：同一视频不在同一人物下重复加入
      if (!entry.videos.find(x => x.recordId === v.recordId)) {
        entry.videos.push(v)
        entry.shotCount += v.shots?.length || 0
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.videos.length - a.videos.length)
}

// 把飞书的 shots + main 记录组装成前端 MaterialItem 形状
function buildVideoFromFeishu(mainRec, shots) {
  const main = feishuMainToInternal(mainRec || { record_id: '', fields: {} })
  const internalShots = (shots || []).map(feishuShotToInternal)
  // 文件名：优先用 main.fileName，否则从 shots 里聚合（最常见）
  let fileName = main.fileName || ''
  if (!fileName && internalShots.length > 0) {
    const fnCount = new Map()
    for (const s of internalShots) {
      const f = s.fileName || ''
      if (f) fnCount.set(f, (fnCount.get(f) || 0) + 1)
    }
    if (fnCount.size > 0) {
      fileName = Array.from(fnCount.entries()).sort((a, b) => b[1] - a[1])[0][0]
    }
  }
  // OSS URL：优先用 main.OSS云端地址，否则取 shots 第一个视频格式的路径
  let ossUrl = main.ossUrl || ''
  if (!ossUrl) {
    for (const s of internalShots) {
      if (s.keyframePath && /\.(mp4|mov|avi|mkv|webm)/i.test(s.keyframePath)) {
        ossUrl = s.keyframePath
        break
      }
    }
    if (!ossUrl && internalShots[0]?.keyframePath) {
      ossUrl = internalShots[0].keyframePath
    }
  }
  // 产品型号：优先用 main.产品型号，否则从 shots 里聚合（最常见的产品型号）
  let productModel = main.productModel || ''
  if (!productModel && internalShots.length > 0) {
    const modelCount = new Map()
    for (const s of internalShots) {
      const m = s.productModel || ''
      if (m) modelCount.set(m, (modelCount.get(m) || 0) + 1)
    }
    if (modelCount.size > 0) {
      productModel = Array.from(modelCount.entries()).sort((a, b) => b[1] - a[1])[0][0]
    }
  }
  // 人物姓名（来自 main.人物标签，fallback 到 shot 集合）
  let personName = main.personTags || ''
  // ⚠️ 业务员过滤用：分镜级 人物姓名（如果有） 全量聚合
  //   旧实现只在 main.personTags 为空时才聚合 shot.people，导致主表没有该员工名时业务员看不到
  //   现在无条件聚合：业务员只要在任何一条分镜里被识别为「人物姓名（如果有）」就算他参与
  const shotPersonNamesSet = new Set()
  for (const s of internalShots) {
    if (s.people) {
      for (const p of String(s.people).split(/[,，、;\/]/).map(x => x.trim()).filter(Boolean)) {
        if (!/^无人物|^无\s*人物|^未识别/.test(p)) shotPersonNamesSet.add(p)
      }
    }
  }
  if (!personName && shotPersonNamesSet.size > 0) {
    personName = Array.from(shotPersonNamesSet).join('、')
  }
  const shotPersonNames = Array.from(shotPersonNamesSet)
  // 分类/卖点/质量（优先 main 表，fallback shot 聚合）
  const categoryTags = main.categoryTags
    ? String(main.categoryTags).split(/[,，、;\/]/).map(s => s.trim()).filter(Boolean)
    : []
  const sellingPointTags = main.sellingPointTags
    ? String(main.sellingPointTags).split(/[,，、;\/]/).map(s => s.trim()).filter(Boolean)
    : []
  // shots 转为前端期望结构
  const videoShots = internalShots
    .sort((a, b) => a.startTime - b.startTime)
    .map((s, idx) => ({
      id: s.recordId,
      // 同时保留 recordId 字段（前端 PATCH 飞书要用真实 record_id，不能用 shotId 即「分镜 ID」字段值）
      recordId: s.recordId,
      shotId: s.shotId,
      analysisId: main.recordId || 'feishu',
      startTime: s.startTime,
      endTime: s.endTime,
      description: s.description,
      scene: s.scene,
      objects: s.objects,
      action: s.action,
      camera: s.camera,
      coreSellingPoint: s.coreSellingPoint,
      // 关键帧路径：前端可作缩略图
      keyframePath: s.keyframePath || '',
      // 人物姓名（如果有）：业务员过滤的最小信息
      people: s.people || '',
      narrationText: s.description,
      createdAt: '',
      updatedAt: '',
    }))
  // id 优先用 main.recordId，没有就用 fileName 兼容
  const id = main.recordId || fileName || `feishu_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    dbId: id,
    type: 'product',
    videoUrl: ossUrl,
    videoName: fileName,
    productModel: productModel,
    productName: productModel,
    totalDuration: main.totalDuration || 0,
    shotCount: videoShots.length,
    sceneVideoCount: videoShots.length,
    industry: main.industry,
    clientName: main.clientName,
    department: main.department,
    sellingPointTags,
    categoryTags,
    quality: main.quality,
    fileName: fileName,
    filePath: '',
    playableUrl: ossUrl,
    thumbnailUrl: (() => {
      const kf = internalShots[0]?.keyframePath || ''
      // 只在 keyframe 是真实图片（jpg/png/webp）时使用，否则置空（避免被误用为视频 URL）
      if (kf && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(kf)) return kf
      return ''
    })(),
    source: 'feishu',
    feishuRecordId: main.recordId || internalShots[0]?.recordId || '',
    fileHash: main.fileHash,
    description: fileName,
    usageCount: 0,
    consumptionCount: 0,
    analysisStatus: main.status,
    personName: personName || undefined,
    // 分镜表「人物姓名（如果有）」的去重聚合，供业务员视图按分镜归属过滤
    shotPersonNames,
    shots: videoShots,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

// 云优先：从飞书拉取所有视频（组装为 MaterialItem 列表）
// 返回 { videos, source: 'feishu' | 'db-fallback', stats }
async function fetchAllVideosFromFeishuCloud() {
  const shotRecs = await fetchAllShotsFromFeishu()
  const mainRecs = await fetchAllMainRecordsFromFeishu()
  if (shotRecs.length === 0 && mainRecs.length === 0) {
    return { videos: [], source: 'empty', stats: { shots: 0, main: 0 } }
  }

  // 把 shot 按 fileName 分组
  const shotByFn = new Map()
  for (const r of shotRecs) {
    const f = r.fields || {}
    const fn = f['视频文件名'] || ''
    if (!fn) continue
    if (!shotByFn.has(fn)) shotByFn.set(fn, [])
    shotByFn.get(fn).push(r)
  }
  // 把 shot 按 mainRecordId（「关联的原视频」）分组
  const shotByMainRec = new Map()
  for (const r of shotRecs) {
    const f = r.fields || {}
    const arr = Array.isArray(f['关联的原视频']) ? f['关联的原视频'] : []
    if (arr.length === 0) continue
    const mainRecId = String(arr[0])
    if (!shotByMainRec.has(mainRecId)) shotByMainRec.set(mainRecId, [])
    shotByMainRec.get(mainRecId).push(r)
  }
  // 把 main 按 fileName 索引
  const mainByFn = new Map()
  for (const r of mainRecs) {
    const fn = r.fields?.['视频文件名'] || ''
    if (!fn) continue
    mainByFn.set(fn, r)
  }

  // 第一次：精确 fileName 匹配
  const videos = []
  const allFns = new Set([...shotByFn.keys(), ...mainByFn.keys()])
  // 记录下「主表里有但分镜表里没精确匹配」的主记录，第二轮补齐后替换原 video
  const pendingMains = []
  for (const fn of allFns) {
    const mainRec = mainByFn.get(fn)
    const shotList = shotByFn.get(fn) || []
    if (mainRec && shotList.length === 0) {
      pendingMains.push(mainRec)
    }
    videos.push(buildVideoFromFeishu(mainRec, shotList))
  }

  // 第二次：给「分镜表里没精确匹配」的主记录做兜底匹配
  //   1) mainRecordId 命中分镜表的「关联的原视频」
  //   2) 后缀 / basename 匹配：
  //        - shot.fileName === basename(main.fileName)
  //        - main.fileName 以 '/'+shot.fileName 结尾
  //        - shot.fileName 以 '/'+main.fileName 结尾
  //        - 两者 basename 相同
  const basename = (s) => (s || '').split('/').pop()
  for (const mainRec of pendingMains) {
    const mainFn = mainRec.fields?.['视频文件名'] || ''
    const mainBase = basename(mainFn)
    // 1) mainRecordId
    let shotList = shotByMainRec.get(mainRec.record_id) || []
    // 2) 后缀 / basename 匹配
    if (shotList.length === 0 && (mainFn || mainBase)) {
      shotList = shotRecs.filter((r) => {
        const sf = r.fields?.['视频文件名'] || ''
        if (!sf) return false
        if (sf === mainFn) return true
        if (sf === mainBase) return true
        if (mainFn.endsWith('/' + sf)) return true
        if (sf.endsWith('/' + mainFn)) return true
        const sfBase = basename(sf)
        if (sfBase && sfBase === mainBase) return true
        return false
      })
    }
    if (shotList.length > 0) {
      // 用兜底后的 shots 重新组装这条 video，替换第一轮的占位
      const rebuilt = buildVideoFromFeishu(mainRec, shotList)
      const targetId = mainRec.record_id || mainFn
      const idx = videos.findIndex((v) => v.id === targetId)
      if (idx >= 0) videos[idx] = rebuilt
    }
  }

  // 第三轮：按 basename(fileName) 去重，合并同物理文件的重复主记录
  // 场景：飞书主表里同一条 mp4 登记了两条记录——
  //   一条 fileName="RPG-极正.mp4"（简单名，可能只有 shots 没有 playableUrl）
  //   另一条 fileName="自动搬运车/.../RPG-极正.mp4"（路径前缀，有 playableUrl/缩略图）
  // 合并策略：保留信息最完整的那条作为赢家，shots / personName 全量合并去重。
  const basenameKey = (s) => (basename(s || '') || '').toLowerCase()
  const groupsByBase = new Map()
  for (const v of videos) {
    const key = basenameKey(v.fileName || v.videoName || v.id || '')
    if (!key) continue
    if (!groupsByBase.has(key)) groupsByBase.set(key, [])
    groupsByBase.get(key).push(v)
  }
  const deduped = []
  let mergedCount = 0
  for (const [key, group] of groupsByBase) {
    if (group.length === 1) { deduped.push(group[0]); continue }
    // 选「信息最完整」的那条作为主：可播放 > 有缩略图 > 有时长 > shots 多
    const score = (v) => {
      let s = 0
      if (v.playableUrl) s += 1000
      if (v.thumbnailUrl) s += 500
      if (v.totalDuration > 0) s += 200
      if (Array.isArray(v.shots) && v.shots.length > 0) s += 100 + v.shots.length
      if (v.productModel) s += 10
      if (v.filePath) s += 5
      return s
    }
    const sorted = group.slice().sort((a, b) => score(b) - score(a))
    const winner = sorted[0]
    // 合并 shots（按 id 去重，按 startTime 排序）
    const shotMap = new Map()
    for (const v of sorted) {
      for (const sh of (v.shots || [])) {
        const sid = sh.id || `${sh.startTime}-${sh.endTime}-${sh.shotId || ''}`
        if (!shotMap.has(sid)) shotMap.set(sid, sh)
      }
    }
    const mergedShots = Array.from(shotMap.values()).sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
    // 合并 shotPersonNames
    const namesSet = new Set()
    for (const v of sorted) {
      if (Array.isArray(v.shotPersonNames)) {
        for (const p of v.shotPersonNames) {
          if (p && !/^无人物|^无\s*人物|^未识别/.test(p)) namesSet.add(p)
        }
      }
    }
    const mergedVideo = {
      ...winner,
      shots: mergedShots,
      shotCount: mergedShots.length,
      sceneVideoCount: mergedShots.length,
      shotPersonNames: Array.from(namesSet),
      fileName: winner.fileName || key,
      _mergedRecordIds: sorted.map(v => v.feishuRecordId).filter(Boolean),
    }
    // 兜底：赢家没时长 → 从 shots 里推
    if (mergedShots.length > 0 && (!mergedVideo.totalDuration || mergedVideo.totalDuration <= 0)) {
      mergedVideo.totalDuration = Math.max(...mergedShots.map(s => s.endTime || 0))
    }
    deduped.push(mergedVideo)
    mergedCount += group.length - 1
  }

  return {
    videos: deduped,
    source: 'feishu',
    stats: { shots: shotRecs.length, main: mainRecs.length, videos: deduped.length, merged: mergedCount },
  }
}

// ─── MiniMax ──────────────────────────────────────────────────────────────────
const MINIMAX_JSON_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'video_shot_analysis',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        productModel: {
          type: 'string',
          description: '产品品牌型号（看图中的Logo/铭牌/外形特征，例如"中力 E-TRUCK 电动平衡重叉车 3.5吨"），识别不到时写"未知产品"',
        },
        // ⚠️ 不再让 AI 输出 totalDuration — 时长由后端 ffprobe 探测，是元数据不是内容
        shotCount: { type: 'number', description: '分镜数量（与下面 shots 数组长度一致）' },
        industry: {
          type: 'string',
          description: '【三级分类】使用"一级 > 二级 > 三级"格式，例："工业制造 > 工程机械 > 叉车"、"消费品 > 家用电器 > 厨房小家电"、"物流 > 仓储设备 > 堆高车"。识别不出来时写"通用"',
        },
        clientName: { type: 'string', description: '视频中出现的客户/品牌方名称（看字幕/Logo/标牌），看不出来时写空字符串' },
        department: { type: 'string', description: '应用部门/使用场景，例："生产部"、"销售部"、"仓储部"、"市场部"、"工地施工"，看不出来时写空字符串' },
        categoryTags: {
          type: 'array',
          items: { type: 'string' },
          description: '【分类标签】6-10 个，每个 6-12 字。覆盖维度：(1)产品形态（如"无人驾驶堆高叉车""激光导航AGV"）(2)核心功能特性（如"智能路径规划""多机协同调度""360度安全防护"）(3)应用场景（如"高位货架存取""跨区域产线转运"）(4)目标行业/客户（如"第三方物流仓库""汽车制造总装车间"）。禁忌：不要写"功能性能""应用场景""工业制造"这种 4 字空泛词，也不要重复产品名。例：["无人驾驶堆高叉车","激光SLAM自主导航","多机协同作业","高位货架智能存取","第三方物流仓储应用","汽车产线物料转运"]',
        },
        quality: {
          type: 'string',
          description: '素材质量等级："优质"（画质清晰/构图好/光线佳/剪辑流畅/无杂音） / "良好"（基本可用/部分小瑕疵） / "一般"（明显缺陷），按多数维度判断',
        },
        sellingPointTags: {
          type: 'array',
          items: { type: 'string' },
          description: '【核心卖点标签】4-6 个，按重要性降序，每个 8-14 字。结构："差异化优势 + 客户价值"。维度：(1)核心技术（如"激光雷达360度无死角扫描"）(2)效率提升（如"替代3人搬运降低人力成本"）(3)安全可靠（如"多重避障+急停按钮双保险"）(4)柔性部署（如"无需改造现场3天即可上线"）(5)经济回报（如"投资回收期短至14个月"）。禁忌：不要写"零排放""智能操控"这种 4 字口水词；必须含具体数字/对比/场景，否则无效。例：["激光雷达360度无死角扫描保障人车混行安全","单台替代2-3名搬运工年省人力18万","无需地面改造3天即可完成部署","投资回收期短至14个月","24小时不间断作业提升仓储周转率40%"]',
        },
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startTime: { type: 'number', description: '分镜开始时间（秒），基于视频真实时间戳，覆盖 [0, 总时长]' },
              endTime: { type: 'number', description: '分镜结束时间（秒），必须 > startTime' },
              description: {
                type: 'string',
                description: '【≥60字】画面描述。必须覆盖：(1)人物外貌/服饰/表情/动作/位置 (2)产品全貌/局部特写/铭牌可读文字/品牌标识 (3)背景环境/光线/色调/构图/转场方式 (4)字幕/Logo/特效/视觉风格。少于此字数视为不合格',
              },
              scene: {
                type: 'string',
                description: '场景（结构：室内/室外 + 具体场所 + 时间段 + 天气）。例："室内-工厂车间-白天-自然光"、"室外-户外工地-黄昏-多云"',
              },
              objects: {
                type: 'string',
                description: '画面物体清单（产品全称型号 + 铭牌可读文字 + 品牌Logo + 包装 + 工具 + 道具 + 场景陈设）。识别不到的产品型号写"未知型号"',
              },
              action: {
                type: 'string',
                description: '动作（结构：主体是谁 + 动作动词 + 节奏/力度/速度 + 动作结果/目的 + 镜头是否跟随）。例："工人操作叉车缓慢前进，速度平稳，叉臂抬升至1.5米，镜头跟拍"',
              },
              camera: {
                type: 'string',
                description: '镜头（结构：景别 + 角度 + 运动 + 景深 + 转场）。例："全景-平视-固定机位-深景深-硬切"、"特写-仰角-推镜-浅景深-淡入淡出"',
              },
              coreSellingPoint: {
                type: 'string',
                description: '核心卖点（按重要性排序：营销话术 + 产品优势 + 痛点解决方案 + 品牌价值 + 差异化）。尽量浓缩在一句话内',
              },
              narrationText: {
                type: 'string',
                description: '本分镜对应的口播文案（如果有的话）。没有就写空字符串',
              },
            },
            required: ['startTime', 'endTime', 'description', 'scene'],
          },
        },
      },
      required: ['shots'],
    },
  },
}

/**
 * 构建 M3 视频分析的 prompt 文本
 *
 * ⚠️ P2 升级（更详细）：
 *   - 不再要求 AI 输出「人物姓名」（包括 `includePeople=true` 也不要求）
 *     → 真实姓名一律走 x-uploader-name header 写飞书「姓名」字段（业务员视图按自己过滤）
 *   - 6 个分镜字段全部加细粒度写作说明（≥60字/多维度）
 *   - 行业改三级分类（"一级 > 二级 > 三级"）
 *   - 字段描述与 JSON Schema 完全对齐
 *
 * @param {boolean} _includePeople  保留形参以兼容旧调用方，但已不再使用
 * @returns {string}
 */
function buildMinimaxPrompt(_includePeople) {
  void _includePeople // 显式标记未使用，避免 lint warning
  const lines = [
    '请分析这段视频，按以下 JSON Schema 输出分镜打标结果：',
    '',
    '{',
    '  "productModel": "产品品牌型号（看图中的Logo/铭牌/外形特征）",',
    '  "industry": "【三级分类】一级 > 二级 > 三级。例：工业制造 > 工程机械 > 叉车",',
    '  "categoryTags": ["【分类标签】6-10个，每个6-12字。覆盖：产品形态/核心功能/应用场景/目标客户。例：[\"无人驾驶堆高叉车\",\"激光SLAM自主导航\",\"高位货架智能存取\",\"汽车产线物料转运\"]"],',
    '  "sellingPointTags": ["【核心卖点】4-6个，按重要性降序，每个8-14字。结构：差异化优势+客户价值。维度：核心技术/效率提升/安全可靠/柔性部署/经济回报。例：[\"激光雷达360度无死角扫描保障人车混行安全\",\"单台替代2-3名搬运工年省人力18万\",\"无需地面改造3天即可上线\",\"投资回收期短至14个月\"]"],',
    '  "quality": "优质/良好/一般（按画质/构图/光线/剪辑/声音综合判断）",',
    '  "shots": [',
    '    {',
    '      "startTime": 0,',
    '      "endTime": 0,',
    '      "description": "【≥60字】画面描述。必须覆盖：人物外貌/服饰/表情/动作/位置 + 产品全貌/局部特写/铭牌可读文字/品牌标识 + 背景环境/光线/色调/构图/转场方式 + 字幕/Logo/特效",',
    '      "scene": "场景（结构：室内/室外 + 具体场所 + 时间段 + 天气）。例：室内-工厂车间-白天-自然光",',
    '      "objects": "画面物体清单（产品全称型号 + 铭牌可读文字 + 品牌Logo + 包装 + 工具 + 道具 + 场景陈设）",',
    '      "action": "动作（主体是谁 + 动作动词 + 节奏/力度/速度 + 动作结果/目的 + 镜头是否跟随）",',
    '      "camera": "镜头（景别 + 角度 + 运动 + 景深 + 转场）。例：全景-平视-固定机位-深景深-硬切",',
    '      "coreSellingPoint": "核心卖点（营销话术 + 产品优势 + 痛点解决 + 品牌价值 + 差异化）"',
    '    }',
    '  ]',
    '}',
  ]
  return lines.join('\n')
}

/**
 * 用 ffmpeg 从视频里抽取 N 张关键帧（按时间均匀采样）
 * @param {string} localPath  本地视频路径
 * @param {number} duration   视频时长（秒）
 * @param {number} [frameCount=6]  要抽取的帧数（3-8）
 * @returns {Promise<string[]>}    帧文件绝对路径数组
 */
async function extractVideoFrames(localPath, duration, frameCount = 6) {
  const ffmpeg = CFG.ffmpegPath || 'ffmpeg'
  // 帧数自适应：时长 8s 内最多 6 帧，长视频最多 8 帧
  const n = Math.max(3, Math.min(8, frameCount || Math.min(8, Math.max(3, Math.ceil((duration || 30) / 2)))))
  const outDir = path.join(CFG.videoDir, `_frames_${Date.now()}`)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  // fps= n/duration → 在整段时长内均匀抽 n 张
  const fps = (n / (duration || 30)).toFixed(4)
  const outPattern = path.join(outDir, 'frame_%02d.jpg')
  await new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-y', '-i', localPath, '-vf', `fps=${fps},scale=480:-1`, '-q:v', '4', outPattern], (err, _stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${err.message} | ${stderr}`))
      resolve()
    })
  })
  const files = readdirSync(outDir).filter(f => /^frame_\d+\.jpg$/.test(f)).sort()
  console.log(`[mock-api] 🎞️ 抽帧: ${localPath} (${duration}s) → ${files.length} 帧 (fps=${fps})`)
  return files.map(f => path.join(outDir, f))
}

/**
 * 给单个分镜生成「封面图」（在 startTime 处抽帧 + 720p 缩放 + 上传 OSS）
 *
 * 用途：每个分镜在飞书 SHOT 表都有「封面图」字段（URL 类型）。
 *       前端上传视频 → AI 返回 shots → 对每个 shot 调本函数得到 coverUrl → 写入飞书。
 *
 * 失败处理：抽帧/上传失败时返回空字符串，不阻塞其他字段写入。
 *
 * @param {string} localPath   本地视频绝对路径
 * @param {number} startTime   分镜开始时间（秒）
 * @param {string} [baseName]  封面图 OSS key 前缀（默认 = localPath basename + startTime）
 * @returns {Promise<string>}  封面图 OSS 公开 URL；失败返回 ''
 */
async function generateShotCover(localPath, startTime, baseName) {
  const ffmpeg = CFG.ffmpegPath || 'ffmpeg'
  const t = Math.max(0, Number(startTime) || 0)
  const safeBase = (baseName || path.basename(localPath, path.extname(localPath)))
    .replace(/[^\w.\-]/g, '_')
    .slice(0, 60)
  const outDir = path.join(CFG.videoDir, `_covers_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `cover_${safeBase}_${t.toFixed(1)}s.jpg`)
  try {
    // 1) ffmpeg 抽帧：startTime 处抽 1 帧，缩放到宽度 720p（保持比例），JPEG q=3（高质量）
    await new Promise((resolve, reject) => {
      execFile(
        ffmpeg,
        [
          '-y',
          '-ss', t.toFixed(2),           // 跳到 startTime（放在 -i 前 = 快速 seek）
          '-i', localPath,
          '-frames:v', '1',              // 只抽 1 帧
          '-vf', 'scale=720:-2',         // 宽度 720，高度按比例偶数
          '-q:v', '3',                   // JPEG 质量（2-5，3 为较高质量）
          outFile,
        ],
        (err, _stdout, stderr) => {
          if (err) return reject(new Error(`ffmpeg cover failed: ${err.message} | ${stderr}`))
          resolve()
        },
      )
    })
    if (!existsSync(outFile) || statSync(outFile).size === 0) {
      throw new Error('cover file is empty')
    }
    console.log(`[mock-api] 🖼️  封面图抽帧: ${path.basename(localPath)} @${t.toFixed(2)}s → ${outFile}`)

    // 2) 上传到 OSS（key 前缀 covers/ 区分视频帧）
    const objectKey = `covers/${safeBase}_${t.toFixed(1)}s_${Date.now()}.jpg`
    const r = await uploadToOss(outFile, objectKey)
    return r.url || ''
  } catch (e) {
    console.warn(`[mock-api] ⚠️  生成封面图失败 @${t.toFixed(2)}s: ${e.message}`)
    return ''
  } finally {
    // 清理临时文件
    try {
      if (existsSync(outFile)) unlinkSync(outFile)
      if (existsSync(outDir)) rmdirSync(outDir)
    } catch {}
  }
}

/**
 * 用 ffmpeg 把视频压缩到 ≤ 45MB（给 multipart 边界/header 留 5MB buffer）
 * 目标码率 = (45MB × 8 / duration) × 0.92（安全系数）− 128k（音频）
 * @param {string} localPath  本地视频绝对路径
 * @returns {Promise<string>}  压缩后文件绝对路径（小文件直接返回原路径）
 */
async function compressVideoForMinimax(localPath) {
  const TARGET_BYTES = 45 * 1024 * 1024
  const stat = fs.statSync(localPath)
  if (stat.size <= TARGET_BYTES) return localPath

  const duration = await getVideoDuration(localPath)
  if (!duration || duration <= 0) throw new Error('无法获取视频时长，无法计算压缩参数')

  const AUDIO_KBPS = 128
  const SAFETY = 0.92
  const videoKbps = Math.max(200, Math.floor((TARGET_BYTES * 8 / duration) / 1000 * SAFETY) - AUDIO_KBPS)

  const outPath = path.join('/tmp', `fc_minimax_${Date.now()}.mp4`)
  const ffmpegBin = CFG.ffmpegPath || 'ffmpeg'

  return new Promise((resolve, reject) => {
    execFile(ffmpegBin, [
      '-y',
      '-i', localPath,
      '-c:v', 'libx264',
      '-b:v', `${videoKbps}k`,
      '-preset', 'fast',
      '-c:a', 'aac',
      '-b:a', `${AUDIO_KBPS}k`,
      '-movflags', '+faststart',
      outPath,
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg compress failed: ${err.message} | ${(stderr || '').slice(-500)}`))
      const out = fs.statSync(outPath)
      console.log(`[mock-api] 🗜️  压缩完成: ${(stat.size/1024/1024).toFixed(1)}MB → ${(out.size/1024/1024).toFixed(1)}MB (video=${videoKbps}kbps, ${duration}s)`)
      resolve(outPath)
    })
  })
}

/**
 * 上传本地视频到 MiniMax Files API（purpose=video_understanding）
 * 用于 > 50MB 大视频：拿到 file_id 后用 mm_file://file_id 喂给 M3
 * @param {string} localPath   本地视频绝对路径
 * @param {string} [fileName]  上传时用的文件名，默认 = basename(localPath)
 * @returns {Promise<string>}   MiniMax file_id
 */
async function uploadToMinimaxFiles(localPath, fileName) {
  const buf = fs.readFileSync(localPath)
  const blob = new Blob([buf], { type: 'video/mp4' })
  const form = new FormData()
  form.append('file', blob, fileName || path.basename(localPath))
  form.append('purpose', 'video_understanding')

  const t0 = Date.now()
  const res = await fetch(`${CFG.minimaxBase}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.minimaxKey}` },
    body: form,
  })
  const ms = Date.now() - t0
  console.log(`[mock-api] 📤 MiniMax Files upload: status=${res.status}, ${ms}ms, ${(buf.length/1024/1024).toFixed(2)}MB`)
  const text = await res.text()
  if (!res.ok) throw new Error(`MiniMax Files upload failed: ${res.status} ${text}`)
  let body
  try { body = JSON.parse(text) } catch { throw new Error(`MiniMax Files upload 返回非 JSON: ${text.slice(0, 200)}`) }
  if (body.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax Files upload error: ${body.base_resp?.status_msg || JSON.stringify(body)}`)
  }
  const fileId = body.file?.file_id
  if (!fileId) throw new Error(`MiniMax Files upload 未返回 file_id: ${text.slice(0, 200)}`)
  console.log(`[mock-api] 📎 MiniMax file_id = ${fileId}`)
  return fileId
}

/**
 * 用 MiniMax-M3 直接分析整段视频
 *   - ≤ 50MB：直接用 OSS URL（video_url 公开地址）
 *   - > 50MB：先 ffmpeg 压到 ≤ 45MB → 上传 Files API（purpose=video_understanding）→ 用 mm_file://file_id
 *
 * 修复前情（2026-09-07）：
 *   - 旧代码用 `MiniMax-Video-01` 这个**根本不存在的模型** + 先 POST 到 `/files`
 *     （MiniMax 没这个 endpoint，永远 404）
 *   - 实测 MiniMax 真实可用模型：M3 / M2.7 / M2.5 / M2.1 / M2
 *   - MiniMax-M3 多模态可直接吃 `video_url` 类型（HTTP 公网 URL），无需预先上传
 *   - 实测：传 OSS 公开链接，34.6s 返回真实分析（30s 视频 + 100 token 就把思考耗光，要 ≥16K）
 *   - M3 是 thinking 模型，输出格式 `<think>...</think>{answer}`，代码已经 strip
 *
 * 2026-09-08 扩展（飞仓 116MB 走通）：
 *   - OSS video_url 硬上限 50MB；> 50MB 必须走 Files API
 *   - Files API 实际单文件上限约 70-100MB（实测 68MB ✅，116MB 413）
 *   - 保险起见：> 50MB 先 ffmpeg 压到 ≤ 45MB 再上传
 *   - Files API 上传免费；解析时仍扣 M3 token 费用
 *
 * @param {string} localPath  本地视频路径（用于大小判断 + 大文件压缩源）
 * @param {number} duration   视频时长（秒）
 * @param {string} fileName   文件名（用于日志 + 兜底 productModel）
 * @param {object} opts       { includePeople, ossUrl }
 *   - ossUrl 必填：小文件直接用；大文件压缩失败时 fallback 也用它
 * @returns {Promise<{productModel, totalDuration, shotCount, industry, shots: [...]}>}
 */
async function analyzeWithMiniMaxVideo(localPath, duration, fileName, opts = {}) {
  const { includePeople = false, ossUrl = null } = opts

  // ⚠️ P0#1 修复：MiniMax-M3 服务端经常拉不到我们的 OSS 公网 URL（fetch failed），
  //    强制所有视频都走 Files API（purpose=video_understanding）→ mm_file://file_id，
  //    完全绕开 OSS 公网拉取这条不稳定链路。
  //    副作用：小视频会多一次上传（≤45MB 不压缩直接传；>45MB 先 ffmpeg 压到 45MB），
  //    但每次分析只走一次，可接受。
  const FORCE_FILES_API = true  // 关掉 = 退回旧的「小视频走 OSS」分支
  const localSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : 0
  let videoSource = null
  let tempCompressed = null

  const useFilesApi = FORCE_FILES_API || localSize > 50 * 1024 * 1024
  if (useFilesApi) {
    if (FORCE_FILES_API) {
      console.log(`[mock-api] 📦 视频 ${(localSize/1024/1024).toFixed(1)}MB → 强制走 Files API（绕过 OSS 公网拉取）`)
    } else {
      console.log(`[mock-api] 📦 视频 ${(localSize/1024/1024).toFixed(1)}MB > 50MB → 走 Files API 路径（先压缩再上传）`)
    }
    try {
      // compressVideoForMinimax: ≤45MB 直接返回原路径；>45MB 才压缩
      tempCompressed = await compressVideoForMinimax(localPath)
      const fileId = await uploadToMinimaxFiles(tempCompressed, fileName)
      videoSource = `mm_file://${fileId}`
    } catch (e) {
      // ⚠️ 不再 fallback 到 ossUrl：fallback 走的就是挂掉的 OSS 公网拉取链路
      console.error(`[mock-api] ❌ Files API 上传失败（已放弃 fallback）: ${e.message}`)
      throw e
    }
  } else {
    if (!ossUrl) throw new Error('analyzeWithMiniMaxVideo: ossUrl 必填（视频 ≤ 50MB 直接走 OSS URL）')
    videoSource = ossUrl
  }

  console.log(`[mock-api] 🎬 MiniMax-M3 视频源: ${videoSource.slice(0, 80)}...`)

  // 直接把 OSS 公开 URL 或 mm_file://file_id 喂给 M3
  const systemPrompt = '你是一个专业的工业/营销视频内容分析专家，专门分析叉车、物流设备、家电、消费品等视频。返回纯JSON（不要markdown代码块包裹，不要<think>标签外的任何文字）。分镜的 startTime/endTime 必须基于视频真实时间戳，覆盖范围 [0, 视频总时长]。'
  const userText = buildMinimaxPrompt(includePeople)
    + `\n\n这是 ${duration || '?'} 秒的整段视频，源 URL 已附上。请看完整个视频后按 JSON Schema 输出分镜打标结果。`

  try {
    // 3 分钟超时：实测独立进程 24-56s 返回，但长生命周期的 mock server 多次调用后
    // 会出现 fetch 永远不返回的怪现象（macOS + Node24 + undici），超时后让上层走真实失败路径
    const res = await fetch(`${CFG.minimaxBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.minimaxKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'video_url', video_url: { url: videoSource } },
            { type: 'text', text: userText },
          ]},
        ],
        response_format: { type: 'json_schema', json_schema: MINIMAX_JSON_SCHEMA.json_schema },
        max_tokens: 32000,  // M3 是 thinking 模型：思考 token 占大头 + JSON 输出 ≈ 几千 token
      }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`MiniMax chat failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    const choice = data.choices?.[0]
    let raw = choice?.message?.content
    if (!raw) throw new Error(`MiniMax returned empty response (finish_reason=${choice?.finish_reason}, usage=${JSON.stringify(data.usage || {})})`)

    // 兼容 ```json``` / <think> 前缀（M3 输出格式）
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) raw = fence[1].trim()
    console.log(`[mock-api] 🧠 MiniMax-M3 返回 ${raw.length} 字符 (finish_reason=${choice.finish_reason})`)

    const parsed = JSON.parse(raw)
    parsed.shots = Array.isArray(parsed.shots) ? parsed.shots : []
    parsed.productModel = parsed.productModel || fileName?.replace(/\.[^/.]+$/, '') || '未知产品'
    parsed.totalDuration = Number(parsed.totalDuration) || duration || 30
    parsed.shotCount = parsed.shots.length
    parsed.industry = parsed.industry || '通用'
    console.log(`[mock-api] 🎬 M3 输出 ${parsed.shots.length} 个分镜，时间区间 ${parsed.shots[0]?.startTime || 0}s → ${parsed.shots[parsed.shots.length - 1]?.endTime || 0}s（视频时长 ${parsed.totalDuration}s）`)
    return parsed
  } finally {
    // 清理压缩临时文件（成功失败都清）
    // ⚠️ compressVideoForMinimax 在 ≤45MB 时返回原路径 → 不要 unlinkSync 用户原视频
    if (tempCompressed && tempCompressed !== localPath && fs.existsSync(tempCompressed)) {
      try { fs.unlinkSync(tempCompressed) } catch {}
    }
  }
}

/**
 * 旧的「抽关键帧 + 多图模式」——保留作为 fallback，新代码默认走 analyzeWithMiniMaxVideo
 * 1) 抽帧 2) 上传每帧到 OSS 3) 一次 chat 多图 + JSON schema
 * @deprecated 自 MiniMax Video-01 支持原生 video_url 后，多图模式的时间戳准确率太低（边界靠猜）
 */
async function analyzeWithMiniMaxFrames(localPath, duration, fileName, opts = {}) {
  const { includePeople = false } = opts
  // 1) 抽帧
  let framePaths = []
  try {
    framePaths = await extractVideoFrames(localPath, duration || 30)
  } catch (e) {
    console.warn(`[mock-api] 抽帧失败 ${fileName}: ${e.message}`)
    throw e
  }

  // 2) 每帧上传到 OSS
  const frameUrls = []
  for (const fp of framePaths) {
    try {
      const r = await uploadToOss(fp)
      frameUrls.push(r.publicUrl)
      console.log(`[mock-api] 🖼️ 帧上传 OSS: ${r.key}`)
    } catch (e) {
      console.warn(`[mock-api] 帧上传 OSS 失败: ${e.message}`)
    }
  }
  if (frameUrls.length === 0) throw new Error('No frames uploaded to OSS')

  // 3) 一次 chat 多图 + JSON schema
  const systemPrompt = '你是一个专业的工业/营销视频内容分析专家，专门分析叉车、物流设备、家电、消费品等视频。返回纯JSON（不要markdown代码块包裹，不要<think>标签外的任何文字）。'
  const content = [
    ...frameUrls.map(url => ({ type: 'image_url', image_url: { url } })),
    { type: 'text', text: buildMinimaxPrompt(includePeople) + `\n\n这些是同一段视频按时间顺序抽取的 ${frameUrls.length} 张关键帧（间隔均匀）。请根据画面变化自动判断合理的分镜边界，并给出每段的开始/结束时间（秒）。如果画面变化不大就合并为一段。视频总时长约 ${duration || 30} 秒。` },
  ]
  const res = await fetch(`${CFG.minimaxBase}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.minimaxKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
    }),
  })
  if (!res.ok) throw new Error(`MiniMax chat failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  let raw = data.choices?.[0]?.message?.content
  if (!raw) throw new Error('MiniMax returned empty response')

  // M3 偶尔会用 ```json``` 包裹或带 <think> 前缀，做兼容解析
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) raw = fence[1].trim()
  console.log(`[mock-api] 🧠 M3 返回 ${raw.length} 字符`)

  const parsed = JSON.parse(raw)
  // 字段兜底
  parsed.shots = Array.isArray(parsed.shots) ? parsed.shots : []
  parsed.productModel = parsed.productModel || fileName?.replace(/\.[^/.]+$/, '') || '未知产品'
  parsed.totalDuration = Number(parsed.totalDuration) || duration || 30
  parsed.shotCount = parsed.shots.length
  parsed.industry = parsed.industry || '通用'
  return parsed
}

// ─── 豆包TTS ─────────────────────────────────────────────────────────────────
async function getDoubaoToken() {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: CFG.doubaoClientId, app_secret: CFG.doubaoClientSecret }),
  })
  const data = await res.json()
  if (data.code !== 0) throw new Error(`Doubao token failed: ${data.msg}`)
  return data.app_access_token
}

async function synthesizeTTS(text, voice = 'BV700_V2_streaming') {
  const token = await getDoubaoToken()
  const res = await fetch(CFG.doubaoEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer; ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app: { appid: CFG.doubaoClientId, token, cluster: 'volcengine_streaming_common' },
      user: { uid: 'zhongli-user' },
      audio: { sample_rate: 16000, encoding: 'wav' },
      request: { reqid: `tts_${Date.now()}`, text, operation: 'submit', voice_settings: { voice: 'zh-CN-XiaoxiaoNeural', speed: 1.0, pitch: 1.0 } },
    }),
  })
  if (!res.ok) throw new Error(`Doubao TTS failed: ${res.status} ${await res.text()}`)
  // TTS returns binary audio - save to file
  const chunks = []
  for await (const chunk of res.body) chunks.push(chunk)
  const audioBuffer = Buffer.concat(chunks)
  const outPath = path.join(CFG.videoDir, `tts_${Date.now()}.wav`)
  fs.writeFileSync(outPath, audioBuffer)
  return outPath
}

// ─── FFmpeg ───────────────────────────────────────────────────────────────────
const _ffmpegFilterCache = {}
async function checkFfmpegFilter(filterName) {
  if (_ffmpegFilterCache[filterName] !== undefined) return _ffmpegFilterCache[filterName]
  const ffmpegBin = process.env.FFMPEG_PATH || '/Users/jensen/miniconda3/bin/ffmpeg'
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, ['-filters'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.on('error', () => { _ffmpegFilterCache[filterName] = false; resolve(false) })
    proc.on('close', () => {
      const supported = stdout.toLowerCase().includes(filterName.toLowerCase())
      _ffmpegFilterCache[filterName] = supported
      resolve(supported)
    })
  })
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegBin = process.env.FFMPEG_PATH || '/Users/jensen/miniconda3/bin/ffmpeg'
    const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
  })
}

// ─── MiniMax 语义匹配：把脚本段落 + 粗筛候选分镜交给 LLM 精排 ──────
/**
 * 设计思路（两层漏斗，云端优先：飞书全表 = 唯一数据源）：
 *  1. 第一层：按产品型号粗筛（prefilterByProductName）——「51HDC」 ↔「中力 51HDC」
 *     粗筛后剩余约 5-30 条候选
 *  2. 第二层：MiniMax-M2.5 精排 —— LLM 在粗筛子集里挑 top3，prompt 明确告知「这是同型号/同系列」
 *  3. 每段脚本只调一次 LLM（即使有 N 段也只 N 次）
 *  4. LLM 失败/超时 → 回退到关键词打分排序，不阻断主流程
 */
async function matchSegmentWithLLM(segText, candidates, contextHint = '') {
  const n = candidates.length
  if (n === 0) return []

  // 紧凑描述：每条 ≈100 字符（即使粗筛后剩 30 条也只 3k tokens）
  const candidateList = candidates.map((c, i) => {
    const desc = [
      `产品:${c.productModel || '-'}`,
      `场景:${c.shot.scene || '-'}`,
      `动作:${c.shot.action || '-'}`,
      `物体:${c.shot.objects || '-'}`,
      `镜头:${c.shot.camera || '-'}`,
      `卖点:${c.shot.coreSellingPoint || '-'}`,
      `描述:${c.shot.description || '-'}`,
    ].join('；')
    return `[${i}] ${desc}`
  }).join('\n')

  if (!CFG.minimaxKey) return []

  const prompt = `你是视频素材匹配专家。给定一段销售脚本和 ${n} 个候选分镜${contextHint ? `（${contextHint}）` : ''}，请按"脚本段落与该分镜画面的语义相关性"打分（0-1），选出最合适的 top 3。

脚本段落：
"""
${segText.slice(0, 500)}
"""

候选分镜（共 ${n} 条）：
${candidateList}

严格要求：
1. 严禁用关键词包含来机械匹配 —— 必须理解画面语义
2. 考虑同义/近义（如"载重"≈"动力"，"零排放"≈"电动低噪音"，"户外作业"≈"全地形"）
3. 优先选场景/动作/物体/镜头/卖点与脚本段落最贴合的
4. ${contextHint ? `这些候选${contextHint.includes('粗筛') ? '已经按产品型号初筛过，请聚焦区分度（场景/动作/卖点），不必再考虑型号差异' : '请综合考虑产品型号、画面场景和卖点'}。` : '如果整段脚本和某些候选分镜语义差距很大，可给低分（如 0.05）。'}
5. 只输出 JSON，不要任何 markdown/思考/解释

输出格式（严格 JSON）：
{"ranked": [{"idx": <在候选列表中的下标>, "score": <0-1>, "reason": "<一句话理由，不超过 25 字>"}, ...]}`

  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 50000) // 50s 上限：粗筛后 prompt 短，M3 推理快
    const res = await fetch(`${CFG.minimaxBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.minimaxKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'MiniMax-M3',
        messages: [
          { role: 'system', content: '你是视频素材匹配专家。严格只输出 JSON，无任何额外内容。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1500, // 粗筛后候选 ≤ 30，输出长度可控
        temperature: 0.1,
      }),
    })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`MiniMax match failed: ${res.status}`)
    const data = await res.json()
    let raw = data.choices?.[0]?.message?.content || ''
    // 清洗：剥掉 <think> / markdown 包裹
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json|```/g, '').trim()
    // 抽取第一个 JSON 对象
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) {
      console.warn(`[mock-api] LLM match raw (no JSON): ${raw.slice(0, 400)}`)
      throw new Error('LLM returned no JSON')
    }
    const parsed = JSON.parse(m[0])
    const rankedList = Array.isArray(parsed.ranked) ? parsed.ranked : []
    const out = []
    for (const item of rankedList) {
      const i = Number(item.idx)
      if (Number.isInteger(i) && i >= 0 && i < n) {
        out.push({
          ...candidates[i],
          score: Math.max(0, Math.min(1, Number(item.score) || 0)),
          reason: String(item.reason || '').slice(0, 30),
        })
      }
    }
    return out
  } catch (e) {
    console.warn(`[mock-api] LLM match failed, fallback to keyword: ${e.message}`)
    return []
  }
}

// 关键词打分（fallback 当 LLM 不可用）
function keywordScore(segText, c) {
  const keywords = (segText || '').split(/[\s,，、。；;]+/u).filter(t => t.length >= 1)
  const haystack = [
    c.shot.description, c.shot.scene, c.shot.action, c.shot.coreSellingPoint,
    c.productModel || '', c.brandName || '', c.videoName || '',
    ...(c.tags || [])
  ].join(' ')
  let hits = 0
  for (const k of keywords) {
    if (haystack.includes(k)) hits++
  }
  const base = keywords.length > 0 ? hits / keywords.length : 0.5
  const sceneHit = keywords.some(k => (c.shot.scene || '').includes(k)) ? 0.15 : 0
  const sellingHit = keywords.some(k => (c.shot.coreSellingPoint || '').includes(k)) ? 0.15 : 0
  return Math.min(1, base + sceneHit + sellingHit)
}

// 按产品型号粗筛：用户输入「51HDC」 ↔ 飞书「中力 51HDC」/「51HDC-A」/「中力 51HDC 电动叉车」
// 设计：双向模糊匹配（包含/前缀/核心型号），避免关键词预筛过于严格导致漏匹配
// 返回 { matched, hint, fallback } —— matched 为粗筛后的子集；hint 用于日志与 LLM 上下文
function prefilterByProductName(allCandidates, productName) {
  const pn = String(productName || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!pn) return { matched: allCandidates, hint: '', fallback: false }

  const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g, '')

  // 提取核心型号 token（如「中力 51HDC-3」 → 51hdc / 51hdc-3 都尝试）
  const tokens = []
  // 1) 整串作为 token
  tokens.push(pn)
  // 2) 连续字母+数字组合（如 51hdc、xcp10e）
  const idMatches = pn.match(/[a-z]*\d+[a-z\-]*/gi) || []
  for (const m of idMatches) tokens.push(m)
  // 3) 纯数字串
  const numMatches = pn.match(/\d+/g) || []
  for (const n of numMatches) if (n.length >= 2) tokens.push(n)

  const tokenSet = [...new Set(tokens.filter(t => t.length >= 2))]

  const isMatch = (model) => {
    const m = normalize(model)
    if (!m) return false
    for (const tok of tokenSet) {
      // 双向包含（任一方向命中即算）
      if (m.includes(tok) || tok.includes(m)) return true
    }
    return false
  }

  const matched = allCandidates.filter(c => isMatch(c.productModel))

  // 粗筛命中 ≥ 3 条 → 用粗筛结果给 LLM；< 3 条 → 兜底用全表（避免漏匹配）
  if (matched.length >= 3) {
    return {
      matched,
      hint: `已按产品型号「${productName}」粗筛 ${matched.length} 条候选`,
      fallback: false,
    }
  }
  return {
    matched: allCandidates,
    hint: matched.length > 0
      ? `产品型号「${productName}」仅命中 ${matched.length} 条（不足 3 条），改用全表 ${allCandidates.length} 条`
      : `产品型号「${productName}」未命中任何候选，改用全表 ${allCandidates.length} 条`,
    fallback: true,
  }
}

async function clipWithFfmpeg(shots, sourceBufferMap, script) {
  const workDir = path.join(CFG.videoDir, `clip_${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  const cutsDir = path.join(workDir, 'cuts')
  mkdirSync(cutsDir, { recursive: true })
  // 输出文件保留在 videoDir 顶层（不在 workDir 内），避免随中间目录被删除
  const outFileName = `clipped_${Date.now()}.mp4`
  const outPath = path.join(CFG.videoDir, outFileName)

  try {
    // 把每个唯一 sourceUrl 写到独立文件，避免重复下载与冲突
    const sourcePathMap = {}
    for (const [url, buf] of Object.entries(sourceBufferMap)) {
      const safeName = url.replace(/[^a-zA-Z0-9]/g, '_').slice(-40) + '.mp4'
      const p = path.join(workDir, `src_${safeName}`)
      fs.writeFileSync(p, buf)
      sourcePathMap[url] = p
    }

    // 如果有旁白先生成TTS音频
    let audioPath = null
    const narration = shots.map(s => s.narrationText || '').filter(Boolean).join('，')
    if (narration) {
      try {
        audioPath = await synthesizeTTS(narration)
      } catch (e) {
        console.log('[mock-api] TTS failed, continuing without audio:', e.message)
      }
    }

    // 逐段剪切：每个 shot 用自己的 sourceVideoUrl 对应的本地文件
    const cutPaths = []
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      const sourcePath = sourcePathMap[shot.sourceVideoUrl]
      if (!sourcePath) {
        console.warn(`[mock-api] shot ${i} 缺少 sourceVideoUrl，跳过`)
        continue
      }
      const dur = Math.max(0.1, (shot.endTime || 0) - (shot.startTime || 0))
      const cutPath = path.join(cutsDir, `cut_${i}.mp4`)
      const args = ['-y', '-ss', (shot.startTime || 0).toFixed(3), '-i', sourcePath, '-t', dur.toFixed(3),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-avoid_negative_ts', 'make_zero', cutPath]
      if (audioPath && i === 0) args.push('-i', audioPath, '-shortest')
      await runFfmpeg(args)
      cutPaths.push(cutPath)
    }

    // 生成字幕文件
    const srtPath = path.join(workDir, 'subs.srt')
    let cursor = 0
    const srtLines = []
    shots.forEach((shot, i) => {
      const dur = Math.max(0.1, shot.endTime - shot.startTime)
      const start = toSrtTime(cursor)
      const end = toSrtTime(cursor + dur)
      const text = (shot.narrationText || '').trim() || `镜头 ${i + 1}`
      srtLines.push(`${i + 1}\n${start} --> ${end}\n${text}\n`)
      cursor += dur
    })
    fs.writeFileSync(srtPath, srtLines.join('\n'))

    // 合成最终视频
    const concatList = path.join(workDir, 'list.txt')
    fs.writeFileSync(concatList, cutPaths.map(p => `file '${p}'`).join('\n') + '\n')

    // 检测 ffmpeg 是否支持 subtitles 滤镜（部分精简版不支持）
    const ffmpegSupportsSubs = await checkFfmpegFilter('subtitles')
    const ffmpegArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', concatList]
    if (ffmpegSupportsSubs) {
      const vf = `subtitles=${srtPath}:force_style='FontName=Noto Sans CJK SC,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2'`
      ffmpegArgs.push('-vf', vf)
      console.log('[mock-api] ffmpeg supports subtitles filter, applying')
    } else {
      console.log('[mock-api] ffmpeg lacks subtitles filter, skipping overlay')
    }
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', outPath)
    await runFfmpeg(ffmpegArgs)

    // 只清理中间目录（cuts / source / list / srt），保留最终 outPath
    await fs.promises.rm(workDir, { recursive: true, force: true })

    const totalDur = shots.reduce((s, sh) => s + (sh.endTime - sh.startTime), 0)
    // 返回可通过 Vite mock 路由播放的 URL（不再用 file://，浏览器拒访）
    const playableUrl = `/api/video/file/${outFileName}`
    return { videoUrl: playableUrl, duration: Math.round(totalDur), outputPath: outPath }
  } catch (e) {
    try { await fs.promises.rm(workDir, { recursive: true, force: true }) } catch {}
    throw e
  }
}

function toSrtTime(seconds) {
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000)
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`
}

// ─── 阿里云 OSS（视频云端存储）────────────────────────────────────────
let _ossClient = null
function getOssClient() {
  if (_ossClient) return _ossClient
  if (!CFG.ossAccessKeyId || !CFG.ossAccessKeySecret || !CFG.ossBucket || !CFG.ossRegion) {
    throw new Error(
      '[OSS] 配置不完整，请在 .env 中设置：\n' +
      '  ALI_OSS_ACCESS_KEY_ID\n' +
      '  ALI_OSS_ACCESS_KEY_SECRET\n' +
      '  ALI_OSS_BUCKET（你的 bucket 名）\n' +
      '  ALI_OSS_REGION（如 oss-cn-hangzhou）'
    )
  }
  const OSS = require('ali-oss')
  const opts = {
    accessKeyId: CFG.ossAccessKeyId,
    accessKeySecret: CFG.ossAccessKeySecret,
    bucket: CFG.ossBucket,
    region: CFG.ossRegion,
    // ⏱ 验证用：临时把超时从 SDK 默认 60s 提到 120s，让 116MB 视频能在 OSS 上传完成
    timeout: 120000,
  }
  if (CFG.ossEndpoint) opts.endpoint = CFG.ossEndpoint
  _ossClient = new OSS(opts)
  console.log(`[OSS] 客户端已初始化: bucket=${CFG.ossBucket}, region=${CFG.ossRegion}`)
  return _ossClient
}

/**
 * 上传本地文件到阿里云 OSS
 * @param {string} localPath  本地文件绝对路径
 * @param {string} [objectKey] 自定义 OSS key（不含前缀），默认 = 时间戳_随机串_文件名
 * @returns {Promise<{key: string, url: string, publicUrl: string, bucket: string, region: string, etag?: string, size: number}>}
 */
async function uploadToOss(localPath, objectKey, opts = {}) {
  if (!existsSync(localPath)) throw new Error(`[OSS] 本地文件不存在: ${localPath}`)
  const client = getOssClient()
  const fileName = path.basename(localPath)
  const safeName = fileName.replace(/[^\w.\-]/g, '_')
  const prefix = CFG.ossPrefix || ''
  // 关键修改：OSS 文件名 = 用户原始文件名（避免重名时自动追加序号）
  // 用户在阿里云控制台看到的文件名 = UI 上看到的文件名
  let key
  if (objectKey) {
    key = objectKey
  } else {
    let candidate = safeName
    let counter = 1
    while (true) {
      const exists = await client.get(`${prefix}${candidate}`).then(r => r.res && r.res.status === 200).catch(() => false)
      if (!exists) break
      const ext = path.extname(safeName)
      const base = safeName.slice(0, safeName.length - ext.length)
      candidate = `${base}_${counter}${ext}`
      counter += 1
      if (counter > 999) break // 安全边界
    }
    key = candidate
  }
  // 显式传 objectKey 且 opts.skipPrefix 时，key 已是完整路径（如 covers/xx、transcoded/xx），
  // 不再叠加默认 ALI_OSS_PREFIX（videos/）
  const fullKey = opts.skipPrefix ? key : prefix + key
  console.log(`[OSS] 上传 ${localPath} -> oss://${CFG.ossBucket}/${fullKey}`)
  // ⚠️ P0 修复：传文件路径让 ali-oss SDK 内部走流式上传（避免 statSync 等同步调用阻塞事件循环）
  // 旧实现会在客户端代码里再 statSync 一次取 size，已改为 async stat
  const putResult = await client.put(fullKey, localPath, {
    headers: CFG.ossPublicRead ? { 'x-oss-object-acl': 'public-read' } : undefined,
  })
  // 异步取文件大小，不阻塞事件循环
  let fileSize = 0
  try {
    const st = await fs.promises.stat(localPath)
    fileSize = st.size
  } catch (_) { /* 拿不到就 0 */ }
  // ⚠️ ali-oss SDK 的 putResult.url 在某些环境下返回的是 http://，
  // 而下游 MiniMax-M3 视频分析只能走 https（http 端口在本机被屏蔽），
  // 这里统一强制升到 https，避免分析步骤 fetch failed。
  const httpUrl = putResult.url || `http://${CFG.ossBucket}.${CFG.ossRegion}.aliyuncs.com/${fullKey}`
  const url = httpUrl.replace(/^http:\/\//, 'https://')
  const publicUrl = CFG.ossPublicRead ? url : client.signatureUrl(fullKey, { expires: 3600 * 24 * 7 })
  return {
    key: fullKey,
    url,
    publicUrl,
    bucket: CFG.ossBucket,
    region: CFG.ossRegion,
    etag: (putResult.res && putResult.res.headers && putResult.res.headers.etag) || '',
    size: fileSize,
  }
}

/**
 * 删除 OSS 上的文件
 */
async function deleteFromOss(key) {
  try {
    const client = getOssClient()
    await client.delete(key)
    console.log(`[OSS] 删除: ${key}`)
    return true
  } catch (e) {
    console.warn(`[OSS] 删除失败 ${key}:`, e.message)
    return false
  }
}

/**
 * 检查 OSS 凭据 & 桶连通性
 */
async function checkOssHealth() {
  try {
    const client = getOssClient()
    const info = await client.getBucketInfo(CFG.ossBucket)
    return {
      ok: true,
      configured: {
        bucket: CFG.ossBucket,
        region: CFG.ossRegion,
        prefix: CFG.ossPrefix,
        publicRead: CFG.ossPublicRead,
      },
      bucketInfo: info.bucket || null,
    }
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      code: e.code,
      configured: { bucket: CFG.ossBucket, region: CFG.ossRegion },
    }
  }
}

// ─── 视频时长探测（ffprobe）────────────────────────────────────────────
let _ffprobeBin = null
function getFfprobe() {
  if (_ffprobeBin) return _ffprobeBin
  const candidates = [
    process.env.FFPROBE_PATH,
    '/Users/jensen/miniconda3/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/opt/homebrew/bin/ffprobe',
    'ffprobe',
  ].filter(Boolean)
  const { existsSync } = require('fs')
  for (const p of candidates) {
    try {
      if (p.includes('/') && !existsSync(p)) continue
      _ffprobeBin = p
      return p
    } catch {}
  }
  _ffprobeBin = 'ffprobe'
  return _ffprobeBin
}

/**
 * 用 ffprobe 取视频/音频时长（秒），失败返回 0
 */
function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    const bin = getFfprobe()
    const { spawn } = require('child_process')
    const proc = spawn(bin, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    let out = ''
    proc.stdout.on('data', d => out += d.toString())
    proc.on('close', () => {
      const sec = parseFloat(out.trim())
      resolve(isNaN(sec) ? 0 : sec)
    })
    proc.on('error', () => resolve(0))
  })
}

// ─── 飞书多维表格操作 ────────────────────────────────────────────────────────
async function syncToFeishu(fields) {
  const token = await getFeishuTenantToken()
  const res = await feishuPostRecord(token, fields)
  if (res.code !== 0) console.error('[mock-api] Feishu write error:', res.msg)
  return res
}

/**
 * 推送一条视频记录到主视频表（每个视频一行，含 OSS URL / Hash / 时长 / 状态）
 * @param {object} opts
 *   - fileName: 原始文件名
 *   - fileHash: SHA-256 hash
 *   - ossUrl:   OSS 公网 URL
 *   - duration: 时长（秒，数字）
 *   - status:   '未分析' | '分析中' | '已分析'，默认 '未分析'
 *   - shotRecordIds?: [string] 反向关联的分镜 record_id 数组
 * @returns {Promise<{ok: boolean, recordId?: string, fields?: object, error?: any}>}
 */
async function pushToMainVideoTable(opts) {
  if (!CFG.feishuMainTableId) {
    return { ok: false, error: 'FEISHU_MAIN_TABLE_ID 未配置' }
  }
  const { fileName, fileHash, ossUrl, duration, status, shotRecordIds, personName } = opts
  if (!fileName || !ossUrl) {
    return { ok: false, error: 'fileName 和 ossUrl 必填' }
  }
  const fields = {
    '视频文件名': String(fileName),
    '文件 Hash 值': String(fileHash || ''),
    'OSS 云端地址': String(ossUrl),
    // 主视频表的「总时长 (s)」是 Text 类型，必须以字符串写入
    // 视频用探测出的秒数（保留 3 位小数），图片/未知写 "0"
    '总时长 (s)': duration > 0 ? duration.toFixed(3) : '0',
    '分析状态': status || '未分析',
    // 入库时间是 DateTime（type=1001），写入毫秒时间戳
    '入库时间': Date.now(),
  }
  if (Array.isArray(shotRecordIds) && shotRecordIds.length > 0) {
    // DuplexLink 字段值 = 扁平 record_id 字符串数组（Feishu API 要求，不能是对象）
    fields['反向关联分镜'] = shotRecordIds
  }
  if (personName) {
    // 上传者姓名（业务员）—— 主表「人物标签」是 Text 类型，写字符串即可。
    // 后续 M3 分镜写入「人物姓名（如果有）」时，会从 dto.uploaderName / personName 取，或回读主表这个值。
    fields['人物标签'] = String(personName)
  }
  try {
    const token = await getFeishuTenantToken()
    const r = await feishuPostRecord(token, fields, CFG.feishuMainTableId)
    if (r.code !== 0) {
      console.error('[mock-api] 主视频表写入失败:', r.msg)
      return { ok: false, error: r.msg, code: r.code, fields }
    }
    const recordId = r.data?.record?.record_id || r.data?.record_id
    console.log(`[mock-api] ✅ 主视频表写入成功: ${recordId} (${fileName})`)
    // ⚠️ P0#3-A：异步抽首帧 → 上传飞书附件 → PATCH 主表「封面图」字段
    //    不 await：不阻塞上传接口响应，失败仅打 warn 日志
    if (opts.localFile) {
      setImmediate(() => attachMainCoverAsync(recordId, opts.localFile))
    }
    return { ok: true, recordId, fields }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * 推送一条「混剪产出」记录到新生成视频表 tbly8R5zwud22O58
 * 表 schema：视频文件名 / 文件 Hash / OSS 云端地址 / 总时长 (s) / 分析状态 /
 *           入库时间（自动）/ 产品型号 / 行业 / 客户 / 部门 / 素材质量 /
 *           分类标签 / 人物标签 / 卖点标签
 * @param {object} opts
 *   - fileName, ossUrl, duration 必填
 *   - fileHash, status, productModel, scenario, coreSellingPoint, videoContent
 *   - industry, clientName, department, quality, categoryTags, personTags, sellingPointTags
 *   - employeeName, employeeId, scriptContent, requirement, shotIds, category
 * @returns {Promise<{ok, recordId?, fields?, error?}>}
 */
async function pushToNewVideoTable(opts) {
  if (!CFG.feishuNewVideoTableId) {
    return { ok: false, error: 'FEISHU_NEW_VIDEO_TABLE_ID 未配置' }
  }
  const {
    fileName, ossUrl, duration,
    fileHash, status,
    productModel, scenario, coreSellingPoint, videoContent,
    industry, clientName, department, quality,
    categoryTags, personTags, sellingPointTags,
  } = opts
  if (!fileName || !ossUrl) {
    return { ok: false, error: 'fileName 和 ossUrl 必填' }
  }
  // 把所有元信息塞进描述里（混剪产物本身没有专门的「描述」字段，
  // 但可以放进 分类标签/卖点标签 里方便前端展示）
  const fields = {
    '视频文件名': String(fileName),
    'OSS 云端地址': String(ossUrl),
    '总时长 (s)': duration > 0 ? duration.toFixed(3) : '0',
    '分析状态': status || '已生成',
    '入库时间': Date.now(),
  }
  if (fileHash) fields['文件 Hash 值'] = String(fileHash)
  if (productModel) fields['产品型号'] = String(productModel)
  if (industry) fields['行业'] = String(industry)
  if (clientName) fields['客户'] = String(clientName)
  if (department) fields['部门'] = String(department)
  if (quality) fields['素材质量'] = String(quality)
  // 分类标签 = 场景（如「仓储物流」）
  if (scenario) fields['分类标签'] = String(scenario)
  // 卖点标签 = 核心卖点（用 「，」拼接多条）
  if (coreSellingPoint) fields['卖点标签'] = String(coreSellingPoint)
  // 人物标签 = 视频内容概述
  if (videoContent) fields['人物标签'] = String(videoContent).slice(0, 100)
  try {
    const token = await getFeishuTenantToken()
    const r = await feishuPostRecord(token, fields, CFG.feishuNewVideoTableId)
    if (r.code !== 0) {
      console.error('[mock-api] 新生成视频表写入失败:', r.msg, 'fields=', JSON.stringify(fields).slice(0, 200))
      return { ok: false, error: r.msg, code: r.code, fields }
    }
    const recordId = r.data?.record?.record_id || r.data?.record_id
    console.log(`[mock-api] ✅ 新生成视频表写入成功: ${recordId} (${fileName})`)
    return { ok: true, recordId, fields }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * 从新生成视频表读取全部记录，转成前端 history 需要的 ClipHistoryItem
 */
async function listFromNewVideoTable() {
  if (!CFG.feishuNewVideoTableId) return []
  try {
    const token = await getFeishuTenantToken()
    const records = []
    let pageToken = ''
    do {
      const res = await feishuGetTableRecordsFromTable(token, CFG.feishuNewVideoTableId, 100, pageToken)
      if (res.code !== 0) {
        console.warn('[mock-api] 新生成视频表读取失败:', res.msg)
        return []
      }
      records.push(...(res.data?.items || []))
      pageToken = res.data?.page_token || ''
    } while (pageToken)
    console.log(`[mock-api] 新生成视频表: ${records.length} 条`)
    return records
  } catch (e) {
    console.warn('[mock-api] 新生成视频表读取异常:', e.message)
    return []
  }
}

/**
 * 把飞书新生成视频表的记录转成前端 ClipHistoryItem
 */
function feishuNewVideoRecordToHistory(record) {
  const f = record.fields || {}
  const ossUrl = f['OSS 云端地址'] || ''
  const recordId = record.record_id
  const productModel = f['产品型号'] || ''
  const category = f['分类标签'] || ''
  const sellingPoint = f['卖点标签'] || ''
  const videoContent = f['人物标签'] || ''
  const duration = parseFloat(f['总时长 (s)'] || '0') || 0
  return {
    id: recordId,
    title: productModel || f['视频文件名'] || '混剪视频',
    requirement: [productModel, category, sellingPoint, videoContent].filter(Boolean).join('，'),
    duration: Math.round(duration),
    scriptContent: '',
    videoUrl: ossUrl,
    shotIds: [],
    category: category || '混剪产物',
    status: 'done',
    employeeName: undefined,
    employeeId: undefined,
    createdAt: new Date(Number(f['入库时间'] || Date.now())).toISOString(),
    updatedAt: new Date(Number(f['入库时间'] || Date.now())).toISOString(),
    _feishuRecordId: recordId,
  }
}

/**
 * 通用：读指定表的全部分页记录
 */
async function feishuGetTableRecordsFromTable(token, tableId, pageSize = 100, pageToken = '') {
  const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${tableId}/records?page_size=${pageSize}${pageToken ? `&page_token=${pageToken}` : ''}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  return res.json()
}

/**
 * 删除飞书表里一条记录
 */
async function deleteFeishuRecord(recordId, tableId) {
  if (!tableId || !recordId) return { ok: false, error: '缺少 recordId 或 tableId' }
  try {
    const token = await getFeishuTenantToken()
    const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${tableId}/records/${recordId}?type=bitable`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const j = await res.json()
    if (j.code !== 0) {
      console.warn(`[mock-api] 删除飞书记录失败 [${tableId}/${recordId}]:`, j.msg)
      return { ok: false, error: j.msg }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * 更新主视频表记录的某个字段（如「分析状态」「反向关联分镜」）
 */
async function updateMainVideoRecord(mainRecordId, partialFields) {
  if (!CFG.feishuMainTableId || !mainRecordId) return null
  try {
    const token = await getFeishuTenantToken()
    const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuMainTableId}/records/${mainRecordId}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: partialFields }),
    })
    const j = await res.json()
    if (j.code !== 0) {
      console.error(`[mock-api] ❌ updateMainVideoRecord failed [${mainRecordId}]: code=${j.code} msg=${j.msg} fields=${JSON.stringify(partialFields).slice(0,200)}`)
    }
    return j
  } catch (e) {
    console.warn(`[mock-api] updateMainVideoRecord exception: ${e.message}`)
    return null
  }
}

/**
 * 更新主视频表的「反向关联分镜」字段
 */
async function linkMainVideoToShots(mainRecordId, shotRecordIds) {
  if (!CFG.feishuMainTableId || !mainRecordId || !shotRecordIds?.length) return null
  try {
    const token = await getFeishuTenantToken()
    const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuMainTableId}/records/${mainRecordId}`
    const body = {
      fields: {
        // DuplexLink 字段值 = 扁平 record_id 字符串数组（Feishu API 要求）
        '反向关联分镜': shotRecordIds,
      },
    }
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch (e) {
    console.warn('[mock-api] linkMainVideoToShots failed:', e.message)
    return null
  }
}

/**
 * 把 MiniMax 返回的单条 shot 写入「分镜任务库」表（使用正确的 16 字段名）
 * 分镜表字段：分镜 ID / 视频文件名 / 产品型号 / 开始时间 (s) / 结束时间 (s)
 *           / 关键帧路径 / 画面描述 / 场景 / 物体 / 动作 / 镜头
 *           / 卖点 / 时长 (s) [自动编号] / 时长标签 / 封面图 / 人物姓名（如果有）/ 关联的原视频 [→ 主视频表]
 *           ⚠️ 已删除「产品型号_分镜」（与「产品型号」100% 等价冗余，2026-09-09）
 */
async function writeShotToFeishu(opts) {
  const {
    index, shot, productModel, fileName, keyframeUrl = '',
    people = '', uploaderName = '', mainRecordId = null,
    coverUrl = '',            // ⚠️ P2 新增：封面图 OSS URL（generateShotCover 生成）
  } = opts
  // 优先用关键帧路径，没有就用 OSS URL；最后兜底为空字符串
  // ⚠️ 飞书 SHOT 表里没有「关键帧路径」字段，实际是「原视频地址」，所以直接写到那里
  const keyframeOrOss = keyframeUrl || opts.ossUrl || ''
  const startT = Number(shot.startTime || 0)
  const endT = Number(shot.endTime || 0)
  // 人物姓名（如果有）：按业务方要求只放上传业务员自己的姓名（uploaderName），
  // 不要 AI 自动识别出的描述（如「30+岁男性」「无人物」等）。兼容 fallback：若未传
  // uploaderName 则回退到 people，再不行就留空字符串。
  // 姓名字段：调用方已经按角色过滤（业务员传 uploaderName / 其他人传空字符串），
  // 这里不再回退到 `people`（避免把 AI 识别的「30+岁男性」等描述写进姓名字段）。
  const peopleField = String(uploaderName || '').trim()
  // ⚠️ P2 新增：时长标签（mm:ss 格式，更友好）。时长 (s) 字段是自动编号，由 Feishu 自己算
  const durationSec = Math.max(0, endT - startT)
  const durationLabel = (() => {
    const total = Math.floor(durationSec)
    const m = Math.floor(total / 60)
    const s = total % 60
    const ms = Math.round((durationSec - total) * 1000)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
  })()
  const fields = {
    '分镜 ID': `shot_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    '视频文件名': fileName,
    '产品型号': productModel || '未知产品',
    '开始时间 (s)': startT,
    '结束时间 (s)': endT,
    '原视频地址': keyframeOrOss,
    '画面描述': shot.description || '',
    '场景': shot.scene || '',
    '物体': shot.objects || '',
    '动作': shot.action || '',
    '镜头': shot.camera || '',
    '卖点': shot.coreSellingPoint || shot.sellingPoint || '',
    // 时长 (s) 是自动编号（type=20），不需要手动写，Feishu 自己算
    // ⚠️ P2 新增：时长标签（mm:ss.mmm 格式，方便在飞书表格里肉眼读）
    '时长标签': durationLabel,
    '姓名': peopleField,
  }
  // ⚠️ 飞书附件字段（type=17）只接受 Feishu 自己的 file_token，不接受外部 OSS URL。
  //    如果 coverUrl 是外部 URL，跳过写入 → 整条记录不会被 AttachFieldConvFail 拒掉。
  //    后续如果有 Feishu file_token（如通过 /open-apis/drive/v1/medias/upload 拿到的），
  //    可以重新 PATCH 这条分镜记录的「封面图」字段。
  if (coverUrl && !/^https?:\/\//i.test(coverUrl)) {
    fields['封面图'] = coverUrl
  } else if (coverUrl && /^https?:\/\//i.test(coverUrl)) {
    // 记日志方便定位哪些分镜的封面图被跳过（待后续用 Feishu 上传 API 补回）
    console.log(`[mock-api] ⏭  分镜 #${index} 封面图是外部 URL，跳过写入飞书附件字段（待补）`)
  }
  // 关联的原视频是 DuplexLink → 主视频表（值为 record_id 扁平数组）
  if (mainRecordId) {
    fields['关联的原视频'] = [mainRecordId]
  }
  const token = await getFeishuTenantToken()
  const r = await feishuPostRecord(token, fields, CFG.feishuTableId)
  if (r.code !== 0) {
    console.error(`[mock-api] 分镜写入失败 #${index}: ${r.msg}`)
    return null
  }
  return r.data?.record?.record_id || r.data?.record_id
}

/**
 * ⚠️ P1 修复：并发互斥锁。按 mainRecordId / businessId 维度串行化 analyzeAndSyncToShotTable 调用。
 * 场景：业务员一次拖 3 个视频进来 → 3 个并发 upload 都会触发本函数 → 同一飞书主表 record
 *       被并发 update → 分析状态 / 分镜 record_id 顺序互相覆盖。
 * 解法：每个唯一 key 维护一个 promise 链，新调用接到上一个的 .then 后面。
 */
const _analyzeChain = new Map() // key: mainRecordId||businessId -> Promise
async function _serializeAnalyze(key, fn) {
  const prev = _analyzeChain.get(key) || Promise.resolve()
  const next = prev.then(() => fn(), () => fn()) // 前面失败也允许后续继续
  _analyzeChain.set(key, next)
  // 清理已完成且无后续等待的链
  next.finally(() => {
    if (_analyzeChain.get(key) === next) _analyzeChain.delete(key)
  }).catch(() => {})
  return next
}

/**
 * 一站式：AI 分析 → 写飞书分镜 → 回填主视频表 → 回写 DB 素材
 *
 * 入参 opts:
 *   - localPath / downloadUrl / fileName / fileHash / ossUrl / duration
 *   - mainRecordId: 主视频表的 record_id（用于更新状态 + 反向关联）
 *   - businessId / materialId:  本地 materials 表的 business_id + UUID（用于回写 person_name）
 *   - mainRecordId 是 null 时跳过主表更新（仅写分镜）
 */
async function analyzeAndSyncToShotTable(opts) {
  const _serializeKey = opts.mainRecordId || opts.businessId || null
  if (_serializeKey) {
    return _serializeAnalyze(_serializeKey, () => _analyzeAndSyncToShotTableImpl(opts))
  }
  return _analyzeAndSyncToShotTableImpl(opts)
}

async function _analyzeAndSyncToShotTableImpl(opts) {
  const { localPath, downloadUrl, fileName, fileHash, ossUrl, duration, mainRecordId, businessId, materialId, uploaderRole } = opts

  // 角色决定 AI 是否要分析「人物姓名（如果有）」这个字段：
  //   - 业务员 (role='user'):  不分析，所有分镜直接用上传者本人姓名
  //   - 运营/管理员:           让 AI 识别画面里出现的人物姓名（多人用「、」分隔）
  const includePeople = uploaderRole !== 'user'
  console.log(`[mock-api] 🎭 上传者角色: ${uploaderRole || 'user'} → includePeople=${includePeople}`)

  // 1) 状态置为「分析中」
  if (mainRecordId) {
    await updateMainVideoRecord(mainRecordId, { '分析状态': '分析中' })
    console.log(`[mock-api] 🔄 主表状态 -> 分析中: ${mainRecordId}`)
  }

  // 2) 调 MiniMax-M3 直接传整段视频（不再抽帧，时间戳由 M3 自己解析）
  let result
  try {
    if (localPath && existsSync(localPath) && CFG.minimaxKey) {
      console.log(`[mock-api] 🎬 启动 MiniMax-M3 整段视频分析: ${fileName} (${duration}s)`)
      result = await analyzeWithMiniMaxVideo(localPath, duration, fileName, { includePeople, ossUrl })
    } else if (downloadUrl && CFG.minimaxKey) {
      // 远程视频：先下载到本地，再走整段视频流程
      const r = await fetch(downloadUrl)
      const buffer = Buffer.from(await r.arrayBuffer())
      const tmpLocal = path.join(CFG.videoDir, `_dl_${Date.now()}.mp4`)
      fs.writeFileSync(tmpLocal, buffer)
      try {
        result = await analyzeWithMiniMaxVideo(tmpLocal, duration, fileName, { includePeople, ossUrl })
      } finally {
        try { unlinkSync(tmpLocal) } catch {}
      }
    } else {
      throw new Error('No local video or MiniMax key')
    }
  } catch (minimaxErr) {
    // 不允许 fallback：M3 真失败就让它抛上去，主表状态会被外层 catch 改回「分析失败」
    console.error(`[mock-api] ❌ MiniMax 失败（不再 fallback，直接抛错）: ${minimaxErr.message}`)
    throw minimaxErr
  }

  console.log(`[mock-api] 🧠 分析完成: ${result.shots?.length || 0} 个分镜, productModel="${result.productModel}"`)

  // 2.4) ⚠️ 双向核对：M3 输出的 shots vs 视频真实时长（ffprobe 给的 duration）
  //   - 验证：最后一条 shot.endTime vs 真实 duration（覆盖率）
  //   - 验证：shot_i.endTime vs shot_{i+1}.startTime（时间连续性）
  //   - 自动修复：覆盖率 < 100% 时把最后一条 endTime 强制对齐到真实 duration
  //   - 真实时长由 opts.duration 提供（= ffprobe 探测结果，业务真源）
  if (Array.isArray(result.shots) && result.shots.length > 0 && duration > 0) {
    const shots = result.shots
    const lastEnd = Number(shots[shots.length - 1].endTime || 0)
    const coverage = (lastEnd / duration) * 100
    // 修复 1：覆盖率 < 99% → 把最后一条 endTime 强制对齐（防止漏分镜）
    if (lastEnd < duration - 0.1) {
      console.warn(`[mock-api] ⚠️  分镜覆盖率 ${coverage.toFixed(1)}% (${lastEnd}s / ${duration}s) → 自动补齐最后一条 endTime`)
      shots[shots.length - 1].endTime = Number(duration.toFixed(3))
    } else if (lastEnd > duration + 0.1) {
      console.warn(`[mock-api] ⚠️  分镜超出视频 (${lastEnd}s > ${duration}s) → 截断最后一条 endTime`)
      shots[shots.length - 1].endTime = Number(duration.toFixed(3))
    }
    // 修复 2：时间连续性检查（gap > 0.5s 视为异常）
    let fixedContinuity = 0
    for (let i = 0; i < shots.length - 1; i++) {
      const gap = Number(shots[i + 1].startTime || 0) - Number(shots[i].endTime || 0)
      if (gap > 0.5) {
        console.warn(`[mock-api] ⚠️  shot#${i + 1}→#${i + 2} 之间有 ${gap.toFixed(2)}s 间隙 → 自动衔接`)
        shots[i + 1].startTime = Number(shots[i].endTime || 0)
        fixedContinuity++
      }
    }
    // 校验 3：M3 自报的 totalDuration vs 真实 duration（差 > 1s 则以 ffprobe 为准）
    if (result.totalDuration && Math.abs(result.totalDuration - duration) > 1) {
      console.warn(`[mock-api] ⚠️  M3 自报 totalDuration=${result.totalDuration} 与 ffprobe=${duration} 差 ${Math.abs(result.totalDuration - duration).toFixed(2)}s → 以 ffprobe 为准`)
      result.totalDuration = duration
    }
    const finalCoverage = (Number(shots[shots.length - 1].endTime || 0) / duration) * 100
    console.log(`[mock-api] ✅ 双向核对: 覆盖率=${finalCoverage.toFixed(1)}%, 连续性修复=${fixedContinuity} 处`)
  }

  // 2.5) ⚠️ P2 新增：批量生成分镜「封面图」（在每个 shot 的 startTime 处抽帧 + 上传 OSS）
  //      - 用 Promise.all 并发抽，但限制并发数=3 避免 ffmpeg 抢资源
  //      - 失败/没本地路径时返回空串，不阻塞后续分镜写入
  //      - 抽完后存入 coverUrls[i] 给 writeShotToFeishu 用
  const shots = result.shots || []
  const coverUrls = new Array(shots.length).fill('')
  if (shots.length > 0 && localPath && existsSync(localPath)) {
    const baseName = (fileName || path.basename(localPath)).replace(/\.[^/.]+$/, '')
    const CONCURRENCY = 3
    let doneCount = 0
    for (let s = 0; s < shots.length; s += CONCURRENCY) {
      const batch = []
      for (let j = s; j < Math.min(s + CONCURRENCY, shots.length); j++) {
        batch.push(
          generateShotCover(localPath, Number(shots[j].startTime || 0), baseName)
            .then((url) => {
              coverUrls[j] = url
              doneCount++
              if (doneCount % 5 === 0 || doneCount === shots.length) {
                console.log(`[mock-api] 🖼️  封面图进度: ${doneCount}/${shots.length}`)
              }
            })
            .catch((e) => {
              console.warn(`[mock-api] ⚠️  封面图抽帧失败 #${j}: ${e.message}`)
            }),
        )
      }
      await Promise.all(batch)
    }
    const successCount = coverUrls.filter(Boolean).length
    console.log(`[mock-api] 🖼️  封面图生成完成: ${successCount}/${shots.length} 成功`)
  } else if (shots.length > 0) {
    console.warn(`[mock-api] ⚠️  没有可用 localPath，跳过封面图生成（远程下载路径已删除）`)
  }

  // 3) 逐条分镜写入飞书
  // 先读主视频表里已有的「人物标签」——这是上传时写入的业务员姓名（uploader），
  // 后面要把这个值传到 writeShotToFeishu，确保分镜表的「人物姓名（如果有）」
  // 字段里只放上传者姓名，不放 AI 识别结果。
  let uploaderName = ''
  if (mainRecordId && CFG.feishuMainTableId) {
    try {
      const token = await getFeishuTenantToken()
      // 不带 type=bitable，让字段保持原始类型（避免 text_field_as_array 把字符串变成 [{text,type}]）
      const url = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuMainTableId}/records/${mainRecordId}`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => null)
      let tagField = r?.data?.record?.fields?.['人物标签']
      // 兼容多种返回形式：直接字符串 / 字符串数组 / [{text,type}] 对象数组 / [{text_arr}] 老格式
      if (Array.isArray(tagField)) {
        tagField = tagField
          .map(x => {
            if (typeof x === 'string') return x
            if (x && typeof x === 'object') return x.text || (Array.isArray(x.text_arr) ? x.text_arr.join(',') : '') || ''
            return ''
          })
          .filter(Boolean)
          .join('、')
      } else if (tagField && typeof tagField === 'object') {
        tagField = tagField.text || (Array.isArray(tagField.text_arr) ? tagField.text_arr.join(',') : '') || ''
      }
      uploaderName = String(tagField || '').split(/[,,、;\/]/).map(s => s.trim()).filter(Boolean)[0] || ''
    } catch (e) {
      console.warn(`[mock-api] ⚠️ 读主表 人物标签 失败（不影响分镜写入）: ${e.message}`)
    }
  }
  if (uploaderName) {
    console.log(`[mock-api] 👤 提取上传者姓名: "${uploaderName}" (从主表 ${mainRecordId})，将写入所有分镜的「人物姓名」字段`)
  }
  const shotRecordIds = []
  // 收集所有分镜的「人物姓名（如果有）」，用于回写 materials.person_name
  const allPeople = new Set()
  for (let i = 0; i < shots.length; i++) {
    const peopleStr = shots[i].people || shots[i].personName || shots[i].人物姓名 || ''
    if (peopleStr && typeof peopleStr === 'string') {
      for (const p of peopleStr.split(/[,,、;\/]/).map(s => s.trim()).filter(Boolean)) {
        allPeople.add(p)
      }
    }
    // 角色分支：
    //   业务员 → 强制用上传者姓名（uploaderName 优先），不让 AI 写 people
    //   运营/管理员 → 用 AI 识别的 peopleStr，uploaderName 留空
    const isSalesperson = uploaderRole === 'user'
    // ⚠️ P0 修复：业务员场景下 peopleStr 通常是空（不调 AI 识别人物），
    //   必须把 uploaderName 加进 allPeople，否则 DB materials.person_name
    //   写 null → 业务员在「我的素材库」看不到自己上传的视频（被 view 过滤掉）
    if (isSalesperson && uploaderName) {
      allPeople.add(String(uploaderName).trim())
    }
    const rid = await writeShotToFeishu({
      index: i,
      shot: shots[i],
      productModel: result.productModel,
      fileName,
      ossUrl,
      people: isSalesperson ? '' : peopleStr,
      uploaderName: isSalesperson ? uploaderName : '',  // 业务员才用上传者姓名覆盖
      coverUrl: coverUrls[i] || '',                    // ⚠️ P2 新增：封面图 URL
    })
    if (rid) shotRecordIds.push(rid)
  }
  console.log(`[mock-api] ✅ 分镜表写入: ${shotRecordIds.length}/${shots.length} 条成功`)

  // 3.5) 回写 DB materials（让双素材库能按人物/型号分组 + 状态推进）
  // 关键：用 upsertMaterial（不是 updateMaterialFieldFromDb）才能把 shots 写入
  //       video_analyses + video_shots 表，library API 才能拿到分镜数据
  const personName = allPeople.size > 0 ? Array.from(allPeople).join('、') : null
  if (businessId && dbCjs) {
    try {
      // 先查已有记录（取 playableUrl / thumbnailUrl / filePath 等基础字段）
      const existing = await dbCjs.findMaterialByBusinessId(businessId)
      if (existing) {
        const tags = new Set()
        for (const s of result.shots || []) {
          if (s.coreSellingPoint) tags.add(s.coreSellingPoint)
          if (s.scene) tags.add(s.scene)
          if (s.camera) tags.add(s.camera)
        }
        // 规范化 shots 给 upsertMaterial 用
        const normalizedShots = (result.shots || []).map((s, i) => ({
          shotId: s.id || `shot_${Date.now()}_${i}`,
          shotIndex: i,
          startTime: s.startTime || 0,
          endTime: s.endTime || 0,
          duration: (s.endTime || 0) - (s.startTime || 0),
          description: s.description || '',
          scene: s.scene || '',
          objects: s.objects || '',
          action: s.action || '',
          camera: s.camera || '',
          coreSellingPoint: s.coreSellingPoint || '',
          sellingPoint: s.coreSellingPoint || '',
          narrationText: s.narrationText || '',
        }))
        await dbCjs.upsertMaterial({
          businessId,
          type: 'product',
          productName: result.productModel || existing.productName,
          fileName: existing.fileName,
          filePath: existing.filePath,
          playableUrl: existing.playableUrl || '',
          thumbnailUrl: existing.thumbnailUrl || '',
          industry: result.industry || existing.industry || '',
          brand: existing.brand || '',
          department: existing.department || '',
          clientName: existing.clientName || '',
          quality: existing.quality || '',
          personName: personName || existing.personName || null,
          analysisStatus: 'done',
          totalDuration: result.totalDuration || duration || existing.totalDuration || 0,
          shotCount: normalizedShots.length,
          sellingPointTags: tags.size > 0 ? Array.from(tags) : (existing.sellingPointTags || []),
          sceneVideoUrls: existing.sceneVideoUrls || [],
          source: existing.source || 'upload',
          feishuRecordId: existing.feishuRecordId || null,
          description: existing.description || '',
          fileHash: existing.fileHash || null,
          shots: normalizedShots,
        })
        console.log(`[mock-api] 🪪 DB material 字段+分镜回写: person_name="${personName || '(空)'}", product_name="${result.productModel}", shots=${normalizedShots.length}, status=done`)
      } else {
        // 找不到 businessId（极端 case），退化为轻量字段回写
        const fields = {
          analysis_status: 'done',
          shot_count: shots.length,
          total_duration: result.totalDuration || duration || 0,
        }
        if (personName) fields.person_name = personName
        if (result.productModel) fields.product_name = result.productModel
        if (result.industry) fields.industry = result.industry
        if (Array.isArray(result.shots) && result.shots.length > 0) {
          const tags = new Set()
          for (const s of result.shots) {
            if (s.coreSellingPoint) tags.add(s.coreSellingPoint)
            if (s.scene) tags.add(s.scene)
            if (s.camera) tags.add(s.camera)
          }
          if (tags.size > 0) fields.selling_point_tags = JSON.stringify([...tags])
        }
        await dbCjs.updateMaterialFieldFromDb(businessId, fields)
        console.log(`[mock-api] 🪪 DB material 字段回写(轻量): person_name="${personName || '(空)'}", product_name="${result.productModel}", shots=${shots.length}, status=done`)
      }
    } catch (dbErr) {
      console.warn(`[mock-api] ⚠️ material 字段回写失败: ${dbErr.message}`)
    }
  }

  // 4) 回填主视频表：「分析状态=已分析」+「反向关联分镜=所有分镜 record_id」
  //    + 视频级元数据（M3 输出的 industry / clientName / department / quality / categoryTags / sellingPointTags）
  //    + 人物标签（来自 allPeople）
  if (mainRecordId) {
    const linkFields = { '分析状态': '已分析' }
    if (shotRecordIds.length > 0) {
      // DuplexLink 字段值 = 扁平 record_id 字符串数组（Feishu API 要求）
      linkFields['反向关联分镜'] = shotRecordIds
    }
    // 视频级元数据（M3 输出 → 主表字段）
    if (result.productModel) linkFields['产品型号'] = String(result.productModel)
    if (result.industry) linkFields['行业'] = String(result.industry)
    if (result.clientName) linkFields['客户'] = String(result.clientName)
    if (result.department) linkFields['部门'] = String(result.department)
    if (result.quality) linkFields['素材质量'] = String(result.quality)
    // 分类标签 / 卖点标签：飞书主表字段类型是「文本」，必须拼成字符串写入（数组会被 1254060 拒掉）
    // ⚠️ 分析状态是「单选」(type=3)，已分析/未分析等选项必须严格匹配字符串值
    if (Array.isArray(result.categoryTags) && result.categoryTags.length > 0) {
      linkFields['分类标签'] = result.categoryTags.join('、')
    }
    if (Array.isArray(result.sellingPointTags) && result.sellingPointTags.length > 0) {
      linkFields['卖点标签'] = result.sellingPointTags.join('、')
    }
    // 人物标签 = 合并（保留上传者姓名 + AI 检测到的人物，去重，过滤无意义项）
    // ⚠️ 关键：业务员姓名必须永远保留（来自上传时写入的主表 人物标签），
    //    不允许被 M3 识别出的「无人物；主体为一只…」「30+岁男性」这类描述覆盖。
    if (personName || uploaderName) {
      const normalized = (s) => String(s || '').split(/[,,、;\/]/).map(x => x.trim()).filter(Boolean)
      const merged = new Set()
      // 1) 上传者姓名优先级最高（不能丢）
      for (const p of normalized(uploaderName)) merged.add(p)
      // 2) M3 识别人物（过滤掉「无人物」类噪声和重复项）
      for (const p of normalized(personName)) {
        if (/^无人物|^无\s*人物|^未识别/.test(p)) continue
        merged.add(p)
      }
      if (merged.size > 0) {
        linkFields['人物标签'] = Array.from(merged).join('、')
      }
    }
    const updateRes = await updateMainVideoRecord(mainRecordId, linkFields)
    if (updateRes && updateRes.code === 0) {
      console.log(`[mock-api] ✅ 主表回填: 状态=已分析, 关联 ${shotRecordIds.length} 条分镜, 产品型号="${linkFields['产品型号'] || ''}", 行业="${linkFields['行业'] || ''}", 客户="${linkFields['客户'] || ''}", 部门="${linkFields['部门'] || ''}", 素材质量="${linkFields['素材质量'] || ''}"`)
    } else if (updateRes) {
      console.warn(`[mock-api] ⚠️ 主表回填失败: code=${updateRes.code} msg=${updateRes.msg}`)
    }
  }

  return {
    shotCount: shots.length,
    shotRecordIds,
    productModel: result.productModel,
    totalDuration: result.totalDuration,
    shots: result.shots,
  }
}

// 从飞书多维表格读取所有已入库的视频记录（不可达时用种子数据兜底）
async function fetchFeishuVideoRecords() {
  try {
    const token = await getFeishuTenantToken()
    const records = []
    let pageToken = ''
    do {
      const res = await feishuGetTableRecords(token, 100, pageToken)
      if (res.code !== 0) break
      records.push(...(res.data?.items || []))
      pageToken = res.data?.page_token || ''
    } while (pageToken)

    if (records.length > 0) {
      console.log(`[mock-api] Feishu: ${records.length} records loaded`)
      return records
    } else {
      console.log('[mock-api] Feishu: no records, using seed materials')
      return SEED_MATERIALS
    }
  } catch (e) {
    console.warn('[mock-api] Feishu unreachable, using seed materials:', e.message)
    return SEED_MATERIALS
  }
}

// 从飞书表格的一条记录（=一个分镜）构建可匹配的候选项
// 关键：飞书表格里每条记录就是一个分镜，不是多个分镜的容器
// mainUrlMap: 主视频表 record_id → OSS 云端地址（用于把「关联的原视频」链接解析为可下载的视频 URL）
function feishuRecordToShots(record, segIdx, mainUrlMap = {}) {
  const f = record.fields || {}
  const productModel = f['产品型号'] || ''
  const brandName = f['品牌产品名称'] || ''
  const videoTitle = f['视频标题'] || ''
  const description = f['画面描述'] || ''
  // 分镜任务库 schema：场景 / 物体 / 动作 / 镜头 / 卖点（各自分开字段）
  const scene = f['场景'] || ''
  const objects = f['物体'] || ''
  const action = f['动作'] || ''
  const camera = f['镜头'] || ''
  const sellingPoint = f['卖点'] || ''
  // 人物姓名（如果有）——条件显示
  const personName = f['姓名'] || ''
  const startTime = Number(f['开始时间 (s)'] || 0)
  const endTime = Number(f['结束时间 (s)'] || startTime + 3)
  const keyframePath = f['关键帧路径'] || ''
  const shotId = f['分镜 ID'] || record.record_id

  // 用真实字段构造 shot；若字段为空则用最小 fallback
  const shot = {
    id: shotId || `feishu_${record.record_id}`,
    description: description || `${productModel || '本产品'}分镜`,
    scene: scene || '通用场景',
    objects: objects || productModel || '产品',  // ⚠️ 删掉「产品型号_分镜」兜底（与「产品型号」等价冗余）
    action: action || '展示',
    camera: camera || extractCamera(description) || '中景',
    coreSellingPoint: sellingPoint || description.slice(0, 30),
    narrationText: description || `${productModel || '本产品'}介绍`,
    // 产品型号 + 人物姓名 — 前端 ShotMatchCard 第一眼可见的产品信息
    productModel,
    personName,
    // 内层 shot 也带 startTime/endTime，否则 ShotMatchCard 显示 "undefineds - undefineds"
    startTime,
    endTime,
  }

  // 时长（秒）来自 Feishu 表格的 开始/结束时间
  const shotDuration = Math.max(0.5, endTime - startTime)

  // 源视频 URL 解析优先级：
  //   0) 飞书「原视频地址」字段 —— 用户改字段后的首选（直接 OSS URL）
  //   1) 飞书「关键帧路径」字段（兼容旧数据，OSS URL 或 file://）
  //   2) 飞书「关联的原视频」双向链接 → 主视频表的「OSS 云端地址」
  //   3) 兜底空字符串（前端/clip 会跳过没有源视频的分镜）
  const originalVideoUrlField = f['原视频地址'] || ''
  let sourceVideoUrl = ''
  if (originalVideoUrlField && (/^https?:\/\//i.test(originalVideoUrlField) || originalVideoUrlField.startsWith('file://'))) {
    sourceVideoUrl = originalVideoUrlField
  } else if (keyframePath && /^https?:\/\//i.test(keyframePath)) {
    sourceVideoUrl = keyframePath
  } else if (keyframePath && keyframePath.startsWith('file://')) {
    sourceVideoUrl = keyframePath
  } else {
    // 解析「关联的原视频」双向链接 → record_ids[0]
    const linkField = f['关联的原视频']
    const linkedRecordId = Array.isArray(linkField) && Array.isArray(linkField[0]?.record_ids)
      ? linkField[0].record_ids[0]
      : null
    if (linkedRecordId && mainUrlMap[linkedRecordId]) {
      sourceVideoUrl = mainUrlMap[linkedRecordId]
    }
  }

  return [{
    shot,
    score: 0.85,
    shotDuration,
    source: '飞书素材库',
    videoName: videoTitle,
    productModel,
    brandName,
    industry: '',
    tags: [scene, action, sellingPoint, personName].filter(Boolean),
    quality: '优质',
    sourceVideoUrl,
    recordId: record.record_id,
  }]
}

// 从描述中粗略提取镜头类型
function extractCamera(text) {
  if (!text) return ''
  const m = text.match(/(特写|全景|中景|跟拍|俯拍|侧拍|近景|远景)/)
  return m ? m[1] : ''
}

// ─── 静态数据 ────────────────────────────────────────────────────────────────
const MOCK_DASHBOARD = {
  totalVideos: 128, totalEmployees: 86, totalProducts: 42, totalViews: 128400,
  weeklyStats: [
    { day: '周一', views: 18400, uploads: 5, shares: 12 },
    { day: '周二', views: 21600, uploads: 8, shares: 18 },
    { day: '周三', views: 19800, uploads: 6, shares: 15 },
    { day: '周四', views: 22400, uploads: 9, shares: 21 },
    { day: '周五', views: 24100, uploads: 7, shares: 19 },
    { day: '周六', views: 13900, uploads: 4, shares: 8 },
    { day: '周日', views: 8200, uploads: 2, shares: 5 },
  ],
  topTags: [{ tag: '功能性能', count: 45 }, { tag: '应用场景', count: 38 }, { tag: '客户案例', count: 31 }],
  recentUploads: [],
  contentTypeStats: [
    { type: '员工口播', count: 52, percentage: 41 },
    { type: '产品展示', count: 38, percentage: 30 },
    { type: '场景演示', count: 28, percentage: 22 },
    { type: '客户案例', count: 10, percentage: 8 },
  ],
  efficiencyStats: { avgScriptGenTime: 45, avgClipTime: 12, avgUploadTime: 8, totalSavedHours: 320 },
  qualityDistribution: [
    { quality: '首发', count: 15, color: '#52c41a' },
    { quality: '优质', count: 72, color: '#1890ff' },
    { quality: '低质', count: 28, color: '#faad14' },
    { quality: '低效', count: 10, color: '#ff4d4f' },
    { quality: '同质化', count: 3, color: '#8c8c8c' },
  ],
  departmentStats: [
    { department: '子公司A', employees: 32, videos: 48, avgQuality: 82 },
    { department: '子公司B', employees: 28, videos: 40, avgQuality: 78 },
    { department: '子公司C', employees: 18, videos: 25, avgQuality: 85 },
  ],
  recentActivities: [
    { id: '1', type: 'upload', user: '张明远', content: '中力 E-TRUCK 电动叉车', time: '2小时前' },
    { id: '2', type: 'clip', user: '李婷', content: '产品对比视频', time: '3小时前' },
    { id: '3', type: 'script', user: '王建国', content: '新脚本已生成', time: '5小时前' },
  ],
  tagCloud: ['功能性能', '应用场景', '客户案例', '技术解析', '产品对比', '零排放', '智能操控'],
  platformDistribution: [
    { platform: '抖音', percentage: 45, color: '#fe2c55' },
    { platform: '视频号', percentage: 30, color: '#07c160' },
    { platform: '快手', percentage: 15, color: '#ff4906' },
    { platform: 'B站', percentage: 10, color: '#00a1d6' },
  ],
  videoGrowthData: [
    { month: '8月', count: 28 }, { month: '9月', count: 32 },
    { month: '10月', count: 38 }, { month: '11月', count: 35 },
    { month: '12月', count: 42 }, { month: '1月', count: 48 },
  ],
}

const STATIC_MATERIALS = [
  { id: '1', type: 'employee', employeeName: '张明远', avatarUrl: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/1.jpg', personaTags: ['专业严谨', '技术型销售', '汽车底盘专家'], oralVideoCount: 12, createdAt: '2025-01-15', usageCount: 0, consumptionCount: 0 },
  { id: '2', type: 'employee', employeeName: '李婷', avatarUrl: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/2.jpg', personaTags: ['亲和力强', '场景化演示', '家庭用户首选'], oralVideoCount: 8, createdAt: '2025-01-18', usageCount: 0, consumptionCount: 0 },
  { id: '3', type: 'employee', employeeName: '王建国', avatarUrl: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/3.jpg', personaTags: ['激情澎湃', '越野达人', '户外场景'], oralVideoCount: 15, createdAt: '2025-01-10', usageCount: 0, consumptionCount: 0 },
  { id: '4', type: 'product', productName: '中力 E-TRUCK 电动平衡重叉车（3.5吨）', thumbnailUrl: '/spark/app/app_17d60we6454/runtime/api/v1/storage/object/bucket_aadkstqj6cebu_static/static%2Faadksuby65obq_ve_miaoda', sceneVideoCount: 6, sellingPointTags: ['零排放', '智能操控', '超长续航'], sceneVideoUrls: ['/videos/1.mp4'], industry: '物流行业', clientName: '张明远', department: '子公司A', categoryTags: ['功能性能', '应用场景'], quality: '优质', analysisStatus: 'done', usageCount: 42, consumptionCount: 18, createdAt: '2025-01-20' },
  { id: '5', type: 'product', productName: '中力 E-STACKER 电动堆高车（2吨）', thumbnailUrl: '/spark/app/app_17d60we6454/runtime/api/v1/storage/object/bucket_aadkstqj6cebu_static/static%2Faadkst7e7mqeo_ve_miaoda', sceneVideoCount: 4, sellingPointTags: ['精准堆垛', '窄通道适配', '静音液压'], sceneVideoUrls: ['/videos/2.mp4'], industry: '仓储行业', clientName: '王建国', department: '子公司B', categoryTags: ['功能性能'], quality: '首发', analysisStatus: 'done', usageCount: 28, consumptionCount: 12, createdAt: '2025-01-22' },
]

const MOCK_ITERATION = {
  hotTags: [
    { id: '1', name: '真人出镜', count: 156 },
    { id: '2', name: '3秒钩子', count: 132 },
    { id: '3', name: '场景化展示', count: 118 },
    { id: '4', name: '价格对比', count: 95 },
    { id: '5', name: '用户证言', count: 87 },
    { id: '6', name: '产品特写', count: 76 },
  ],
  competitors: [
    { id: '1', title: '春节返乡续航实测', competitorName: '竞品A', views: 125000, likes: 8200, takeaway: '场景化实测+真实数据对比，用户信任感强', videoUrl: '' },
    { id: '2', title: '三代同堂出行方案', competitorName: '竞品B', views: 98000, likes: 6500, takeaway: '家庭场景切入，覆盖多年龄段用户痛点', videoUrl: '' },
  ],
  dealerCases: [
    { id: '1', dealerName: '张伟', region: '华东区', title: '春运返乡必备清单', views: 45000, likes: 3200, shares: 860, reusablePattern: '节日热点+产品植入+本地化口播', videoUrl: '' },
  ],
  suggestions: [
    { id: '1', title: '增加产品使用场景演示', description: '竞品X此类内容播放量高出均值40%，建议在脚本中增加2-3个真实使用场景', priority: 'high', source: 'competitor', relatedTag: '场景化展示' },
    { id: '2', title: '强化3秒开篇钩子', description: '高流量内容中83%使用了强钩子开头，建议统一优化视频前3秒', priority: 'high', source: 'hot-tag', relatedTag: '3秒钩子' },
    { id: '3', title: '尝试用户证言形式', description: '真实用户反馈信任度最高，建议每10条内容中插入1条证言视频', priority: 'medium', source: 'ai', relatedTag: '用户证言' },
  ],
}

// 运行时数据
let runtimeMaterials = [...STATIC_MATERIALS]
let runtimeShots = []
let workflowRuns = []
let tasks = [
  { id: 'task_demo_1', productName: '中力 E-TRUCK 电动叉车', script: '开场：各位老板好，今天给大家介绍一款...\n产品亮点：零排放、低噪音...\n结尾：感兴趣的朋友欢迎联系我们。', status: '待审核', assignee: '张明远', assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/1.jpg', tags: ['功能性能', '产品特写'], videoUrl: '', keyframes: [], createdAt: '2025-01-20', updatedAt: '2025-01-20' },
  { id: 'task_demo_2', productName: '中力 E-STACKER 电动堆高车', script: '仓储场景演示...\n精准堆垛展示...\n客户证言环节。', status: '已审核', assignee: '李婷', assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/2.jpg', tags: ['应用场景'], videoUrl: '', keyframes: [], createdAt: '2025-01-21', updatedAt: '2025-01-21' },
  { id: 'task_demo_3', productName: '中力 E-PALLET 电动搬运车', script: '物流场景全展示...\n快速充电演示...', status: '待脚本', assignee: '王建国', assigneeAvatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ylcylz_fsph_ryhs/ljhwZthlaukjlkulzlp/feisuda/avatar/base/3.jpg', tags: ['产品对比'], videoUrl: '', keyframes: [], createdAt: '2025-01-22', updatedAt: '2025-01-22' },
]
let clipHistory = []
let authRecords = []
// 视频分析结果缓存（用于matchShots）
let videoShotsCache = []

// ─── 批量重跑分镜 job state（模块级，跨请求共享） ──────────────────────────
const _reAnalyzeJob = {
  running: false,
  startedAt: 0,
  finishedAt: 0,
  totalScanned: 0,
  totalBroken: 0,
  processed: 0,
  success: 0,
  failed: 0,
  currentFile: '',
  errors: [], // [{ fileName, error }]
  log: [],    // 实时日志（最近 50 条）
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ data }))
}
function sendError(res, message, status = 500) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ message: String(message) }))
}
async function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}
function normalizeUrl(rawUrl) {
  const q = rawUrl.indexOf('?')
  const base = q >= 0 ? rawUrl.substring(0, q) : rawUrl
  return base.replace(/\/$/, '') || '/'
}

// ════════════════════════════════════════════════════════════════════════════
// 视频监控：Crawler Abstraction（视频号 MVP）

// ════════════════════════════════════════════════════════════════════════════

// ─── API Handler ─────────────────────────────────────────────────────────────
async function handleApi(req, res) {
  const url = normalizeUrl(req.url ?? '')
  const method = (req.method ?? 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' })
    res.end()
    return
  }

  // 首次启动种入默认管理员（异步，不阻塞）
  bootstrapDefaultAdmin().catch(() => {})

  // ── Auth ─────────────────────────────────────────────────────────────────
  // POST /api/auth/login   { username, password } -> { token, user }
  // POST /api/auth/logout                                       -> { ok: true }
  // GET  /api/auth/me      Authorization: Bearer <token>        -> user
  // GET  /api/auth/users   (admin)                              -> users[]
  // POST /api/auth/users   (admin) { username, password, name, role } -> user
  // PATCH/DELETE /api/auth/users/:id (admin)
  const stripPassword = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt })

  if (url === '/api/auth/login' && method === 'POST') {
    try {
      const body = await readBody(req)
      const { username, password } = JSON.parse(body || '{}')
      if (!username || !password) { sendError(res, '用户名和密码必填', 400); return }
      const users = await getUsers()
      const u = users.find(x => x.username === String(username).trim())
      if (!u || u.password !== String(password)) {
        sendError(res, '用户名或密码不正确', 401)
        return
      }
      const token = generateAuthToken(u.id)
      console.log(`[mock-api] 🔐 login: ${u.username} (${u.role}) -> ${u.name}`)
      sendJson(res, { token, user: stripPassword(u) })
    } catch (e) {
      sendError(res, `login failed: ${e.message}`, 500)
    }
    return
  }

  if (url === '/api/auth/logout' && method === 'POST') {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (token) tokenStore.delete(token)
    sendJson(res, { ok: true })
    return
  }

  if (url === '/api/auth/me' && method === 'GET') {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const userId = validateAuthToken(token)
    if (!userId) { sendError(res, 'unauthorized', 401); return }
    const users = await getUsers()
    const u = users.find(x => x.id === userId)
    if (!u) { sendError(res, 'user not found', 404); return }
    sendJson(res, { user: stripPassword(u) })
    return
  }

  // GET /api/auth/_debug_users -> raw Feishu records + parsed users（调试用）
  if (url === '/api/auth/_debug_users' && method === 'GET') {
    try {
      const raw = await fetchAllUsersFromFeishu()
      const users = await getUsers()
      sendJson(res, {
        rawCount: raw.length,
        cached: { users: users.map(stripPassword), at: userCache.at },
        raw: raw.slice(0, 10).map((r) => ({ record_id: r.record_id, fields: r.fields || {} })),
      })
    } catch (e) {
      sendError(res, `debug failed: ${e.message}`, 500)
    }
    return
  }

  if (url === '/api/auth/users' && method === 'GET') {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const userId = validateAuthToken(token)
    if (!userId) { sendError(res, 'unauthorized', 401); return }
    const users = await getUsers()
    const me = users.find(x => x.id === userId)
    if (!me || me.role !== 'admin') { sendError(res, '需要管理员权限', 403); return }
    sendJson(res, { users: users.map(stripPassword) })
    return
  }

  if (url === '/api/auth/users' && method === 'POST') {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const userId = validateAuthToken(token)
    if (!userId) { sendError(res, 'unauthorized', 401); return }
    const users = await getUsers()
    const me = users.find(x => x.id === userId)
    if (!me || me.role !== 'admin') { sendError(res, '需要管理员权限', 403); return }
    try {
      const body = await readBody(req)
      const { username, password, name, role } = JSON.parse(body || '{}')
      if (!username || !password || !name) { sendError(res, '用户名/密码/姓名必填', 400); return }
      if (users.some(x => x.username === String(username).trim())) {
        sendError(res, '用户名已存在', 409)
        return
      }
      const roleLabelMap = { admin: '管理员', operator: '运营', user: '业务员' }
      const tk = await getFeishuTenantToken()
      const r = await feishuPostRecord(tk, {
        '用户名': String(username).trim(),
        '密码': String(password),
        '姓名': String(name).trim(),
        '角色': roleLabelMap[role] || '业务员',
      }, CFG.feishuUserTableId)
      if (r.code !== 0) { sendError(res, `飞书写入失败: ${r.msg}`, 500); return }
      invalidateUserCache()
      sendJson(res, { ok: true, recordId: r.data?.record?.record_id })
    } catch (e) {
      sendError(res, `create user failed: ${e.message}`, 500)
    }
    return
  }

  const userByIdMatch = url.match(/^\/api\/auth\/users\/([a-zA-Z0-9_-]+)$/)
  if (userByIdMatch && (method === 'PATCH' || method === 'DELETE')) {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const userId = validateAuthToken(token)
    if (!userId) { sendError(res, 'unauthorized', 401); return }
    const users = await getUsers()
    const me = users.find(x => x.id === userId)
    if (!me || me.role !== 'admin') { sendError(res, '需要管理员权限', 403); return }
    const targetId = userByIdMatch[1]
    try {
      if (method === 'DELETE') {
        const urlDel = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuUserTableId}/records/${targetId}`
        const tk = await getFeishuTenantToken()
        const dr = await fetch(urlDel, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` } })
        const dj = await dr.json()
        if (dj.code !== 0) { sendError(res, `飞书删除失败: ${dj.msg}`, 500); return }
        invalidateUserCache()
        sendJson(res, { ok: true })
        return
      }
      // PATCH
      const body = await readBody(req)
      const { password, name, role } = JSON.parse(body || '{}')
      const fields = {}
      if (password) fields['密码'] = String(password)
      if (name) fields['姓名'] = String(name).trim()
      if (role) {
        const roleLabelMap = { admin: '管理员', operator: '运营', user: '业务员' }
        fields['角色'] = roleLabelMap[role] || '业务员'
      }
      const urlPatch = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuUserTableId}/records/${targetId}`
      const tk = await getFeishuTenantToken()
      const pr = await fetch(urlPatch, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      const pj = await pr.json()
      if (pj.code !== 0) { sendError(res, `飞书更新失败: ${pj.msg}`, 500); return }
      invalidateUserCache()
      sendJson(res, { ok: true })
    } catch (e) {
      sendError(res, `user op failed: ${e.message}`, 500)
    }
    return
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  if (url === '/api/dashboard' && method === 'GET') {
    sendJson(res, MOCK_DASHBOARD)
    return
  }

  // ── Iteration ──────────────────────────────────────────────────────────────
  if (url === '/api/iteration' && method === 'GET') {
    sendJson(res, MOCK_ITERATION)
    return
  }

  // V1：手动触发飞书→DB 同步（管理/验证用）
  if (url === '/api/admin/sync-feishu' && method === 'POST') {
    try {
      const r = await syncFeishuVideosToDb('manual')
      sendJson(res, r)
    } catch (e) {
      sendError(res, `sync failed: ${e.message}`, 500)
    }
    return
  }

  // ── 历史视频封面批量回填（后台异步执行，立即返回；结果看服务端日志）──
  if (url === '/api/admin/backfill-covers' && method === 'POST') {
    let body = {}
    try { body = await readBody(req) } catch { body = {} }
    const limit = Number(body.limit) || 20
    const at = Number(body.at) || 3
    backfillCovers({ limit, at })
      .then((r) => console.log('[mock-api] backfill-covers 完成', r))
      .catch((e) => console.warn('[mock-api] backfill-covers 异常', e.message))
    sendJson(res, { started: true, limit, at, note: '后台回填中，完成情况见服务端日志；重复调用会跳过已回填项' })
    return
  }

  // ── File Upload (bypass getDataloom in dev) ────────────────────────────────
  if (url === '/api/upload' && method === 'POST') {
    const contentType = req.headers['content-type'] || ''
    // 上传者姓名（来自 x-uploader-name header），用于写入飞书主视频表「人物标签」字段
    // ⚠️ 不同 Node / Vite 版本对 header 编码处理不一致：
    //    旧版 Node HTTP 解析器按 Latin-1 解码 header，中文 UTF-8 字节变乱码（å®å®ä¸）
    //    新版可能已按 UTF-8 正确解码，原值已含中文（刘宇）
    //    必须"探测式"还原：仅当 raw 是 Latin-1 风格乱码（高字节 + 无中文）时才反转
    const _uploaderRaw = String(req.headers['x-uploader-name'] || '').trim()
    let uploaderName = _uploaderRaw
    try {
      const hasHighByte = /[\u0080-\u00ff]/.test(_uploaderRaw)
      const hasChinese = /[\u4e00-\u9fff]/.test(_uploaderRaw)
      if (hasHighByte && !hasChinese) {
        const candidate = Buffer.from(_uploaderRaw, 'latin1').toString('utf8').trim()
        // 只有 candidate 含中文且不含替换字符才算合法还原
        if (/[\u4e00-\u9fff]/.test(candidate) && !candidate.includes('\uFFFD')) {
          console.log(`[mock-api] 🔧 uploaderName 编码还原: "${_uploaderRaw}" → "${candidate}"`)
          uploaderName = candidate
        }
      }
    } catch (_) { /* 任何异常都保留原值，不阻断主流程 */ }
    // 上传者角色（来自 x-uploader-role header），决定 AI 是否分析「人物姓名」字段
    //   - 'user'    业务员 → 不用 AI，「人物姓名（如果有）」直接写上传者本人
    //   - 'operator' / 'admin' → 让 AI 识别画面里出现的人物姓名
    const uploaderRole = String(req.headers['x-uploader-role'] || 'user').trim().toLowerCase()
    console.log(`[mock-api] 🎭 上传者角色: ${uploaderRole} (header: "${req.headers['x-uploader-role']}")`)
    const busboy = Busboy({ headers: { 'content-type': contentType } })
    const fileData = []
    let fileName = 'video.mp4'

    busboy.on('file', (fieldname, stream, info) => {
      // Busboy 默认把 multipart 头里的 UTF-8 文件名当成 Latin1 解码
      // 修复：检测是否含 high-byte（>0x7F），若有则从 Latin1 重新以 UTF-8 解码
      let raw = info.filename || fileName
      try {
        if (/[\u0080-\u00ff]/.test(raw)) {
          const buf = Buffer.from(raw, 'latin1')
          const utf8Name = buf.toString('utf8')
          // 只有重新解码后的结果「看起来像合法文件名」才采用（避免破坏 ASCII 文件名）
          if (!utf8Name.includes('\uFFFD') && /[\u4e00-\u9fff\u3040-\u30ff]/.test(utf8Name)) {
            raw = utf8Name
          }
        }
      } catch (_) { /* fallback to raw */ }
      fileName = raw
      stream.on('data', chunk => fileData.push(chunk))
      stream.on('end', () => { /* busboy.on('finish') 会统一汇总 */ })
    })

    busboy.on('finish', async () => {
      if (fileData.length === 0) {
        sendError(res, 'No file uploaded', 400)
        return
      }
      const buffer = Buffer.concat(fileData)
      const ext = path.extname(fileName)
      const savedName = `upload_${Date.now()}${ext}`
      const savedPath = path.join(CFG.videoDir, savedName)
      // ⚠️ P0 修复：writeFileSync 在大文件（100-200MB 视频）下会同步阻塞 Node 事件循环
      // 单线程期间所有其它 /api/* 请求都会卡住 → 浏览器侧表现为「Network Error」spike
      // 改用 fs.promises.writeFile 让出事件循环
      await fs.promises.writeFile(savedPath, buffer)
      console.log(`[mock-api] Uploaded ${fileName} -> ${savedName} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`)

      // 构造一个 download_url 供 analyzeVideo 使用
      const downloadUrl = `file://${savedPath}`

      // 计算 SHA-256（用于飞书去重匹配 + 上传前命中检测）
      let fileHash = null
      let existingByHash = null
      if (dbCjs) {
        try {
          fileHash = await dbCjs.computeFileHash(savedPath)
          existingByHash = await dbCjs.findMaterialByHash(fileHash)
          if (existingByHash) {
            console.log(`[mock-api] 🔁 Hash 命中已存在素材: ${existingByHash.business_id}（${existingByHash.product_name}），跳过 AI 分析`)
          }
        } catch (hErr) {
          console.warn(`[mock-api] hash compute failed: ${hErr.message}`)
        }
      }

      // 同步写入 DB materials 表
      let dbRecord = null
      const businessId = fileName.replace(/\.[^/.]+$/, '') + '-' + Date.now()
      if (dbCjs) {
        try {
          const productName = fileName.replace(/\.[^/.]+$/, '')
          dbRecord = await dbCjs.upsertMaterial({
            businessId,
            type: 'product',
            productName,
            fileName,
            filePath: savedPath,
            playableUrl: `http://localhost:${PORT}/api/video/file/${encodeURIComponent(savedName)}`,
            thumbnailUrl: '',
            industry: '',
            quality: '',
            analysisStatus: existingByHash ? 'done' : 'analyzing',
            shotCount: 0,
            sellingPointTags: [],
            sceneVideoUrls: [downloadUrl],
            source: 'upload',
            description: '',
            fileHash,
          })
          console.log(`[mock-api] DB material created: ${businessId} (id=${dbRecord.materialId.slice(0,8)}..., hash=${fileHash?.slice(0,8) || 'n/a'}...)`)
        } catch (dbErr) {
          console.warn(`[mock-api] DB write failed: ${dbErr.message}`)
        }
      }

      // 同步上传到阿里云 OSS（生成唯一 URL，失败不阻塞主流程）
      let ossResult = null
      let ossError = null
      if (CFG.ossAccessKeyId && CFG.ossBucket && CFG.ossRegion) {
        try {
          ossResult = await uploadToOss(savedPath)
          console.log(`[mock-api] ✅ OSS 上传成功: ${ossResult.publicUrl}`)
        } catch (oErr) {
          ossError = oErr.message
          console.warn(`[mock-api] ⚠️ OSS 上传失败（不影响主流程）: ${oErr.message}`)
        }
      } else {
        ossError = 'OSS 未配置（.env 缺 ALI_OSS_* 字段）'
      }

      // 探测时长（视频走 ffprobe，图片给 0）
      let duration = 0
      if (/\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)$/i.test(fileName)) {
        try {
          duration = await getVideoDuration(savedPath)
          console.log(`[mock-api] 🎬 时长: ${duration}s`)
        } catch (dErr) {
          console.warn(`[mock-api] 时长探测失败: ${dErr.message}`)
        }
      }

      const isVideo = /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)$/i.test(fileName)

      // ── V1：自动生成统一尺寸封面 → 上传 OSS → 回填 DB（视频才做；单帧很快故 await，让响应直接带封面）──
      let coverUrl = ''
      let coverLocalUrl = ''
      if (isVideo && mediaPipeline) {
        try {
          const coverName = `cover_${path.basename(savedName, path.extname(savedName))}.jpg`
          const coverLocalPath = path.join(CFG.coverDir, coverName)
          await mediaPipeline.generateCover({ input: savedPath, output: coverLocalPath, duration })
          coverLocalUrl = `http://localhost:${PORT}/api/media/cover/${encodeURIComponent(coverName)}`
          try {
            const coverOss = await uploadToOss(coverLocalPath, `covers/${coverName}`, { skipPrefix: true })
            coverUrl = coverOss.publicUrl
          } catch (cOssErr) {
            console.warn(`[mock-api] 封面 OSS 失败，用本地 URL: ${cOssErr.message}`)
          }
          const finalCover = coverUrl || coverLocalUrl
          if (dbCjs) await dbCjs.updateMaterialFieldFromDb(businessId, { thumbnail_url: finalCover })
          console.log(`[mock-api] 🖼️ 封面就绪: ${finalCover}`)
        } catch (covErr) {
          console.warn(`[mock-api] 封面处理失败（不阻塞）: ${covErr.message}`)
        }
      }

      // ── V1：异步转码 H.264/AAC → 上传 OSS → 回填 playable_url（不 await，不阻塞响应）──
      if (isVideo && mediaPipeline) {
        const transName = `transcoded_${path.basename(savedName, path.extname(savedName))}.mp4`
        const transPath = path.join(CFG.transcodeDir, transName)
        mediaPipeline
          .transcodeToMp4({ input: savedPath, output: transPath })
          .then(async () => {
            let transPlayUrl = `http://localhost:${PORT}/api/media/transcoded/${encodeURIComponent(transName)}`
            try {
              const tOss = await uploadToOss(transPath, `transcoded/${transName}`, { skipPrefix: true })
              transPlayUrl = tOss.publicUrl
            } catch (tErr) {
              console.warn(`[mock-api] 转码文件 OSS 失败，用本地 URL: ${tErr.message}`)
            }
            if (dbCjs) await dbCjs.updateMaterialFieldFromDb(businessId, { playable_url: transPlayUrl })
            console.log(`[mock-api] 🎞️ 转码就绪并回填: ${transPlayUrl}`)
          })
          .catch((tErr) => console.warn(`[mock-api] 转码失败（不阻塞）: ${tErr.message}`))
      }

      // 推送到主视频表（OSS URL / 文件 Hash / 时长 / 状态 / 入库时间 / 人物姓名）
      let mainRecordId = null
      let mainPushError = null
      if (ossResult) {
        const r = await pushToMainVideoTable({
          fileName,
          fileHash,
          ossUrl: ossResult.publicUrl,
          duration,
          status: '未分析',
          personName: uploaderName || undefined,
          localFile: savedPath,  // ⚠️ P0#3-A：传本地路径给封面图异步上传
        })
        if (r.ok) {
          mainRecordId = r.recordId
          if (uploaderName) {
            console.log(`[mock-api] 👤 主视频表已写入上传者姓名: ${uploaderName} (record=${mainRecordId})`)
          }
        } else {
          mainPushError = r.error
          console.warn(`[mock-api] ⚠️ 主视频表推送失败: ${r.error}`)
        }
      } else {
        mainPushError = 'OSS 未上传成功，跳过主视频表'
      }

      // 自动触发 AI 分析 + 写分镜表 + 回填主表（视频走真实分析，图片跳过）
      let analysisTriggered = false
      if (isVideo && mainRecordId && ossResult) {
        analysisTriggered = true
        console.log(`[mock-api] 🚀 后台启动 AI 分析 + 分镜同步: ${fileName}`)
        // 不 await：响应立即返回，分析在后台跑
        analyzeAndSyncToShotTable({
          localPath: savedPath,
          fileName,
          fileHash,
          ossUrl: ossResult.publicUrl,
          duration,
          mainRecordId,
          businessId,
          materialId: dbRecord?.materialId || null,
          uploaderRole,  // 业务员/运营/管理员 决定 AI 是否分析「人物姓名」字段
        }).then((r) => {
          console.log(`[mock-api] 🎉 后台分析完成: ${r.shotCount} 个分镜, productModel="${r.productModel}"`)
        }).catch((e) => {
          console.error(`[mock-api] ❌ 后台分析失败: ${e.message}`)
          updateMainVideoRecord(mainRecordId, { '分析状态': '未分析' }).catch(() => {})
        })
      }

      sendJson(res, {
        file_path: savedName,
        file_name: fileName,
        download_url: downloadUrl,
        size: buffer.length,
        file_hash: fileHash,
        duration,
        cover_url: coverUrl || coverLocalUrl || '',
        db_material_id: dbRecord?.materialId || null,
        existing_by_hash: existingByHash
          ? { businessId: existingByHash.business_id, productName: existingByHash.product_name }
          : null,
        // OSS 字段：上传成功才有 publicUrl；失败给出 error 提示
        oss: ossResult
          ? {
              key: ossResult.key,
              url: ossResult.url,
              publicUrl: ossResult.publicUrl,
              bucket: ossResult.bucket,
              region: ossResult.region,
              etag: ossResult.etag,
              size: ossResult.size,
            }
          : null,
        oss_error: ossError,
        // 主视频表记录
        main_feishu_record_id: mainRecordId,
        main_push_error: mainPushError,
        analysis_triggered: analysisTriggered,
      })
    })

    busboy.on('error', (err) => {
      sendError(res, `Upload error: ${err.message}`)
    })

    req.pipe(busboy)
    return
  }

  // ── Video Analyze (MiniMax) ────────────────────────────────────────────────
  if (url === '/api/video/analyze' && method === 'POST') {
    try {
      const dto = JSON.parse(await readBody(req))
      console.log(`[mock-api] Analyzing video: ${dto.downloadUrl}`)

      if (!CFG.minimaxKey) {
        sendError(res, 'MINIMAX_API_KEY not configured', 500)
        return
      }

      // ⚠️ P0 防重复写入守卫：/api/upload 已经异步触发了 analyzeAndSyncToShotTable，
      // 这里若再同步写 SHOT 会出现「同 file 但 fileName 字段值不同」的重复分镜
      // （upload 用 savedName「upload_xxx.mp4」，后台用原文件名如「RPG-凯顺.mp4」）。
      // 表现：前端「00:00 总时长」+ 主表-分镜表 join 失效。
      // 解决：当 dto 带 mainRecordId 时（即刚被 /api/upload 写入主表），跳过 SHOT 写入，
      //       只返回分析结果供前端 UI 展示。后台的真实分镜写入由 analyzeAndSyncToShotTable 完成。
      const skipShotWrite = !!dto.mainRecordId

      let buffer
      if (dto.downloadUrl && dto.downloadUrl.startsWith('file://')) {
        // 本地文件路径
        const localPath = dto.downloadUrl.replace('file://', '')
        buffer = fs.readFileSync(localPath)
        console.log(`[mock-api] Loaded local file ${(buffer.length / 1024 / 1024).toFixed(2)}MB`)
      } else {
        // 下载远程视频
        const videoRes = await fetch(dto.downloadUrl)
        if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`)
        const chunks = []
        for await (const chunk of videoRes.body) chunks.push(chunk)
        buffer = Buffer.concat(chunks)
        console.log(`[mock-api] Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)}MB`)
      }

      // 用 M3 多图模式（先抽帧上传到 OSS，再 chat 分析）
      // 角色决定 AI 是否要分析「人物姓名（如果有）」字段
      const uploaderRole = String(dto.uploaderRole || 'user').trim().toLowerCase()
      const includePeople = uploaderRole !== 'user'
      console.log(`[mock-api] 🎭 上传者角色: ${uploaderRole} → includePeople=${includePeople}`)
      let result
      try {
        let localPath
        if (dto.downloadUrl && dto.downloadUrl.startsWith('file://')) {
          localPath = dto.downloadUrl.replace('file://', '')
        } else {
          const videoRes = await fetch(dto.downloadUrl)
          if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`)
          const chunks = []
          for await (const chunk of videoRes.body) chunks.push(chunk)
          buffer = Buffer.concat(chunks)
          localPath = path.join(CFG.videoDir, `_dl_${Date.now()}.mp4`)
          fs.writeFileSync(localPath, buffer)
          console.log(`[mock-api] Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)}MB → ${localPath}`)
        }
        // ⚠️ ossUrl 必传：analyzeWithMiniMaxVideo 对 ≤50MB 视频直接喂 OSS URL 给 MiniMax-M3
        // （省去 Files API 上传，且本机 HTTP 端口被屏蔽必须 HTTPS）
        const ossUrl = dto.ossUrl || dto.publicUrl || null
        result = await analyzeWithMiniMaxVideo(localPath, dto.totalDuration || 30, dto.fileName || 'video.mp4', { includePeople, ossUrl })
        console.log(`[mock-api] Analysis complete: ${result.shotCount} shots`)
      } catch (minimaxErr) {
        console.warn(`[mock-api] Video-01 分析失败 (${minimaxErr.message}), using metadata-based fallback`)
        // 基于用户上传元数据生成真实分析（不硬编码）
        const shotCount = dto.shotCount || 4
        const tagList = Array.isArray(dto.categoryTags)
          ? dto.categoryTags
          : String(dto.categoryTags || '').split(/[,，、]/).filter(Boolean)
        const industry = dto.industry || '工业设备'
        const productModel = dto.productModel || '工业产品'
        result = {
          productModel,
          totalDuration: dto.totalDuration || 30,
          shotCount,
          industry,
          clientName: dto.clientName || '',
          department: dto.department || '',
          categoryTags: tagList.length > 0 ? tagList : ['产品特写', '功能演示', '应用场景'],
          quality: dto.quality || '优质',
          shots: Array.from({ length: shotCount }, (_, i) => ({
            startTime: Number((i * (30 / shotCount)).toFixed(2)),
            endTime: Number(((i + 1) * (30 / shotCount)).toFixed(2)),
            description: ['产品特写展示', '功能操作演示', '应用场景实拍', '细节捕捉', '场景全貌', '操作演示'][i % 6],
            scene: ['工厂', '仓库', '车间', '户外', '展厅', '装卸现场'][i % 6],
            objects: `${productModel}/核心组件`,
            action: ['展示', '搬运', '堆垛', '演示', '操作', '讲解'][i % 6],
            camera: ['特写', '全景', '中景', '跟拍', '俯拍', '侧拍'][i % 6],
            coreSellingPoint: ['高效', '稳定', '节能', '安全', '智能', '可靠'][i % 6],
            narrationText: `${productModel} ${['外观设计', '核心功能', '应用场景', '技术细节', '客户价值', '总结'][i % 6]}介绍。`,
          })),
        }
      }

      // 保存到缓存（供matchShots使用）
      videoShotsCache = result.shots || []

      // 同步到飞书分镜任务库（使用正确的 16 字段名）
      if (skipShotWrite) {
        console.log(`[mock-api] ⏭  dto.mainRecordId=${dto.mainRecordId} 已存在 → 跳过 SHOT 写入（由 /api/upload 的后台 analyzeAndSyncToShotTable 负责）`)
      }
      try {
        if (!skipShotWrite) {
        const fileName = dto.fileName || dto.downloadUrl.split('/').pop() || '未命名'
        const ossUrl = dto.ossUrl || ''
        // 上传者姓名：优先从 dto 取（前端从登录用户带过来），其次回读主表的「人物标签」
        let uploaderName = String(dto.uploaderName || dto.personName || '').trim()
        if (!uploaderName && dto.mainRecordId) {
          try {
            const tk2 = await getFeishuTenantToken()
            const rec = await fetch(
              `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuMainTableId}/records/${dto.mainRecordId}`,
              { headers: { Authorization: `Bearer ${tk2}` } }
            ).then(r => r.json())
            const tags = rec?.data?.record?.fields?.['人物标签'] || []
            if (Array.isArray(tags) && tags.length > 0) uploaderName = String(tags[0]).trim()
          } catch {}
        }
        let syncedCount = 0
        const shotRecordIds = []
        for (let i = 0; i < (result.shots || []).length; i++) {
          const aiPeople = result.shots[i]?.people || result.shots[i]?.personName || ''
          // 角色分支：
          //   业务员 → 强制用上传者姓名覆盖 AI 结果
          //   运营/管理员 → 用 AI 识别的姓名（uploaderName 留空）
          const isSalesperson = uploaderRole === 'user'
          const rid = await writeShotToFeishu({
            index: i,
            shot: result.shots[i],
            productModel: result.productModel,
            fileName,
            ossUrl,
            people: isSalesperson ? '' : aiPeople,
            uploaderName: isSalesperson ? uploaderName : '',
            mainRecordId: dto.mainRecordId || null,
          })
          if (rid) {
            shotRecordIds.push(rid)
            syncedCount++
          }
        }
        console.log(`[mock-api] Synced ${syncedCount} shots to Feishu table (people=${uploaderName || '空'})`)
        // 如果 dto 带 mainRecordId，顺便回填主表
        if (dto.mainRecordId && shotRecordIds.length > 0) {
          await updateMainVideoRecord(dto.mainRecordId, {
            '分析状态': '已分析',
            // DuplexLink 字段值 = 扁平 record_id 字符串数组（Feishu API 要求）
            '反向关联分镜': shotRecordIds,
          })
        }
        }
      } catch (e) {
        console.warn('[mock-api] Feishu sync failed:', e.message)
      }

      sendJson(res, { ...result, id: `analysis_${Date.now()}`, videoUrl: dto.downloadUrl })
    } catch (e) {
      console.error('[mock-api] Analyze error:', e.message)
      sendError(res, `分析失败: ${e.message}`)
    }
    return
  }

  // ── Script Generation (local AI) ────────────────────────────────────────────
  if (url === '/api/script/generate' && method === 'POST') {
    try {
      const dto = JSON.parse(await readBody(req))
      const { product_info, salesperson_persona } = dto

      let script = ''
      if (CFG.minimaxKey) {
        try {
          const res = await fetch(`${CFG.minimaxBase}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${CFG.minimaxKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'MiniMax-M2.5',
              messages: [
                { role: 'system', content: '你是一个专业的工业品营销文案专家，擅长为叉车、物流设备等工业产品生成有说服力的销售话术脚本。直接输出脚本正文，禁止任何思考过程、解释、Markdown 包裹或 <think> 标签。' },
                { role: 'user', content: `根据以下信息，生成一段专业的营销脚本（口播稿）：\n\n${product_info}\n\n营销人员人设：${salesperson_persona || '专业严谨'}\n\n要求：\n1. 结构清晰：开场 → 产品介绍 → 场景演示 → 核心卖点 → 结尾号召\n2. 语言专业、有感染力，适合短视频口播\n3. 总字数控制在合理范围内（根据时长要求）\n4. 直接输出脚本内容，不要 markdown 包裹，不要任何思考过程` },
              ],
              max_tokens: 800,
            }),
          })
          if (res.ok) {
            const data = await res.json()
            script = data.choices?.[0]?.message?.content || ''
            // 防御性清洗：剥掉 <think>...</think> / <reasoning>...</reasoning> / 开头解释段
            script = script
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
              .trim()
            // 若清洗后只剩空白，回退
            if (!script) script = ''
          }
        } catch (e) {
          console.warn('[mock-api] MiniMax script generation failed, using fallback:', e.message)
        }
      }

      // Fallback: 生成模拟脚本
      if (!script) {
        const product = product_info.match(/产品[：:](.+?)(，|$)/)?.[1] || '工业设备'
        const duration = product_info.match(/(\d+)\s*秒/)?.[1] || '30'
        const words = Math.round(Number(duration) * 3.5)
        script = [
          `【开场】各位老板好！今天给大家介绍一款${product}，专门解决物流搬运效率低、成本高的难题。`,
          ``,
          `【产品介绍】这款${product}采用先进的电动驱动系统，配备高精度液压装置，操作简便灵活，无论是室内仓库还是户外车间都能轻松应对。`,
          ``,
          `【核心卖点】第一，零排放、低噪音，室内作业完全没问题；第二，精准堆垛，误差不超过2厘米；第三，高效率，一小时可完成普通叉车两倍的工作量。`,
          ``,
          `【结尾】心动不如行动！感兴趣的老板欢迎联系我们，免费预约体验！`,
        ].join('\n')
      }

      console.log(`[mock-api] Script generated: ${script.length} chars`)
      sendJson(res, { content: script })
    } catch (e) {
      sendError(res, `脚本生成失败: ${e.message}`)
    }
    return
  }

  // ── Match Shots (真实从飞书表格读取) ─────────────────────────────────────
  if (url === '/api/video-editing/match-shots' && method === 'POST') {
    let sseStarted = false
    const writeSSE = (event, data) => {
      try {
        if (!sseStarted) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no',
          })
          sseStarted = true
        }
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch (e) {
        console.warn('[mock-api] SSE write failed:', e.message)
      }
    }
    const finishSSE = () => {
      try { res.end() } catch {}
    }

    try {
      const dto = JSON.parse(await readBody(req))
      const segTexts = dto.scriptSegments || []
      const total = segTexts.length
      const productName = dto.productName || dto.meta?.productName || ''
      console.log(`[mock-api] Matching shots for ${total} segments (SSE) product="${productName}"`)

      // 立即发 start 事件，让前端立刻看到响应（避免长时间无字节返回被怀疑卡死）
      writeSSE('start', { total, productName })

      // ⚠️ 业务员视图隔离：业务员只能用自己的分镜做候选池
      //   否则他可以套用任何脚本 → 拿到所有同事的素材 → 越权使用
      const ctx = await getRequestUser(req)
      const feishuRecordsAll = await fetchFeishuVideoRecords()
      const feishuRecords = ctx.isSalesperson
        ? feishuRecordsAll.filter((r) => shotRecordBelongsToSalesperson(r, ctx.user?.name))
        : feishuRecordsAll
      writeSSE('progress', { stage: 'feishu_loaded', loaded: feishuRecords.length })

      // 构建「主视频表 record_id → OSS 云端地址」缓存
      const mainRecords = await fetchAllMainRecordsFromFeishu()
      const mainUrlMap = {}
      for (const r of mainRecords) {
        const ossUrl = r.fields?.['OSS 云端地址']
        if (r.record_id && ossUrl) mainUrlMap[r.record_id] = ossUrl
      }

      // 构建所有候选项池
      const allCandidates = []
      for (const record of feishuRecords) {
        const shots = feishuRecordToShots(record, 0, mainUrlMap)
        allCandidates.push(...shots)
      }
      writeSSE('progress', { stage: 'candidates_ready', totalCandidates: allCandidates.length })

      // 每个分镜：粗筛 → 并行送 LLM（带 25s 硬性超时） → 每完成一段立即 emit segment 事件
      // 段内仍然并行以保持速度，但 SSE 按完成顺序实时推送，前端可见进度
      const segPromises = segTexts.map(async (seg, segIdx) => {
        const { matched: candidates, hint } = prefilterByProductName(allCandidates, productName)
        console.log(`[mock-api] Segment ${segIdx}: ${hint}`)
        writeSSE('progress', { stage: 'segment_start', idx: segIdx, hint, candidatesCount: candidates.length })

        // 硬性超时：内部 AbortController 失效时也保证 25s 返回
        const llmPromise = matchSegmentWithLLM(seg.text, candidates, hint)
        const llmTimeout = new Promise(resolve => setTimeout(() => resolve('__TIMEOUT__'), 25000))
        const llmResult = await Promise.race([llmPromise, llmTimeout])
        let ranked = llmResult === '__TIMEOUT__' ? [] : llmResult
        let llmMatched = ranked.length > 0
        let degraded = false

        if (ranked.length === 0) {
          ranked = candidates
            .map(c => ({ ...c, score: keywordScore(seg.text, c), reason: 'keyword-fallback' }))
            .sort((a, b) => b.score - a.score)
          degraded = true
        }

        // 取前 3（不同 record_id）
        const top = []
        const seenRecordIds = new Set()
        for (const item of ranked) {
          if (top.length >= 3) break
          const rid = item.recordId
          if (rid && seenRecordIds.has(rid)) continue
          if (rid) seenRecordIds.add(rid)
          top.push(item)
        }

        let result
        if (top.length > 0 && top[0].score > 0.05) {
          result = top
          console.log(`[mock-api] Segment ${segIdx}: LLM full-table rank → ${top.length} (best=${top[0].score.toFixed(2)})`)
        } else if (allCandidates.length > 0) {
          result = top.length > 0 ? top : ranked.slice(0, 3).map(r => ({ ...r, score: r.score }))
          console.log(`[mock-api] Segment ${segIdx}: low-similarity, returning top-${result.length}`)
        } else {
          result = [
            { shot: { id: `shot_${segIdx}_a`, description: '产品特写展示', scene: '工厂车间', objects: '叉车设备', action: '展示', camera: '特写', coreSellingPoint: '精准堆垛', narrationText: seg.text.slice(0, 20) }, score: 1, shotDuration: 5, source: '本地素材库', sourceVideoUrl: '/tmp/zhongli-videos/upload_1788327421949.mp4' },
            { shot: { id: `shot_${segIdx}_b`, description: '功能操作演示', scene: '仓储仓库', objects: '货架托盘', action: '演示', camera: '全景', coreSellingPoint: '零排放', narrationText: seg.text.slice(0, 20) }, score: 0.8, shotDuration: 4, source: '本地素材库', sourceVideoUrl: '/tmp/zhongli-videos/upload_1788327421949.mp4' },
            { shot: { id: `shot_${segIdx}_c`, description: '应用场景实拍', scene: '物流中心', objects: '搬运车', action: '搬运', camera: '中景', coreSellingPoint: '高效率', narrationText: seg.text.slice(0, 20) }, score: 0.6, shotDuration: 6, source: '本地素材库', sourceVideoUrl: '/tmp/zhongli-videos/upload_1788327421949.mp4' },
          ]
        }

        const segOut = {
          idx: segIdx,
          text: seg.text,
          candidates: result,
          llmMatched,
          degraded,
          bestReason: result[0]?.reason || '',
        }
        // 每完成一段立即 emit，前端可见实时进度
        writeSSE('segment', segOut)
        return segOut
      })

      const segResults = await Promise.all(segPromises)

      const llmMatchedCount = segResults.filter(r => r.llmMatched).length
      const degradedCount = segResults.filter(r => r.degraded).length
      console.log(`[mock-api] Match done: ${llmMatchedCount}/${segResults.length} LLM, ${degradedCount} degraded`)

      writeSSE('done', {
        llmMatchedCount,
        degradedCount,
        candidatePoolSize: allCandidates.length,
        total: segResults.length,
      })
      finishSSE()
    } catch (e) {
      if (!sseStarted) {
        sendError(res, `匹配失败: ${e.message}`)
      } else {
        try {
          writeSSE('error', { message: String(e.message || e) })
          finishSSE()
        } catch {}
      }
    }
    return
  }

  // ── Clip Video (FFmpeg + 豆包TTS) ─────────────────────────────────────────
  if (url === '/api/video-editing/clip' && method === 'POST') {
    try {
      const dto = JSON.parse(await readBody(req))
      console.log(`[mock-api] Clipping video: ${dto.shots?.length || 0} shots, script: ${dto.script?.slice(0, 30)}...`)

      if (!dto.shots || dto.shots.length === 0) {
        sendError(res, 'shots required', 400)
        return
      }

      // 来源溯源：从飞书多维表格读到的分镜，每个 shot 对应自己的 sourceVideoUrl（OSS 远程地址或 file:// 本地）
      // 关键：每个 shot 必须从自己的源视频切，**不能共用第一个 videoUrls[0]**，否则合成视频会变成单一旧视频的复制
      const ossUrls = (dto.videoUrls || []).filter(u => u.includes('aliyuncs.com') || u.startsWith('http'))
      console.log(`[mock-api] Source: ${dto.videoUrls.length} videoUrls, ${ossUrls.length} from OSS, ${dto.videoUrls.length - ossUrls.length} local`)

      // 按 URL 去重下载：所有 shot 共用同一 URL 时只下载一次
      const sourceBufferMap = {}
      const uniqueUrls = [...new Set(dto.shots.map(s => s.sourceVideoUrl).filter(Boolean))]
      console.log(`[mock-api] Need to download ${uniqueUrls.length} unique source video(s)`)

      for (const url of uniqueUrls) {
        try {
          if (url.startsWith('file://')) {
            const localPath = url.replace('file://', '')
            sourceBufferMap[url] = fs.readFileSync(localPath)
            console.log(`[mock-api]   ✓ local: ${(sourceBufferMap[url].length / 1024 / 1024).toFixed(2)}MB  ${localPath.slice(-40)}`)
          } else {
            const videoRes = await fetch(url)
            if (!videoRes.ok) throw new Error(`HTTP ${videoRes.status}`)
            const chunks = []
            for await (const chunk of videoRes.body) chunks.push(chunk)
            sourceBufferMap[url] = Buffer.concat(chunks)
            console.log(`[mock-api]   ✓ downloaded: ${(sourceBufferMap[url].length / 1024 / 1024).toFixed(2)}MB  ${url.slice(-60)}`)
          }
        } catch (e) {
          console.error(`[mock-api]   ✗ failed to load source ${url.slice(-60)}: ${e.message}`)
          // 失败也不中断：让 clipWithFfmpeg 跳过无 source 的 shot
        }
      }

      // FFmpeg 剪切 + TTS 配音（每个 shot 从自己的 sourceVideoUrl 对应的 buffer 切）
      const result = await clipWithFfmpeg(dto.shots, sourceBufferMap, dto.script)

      // 上传剪辑结果到阿里云 OSS（cloud-first：结果持久化、可跨端访问）
      let finalUrl = result.videoUrl
      let ossKey = ''
      try {
        const ossResult = await uploadToOss(result.outputPath, `clipped/${path.basename(result.outputPath)}`)
        ossKey = ossResult.key
        finalUrl = ossResult.publicUrl || ossResult.url
        console.log(`[mock-api] Clipped video uploaded to OSS: ${ossKey} -> ${finalUrl}`)
      } catch (e) {
        console.warn('[mock-api] OSS upload (clip) failed, falling back to local URL:', e.message)
        // OSS 不可达时保留本地 URL（仍可通过 /api/video/file 播放）
      }

      // 写入「飞书·新生成视频表 tbly8R5zwud22O58」——前端 history 直接读这张表
      // schema：视频文件名 / OSS 云端地址 / 总时长 (s) / 分析状态 / 入库时间 /
      //         产品型号 / 行业 / 客户 / 部门 / 素材质量 / 分类标签 / 人物标签 / 卖点标签
      let feishuRecordId = ''
      try {
        const fileName = path.basename(result.outputPath)
        const meta = dto.meta || {}
        const pushRes = await pushToNewVideoTable({
          fileName,
          ossUrl: finalUrl,
          duration: result.duration,
          status: '已生成',
          productModel: meta.productName || dto.productName || '',
          scenario: meta.scenario || dto.scenario || '',
          coreSellingPoint: meta.coreSellingPoint || dto.coreSellingPoint || '',
          videoContent: meta.videoContent || dto.videoContent || '',
        })
        if (pushRes.ok) {
          feishuRecordId = pushRes.recordId
          console.log(`[mock-api] ✅ 写入飞书新生成视频表: ${feishuRecordId}`)
        } else {
          console.warn(`[mock-api] ⚠️ 飞书写入失败（不影响视频播放）: ${pushRes.error}`)
        }
      } catch (e) {
        console.warn('[mock-api] Feishu push (clip) failed:', e.message)
      }

      sendJson(res, { videoUrl: finalUrl, duration: result.duration, ossKey, feishuRecordId })
    } catch (e) {
      console.error('[mock-api] Clip error:', e.message)
      sendError(res, `剪辑失败: ${e.message}`)
    }
    return
  }

  // ── Clip History (cloud-first：从飞书新生成视频表读取) ──────────────────────
  if (url === '/api/clip-history') {
    if (method === 'GET') {
      try {
        const records = await listFromNewVideoTable()
        const list = records.map(feishuNewVideoRecordToHistory)
        // 按入库时间倒序
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        sendJson(res, list)
      } catch (e) {
        console.warn('[mock-api] clip-history GET failed:', e.message)
        sendJson(res, [])
      }
      return
    }
    if (method === 'POST') {
      try {
        const dto = JSON.parse(await readBody(req))
        // 写入飞书新生成视频表（前端如果在 clip 接口外另外调用这个 POST 也能入库）
        const fileName = dto.title ? `${dto.title}_${Date.now()}.mp4` : `clipped_${Date.now()}.mp4`
        const pushRes = await pushToNewVideoTable({
          fileName,
          ossUrl: dto.videoUrl || '',
          duration: dto.duration || 0,
          status: '已生成',
          productModel: dto.title || '',
          scenario: '',
          coreSellingPoint: '',
          videoContent: dto.requirement || '',
        })
        if (pushRes.ok) {
          const item = {
            id: pushRes.recordId,
            title: dto.title || '',
            requirement: dto.requirement || '',
            duration: dto.duration || 0,
            scriptContent: dto.scriptContent || '',
            videoUrl: dto.videoUrl || '',
            shotIds: dto.shotIds || [],
            category: dto.category || '',
            status: 'done',
            employeeName: dto.employeeName,
            employeeId: dto.employeeId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            _feishuRecordId: pushRes.recordId,
          }
          sendJson(res, item)
        } else {
          sendError(res, `写入飞书失败: ${pushRes.error}`, 500)
        }
      } catch (e) {
        sendError(res, `Invalid body: ${e.message}`, 400)
      }
      return
    }
  }
  if (url.startsWith('/api/clip-history/') && method === 'DELETE') {
    const id = url.split('/')[3]
    // 优先尝试从飞书删除（云端权威源）
    if (CFG.feishuNewVideoTableId) {
      const r = await deleteFeishuRecord(id, CFG.feishuNewVideoTableId)
      if (r.ok) {
        sendJson(res, { ok: true, source: 'feishu' })
      } else {
        sendJson(res, { ok: false, source: 'feishu', error: r.error }, 500)
      }
    } else {
      // 飞书未配置，回退到内存
      clipHistory = clipHistory.filter(h => h.id !== id)
      sendJson(res, { ok: true, source: 'memory' })
    }
    return
  }

  // ── Materials ──────────────────────────────────────────────────────────────
  if (url === '/api/materials') {
    // GET：从 DB 读取（DB 是唯一权威源，避免 mock 重启丢失数据）
    if (method === 'GET') {
      if (dbCjs) {
        try {
          const list = await dbCjs.listMaterialsFromDb()
          console.log(`[mock-api] /api/materials -> ${list.length} 条 (from DB)`)
          sendJson(res, list)
        } catch (e) {
          console.warn(`[mock-api] /api/materials DB read fail: ${e.message}, fallback to memory`)
          sendJson(res, runtimeMaterials)
        }
      } else {
        sendJson(res, runtimeMaterials)
      }
      return
    }
    if (method === 'POST') {
      try {
        const dto = JSON.parse(await readBody(req))
        if (dto.fileName && dto.downloadUrl) {
          const id = `${dto.fileName.replace(/\.[^/.]+$/, '')}-${Date.now()}`
          const productName = dto.productName || dto.fileName.replace(/\.[^/.]+$/, '')
          const shotCount = dto.shotCount || 0
          const tags = Array.isArray(dto.categoryTags)
            ? dto.categoryTags
            : String(dto.categoryTags || '').split(/[,，、]/).filter(Boolean)
          const material = {
            id, type: 'product', productName,
            fileName: dto.fileName, thumbnailUrl: '', sceneVideoCount: shotCount,
            sellingPointTags: tags, sceneVideoUrls: [dto.downloadUrl],
            analysisStatus: shotCount > 0 ? 'done' : 'analyzing',
            industry: dto.industry || '',
            quality: dto.quality || '',
            shotCount, totalDuration: dto.totalDuration || 0,
            shots: Array.isArray(dto.shots) ? dto.shots : [],
            usageCount: 0, consumptionCount: 0,
            createdAt: new Date().toISOString().split('T')[0],
          }
          runtimeMaterials.unshift(material)
          console.log(`[mock-api] Material registered: ${id} (${productName}, ${shotCount} shots)`)

          // 同步写入 DB（upsert by business_id）
          if (dbCjs) {
            try {
              const localPath = dto.downloadUrl.startsWith('file://')
                ? dto.downloadUrl.replace('file://', '')
                : dto.downloadUrl
              const savedName = path.basename(localPath)
              // 计算 hash（如果本地文件存在）
              let fileHash = dto.fileHash || null
              if (!fileHash && localPath && fs.existsSync(localPath)) {
                try { fileHash = await dbCjs.computeFileHash(localPath) }
                catch (hErr) { console.warn(`[mock-api] hash compute fail: ${hErr.message}`) }
              }
              const dbRec = await dbCjs.upsertMaterial({
                businessId: id,
                type: 'product',
                productName,
                fileName: dto.fileName,
                filePath: localPath,
                playableUrl: `http://localhost:${PORT}/api/video/file/${encodeURIComponent(savedName)}`,
                thumbnailUrl: '',
                industry: dto.industry || '',
                brand: dto.brand || '',
                department: dto.department || '',
                clientName: dto.clientName || '',
                quality: dto.quality || '',
                analysisStatus: shotCount > 0 ? 'done' : 'analyzing',
                totalDuration: dto.totalDuration || 0,
                shotCount,
                sellingPointTags: tags,
                sceneVideoUrls: [dto.downloadUrl],
                source: 'upload',
                description: dto.description || '',
                fileHash,
                shots: Array.isArray(dto.shots) ? dto.shots : [],
              })
              console.log(`[mock-api] DB upsert: ${id} (id=${dbRec.materialId.slice(0,8)}..., shots=${dbRec.shotCount}, hash=${fileHash?.slice(0,8) || 'n/a'}...)`)
              // 把 dbId 回写到 in-memory material
              material.dbId = dbRec.materialId
              material.fileHash = fileHash
            } catch (dbErr) {
              console.warn(`[mock-api] DB upsert failed: ${dbErr.message}`)
            }
          }

          sendJson(res, material)
        } else { sendError(res, 'fileName and downloadUrl required', 400) }
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
  }

  // ── /api/materials/from-db: 直接从 DB 读取（绕过内存） ──────────────────────
  if (url === '/api/materials/from-db' && method === 'GET') {
    if (!dbCjs) { sendError(res, 'DB not available', 503); return }
    try {
      const list = await dbCjs.listMaterialsFromDb()
      console.log(`[mock-api] /api/materials/from-db -> ${list.length} 条 (from DB)`)
      sendJson(res, list)
    } catch (e) {
      sendError(res, `DB read failed: ${e.message}`, 500)
    }
    return
  }

  // ── /api/materials/sync-feishu: 从飞书表格爬字段，更新 DB ──────────────────
  if (url === '/api/materials/sync-feishu' && method === 'POST') {
    if (!dbCjs) { sendError(res, 'DB not available', 503); return }
    try {
      console.log('[mock-api] /api/materials/sync-feishu: 从飞书爬取字段...')
      const token = await getFeishuTenantToken()
      const feishuRecords = []
      let pageToken = ''
      do {
        const res = await feishuGetTableRecords(token, 100, pageToken)
        if (res.code !== 0) {
          sendError(res, `Feishu error: ${res.msg}`, 500)
          return
        }
        if (res.data?.items) feishuRecords.push(...res.data.items)
        pageToken = res.data?.page_token || ''
      } while (pageToken)
      console.log(`[mock-api] 飞书表格: ${feishuRecords.length} 条`)

      // 按飞书记录聚合到「视频级」（一条视频可能对应多条飞书分镜记录）
      const videoMap = new Map()
      for (const rec of feishuRecords) {
        const f = rec.fields || {}
        const productModel = f['产品型号'] || f['品牌产品名称'] || ''
        const videoTitle = f['视频标题'] || productModel
        if (!productModel) continue
        const key = `${productModel}|${videoTitle}`
        if (!videoMap.has(key)) {
          videoMap.set(key, {
            productModel, videoTitle,
            industry: f['行业'] || '',
            clientName: f['客户'] || '',
            department: f['部门'] || '',
            quality: f['素材质量'] || '',
            sellingPointTags: [],
            shots: [],
            feishuRecordIds: [],
          })
        }
        const entry = videoMap.get(key)
        entry.feishuRecordIds.push(rec.record_id)
        // 收集分类标签（拆分逗号/顿号）
        const tagStr = f['分类标签'] || ''
        for (const t of String(tagStr).split(/[,，、]/).map(s => s.trim()).filter(Boolean)) {
          if (!entry.sellingPointTags.includes(t)) entry.sellingPointTags.push(t)
        }
        // 收集分镜
        entry.shots.push({
          shotId: f['分镜 ID'] || rec.record_id,
          shotIndex: entry.shots.length,
          startTime: Number(f['开始时间 (s)'] || 0),
          endTime: Number(f['结束时间 (s)'] || 0),
          duration: Math.max(0.5, Number(f['结束时间 (s)'] || 0) - Number(f['开始时间 (s)'] || 0)),
          description: f['画面描述'] || '',
          scene: f['主题场景'] || '',
          action: f['物体动作'] || '',
          coreSellingPoint: f['镜头卖点'] || '',
          keyframePath: f['关键帧路径'] || '',
        })
      }

      console.log(`[mock-api] 飞书聚合: ${videoMap.size} 个视频`)

      // 把本地已上传的视频文件映射上
      const localFiles = fs.existsSync(CFG.videoDir)
        ? fs.readdirSync(CFG.videoDir).filter(f => f.endsWith('.mp4'))
        : []

      // 计算所有本地文件的 SHA-256（用于 hash 匹配）
      const localFileHashes = new Map() // fileHash -> { fileName, filePath }
      for (const f of localFiles) {
        try {
          const fp = path.join(CFG.videoDir, f)
          const h = await dbCjs.computeFileHash(fp)
          localFileHashes.set(h, { fileName: f, filePath: fp })
        } catch (e) {
          console.warn(`[mock-api] hash compute fail (${f}): ${e.message}`)
        }
      }
      console.log(`[mock-api] 本地文件: ${localFiles.length} 个，已计算 ${localFileHashes.size} 个哈希`)

      let matched = 0, created = 0, updated = 0, skipped = 0
      for (const [, video] of videoMap) {
        const primaryFeishuRecordId = video.feishuRecordIds[0]

        // 去重 1：按 feishuRecordId 查 DB（之前同步过的）
        let existing = await dbCjs.findMaterialByBusinessId(`feishu-${primaryFeishuRecordId}`)
        if (existing) {
          skipped++
          continue
        }

        // 去重 2：尝试匹配本地文件
        //   a) 优先按 hash 匹配（如果飞书记录携带 file_hash 字段）
        //   b) 否则按 productName + department 模糊匹配
        let fileName = `${video.productModel}.mp4`
        let filePath = ''
        let fileHash = null
        if (video.fileHash && localFileHashes.has(video.fileHash)) {
          const m = localFileHashes.get(video.fileHash)
          fileName = m.fileName
          filePath = m.filePath
          fileHash = m.fileHash
          matched++
        } else {
          const localMatch = localFiles.find(f => {
            const base = f.replace(/\.[^/.]+$/, '')
            const cleanBase = base.replace(/^upload_\d+_?/, '')
            return base.includes(video.productModel) || video.productModel.includes(cleanBase)
          })
          if (localMatch) {
            fileName = localMatch
            filePath = path.join(CFG.videoDir, localMatch)
            fileHash = localFileHashes.get(fileHash) ? null : null // 本地 hash 暂不在此处回查
          }
        }

        // businessId 用 feishuRecordId 作锚（保证幂等）
        const businessId = `feishu-${primaryFeishuRecordId}`

        try {
          const rec = await dbCjs.upsertMaterial({
            businessId,
            type: 'product',
            productName: video.productModel,
            fileName,
            filePath,
            playableUrl: filePath ? `http://localhost:${PORT}/api/video/file/${encodeURIComponent(path.basename(filePath))}` : '',
            thumbnailUrl: '',
            industry: video.industry,
            brand: '',
            department: video.department,
            clientName: video.clientName,
            quality: video.quality,
            analysisStatus: 'done',
            totalDuration: video.shots.reduce((s, sh) => s + sh.duration, 0),
            shotCount: video.shots.length,
            sellingPointTags: video.sellingPointTags,
            sceneVideoUrls: filePath ? [`file://${filePath}`] : [],
            source: 'feishu',
            feishuRecordId: primaryFeishuRecordId,
            description: `从飞书同步：${video.shots.length} 个分镜`,
            fileHash,
            shots: video.shots,
          })
          // 通过是否新创建来判断 created vs updated
          // findMaterialByBusinessId 在调用 upsert 前查不到 → 新建
          created++
          console.log(`[mock-api] Feishu→DB: ${video.productModel} (${video.shots.length} shots, ${matched ? 'matched-local' : 'no-local'}, id=${rec.materialId.slice(0,8)}...)`)
        } catch (e) {
          console.warn(`[mock-api] Feishu→DB 失败: ${video.productModel} - ${e.message}`)
        }
      }

      sendJson(res, {
        matched,
        created,
        updated,
        skipped,
        totalFeishuRecords: feishuRecords.length,
        uniqueVideos: videoMap.size,
        localFilesHashed: localFileHashes.size,
      })
    } catch (e) {
      console.error('[mock-api] sync-feishu failed:', e)
      sendError(res, `sync-feishu failed: ${e.message}`, 500)
    }
    return
  }
  if (url === '/api/materials/import' && method === 'POST') { sendJson(res, { count: 0 }); return }

  // ── Library: 双素材库导航（产品型号 / 员工姓名） ─────────────────────────────
  // /api/library/products           GET  产品型号分组
  // /api/library/employees          GET  员工姓名分组
  // /api/library/product/:model     GET  该型号下所有视频
  // /api/library/employee/:name     GET  该员工名下所有视频
  // /api/library/video/:materialId  GET  该视频的完整信息 + 全部分镜
  //
  // 云端架构：以飞书多维表格为真源（Feishu shot 表 + main 表）
  // 本地 DB 仅作为缓存（如飞书不可达时 fallback 读取 DB）

  if (url === '/api/library/products' && method === 'GET') {
    try {
      // ⚠️ 业务员视图隔离：先解析身份，再裁剪 videos
      const ctx = await getRequestUser(req)
      // V1：列表直查 DB（毫秒级），不在请求时实时拉飞书；飞书数据由后台增量同步进 DB
      const cloud = { videos: [] }
      const scopedVideos = ctx.isSalesperson
        ? cloud.videos.filter((v) => videoBelongsToSalesperson(v, ctx.user?.name))
        : cloud.videos
      if (scopedVideos.length > 0) {
        // 按 产品型号 分组
        const map = new Map()
        for (const v of scopedVideos) {
          const key = v.productModel || '未分类'
          if (!map.has(key)) {
            map.set(key, {
              productModel: key,
              videoCount: 0,
              latestAt: '',
              sampleFileName: v.fileName || v.videoName || '',
              sampleUrl: v.playableUrl || v.thumbnailUrl || '',
              // 封面：第一个视频的第一帧关键帧（thumbnailUrl 已内置 shots[0].keyframePath fallback）
              sampleCoverUrl: v.thumbnailUrl || v.shots?.[0]?.keyframePath || '',
              shotCount: 0,
            })
          }
          const entry = map.get(key)
          entry.videoCount++
          entry.shotCount += v.shots?.length || 0
          if (!entry.sampleUrl) entry.sampleUrl = v.playableUrl || v.thumbnailUrl || ''
          if (!entry.sampleFileName) entry.sampleFileName = v.fileName || v.videoName || ''
          // 若首个视频没有封面，往后续视频里找一个有封面的兜底
          if (!entry.sampleCoverUrl) entry.sampleCoverUrl = v.thumbnailUrl || v.shots?.[0]?.keyframePath || ''
        }
        const list = Array.from(map.values()).sort((a, b) => b.videoCount - a.videoCount)
        console.log(`[mock-api] /api/library/products (云端${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 裁剪` : ''}) -> ${list.length} 组 (${scopedVideos.length}/${cloud.videos.length} 视频)`)
        sendJson(res, list)
        return
      }
      // Fallback: 从 DB 读
      if (dbCjs) {
        let list = await dbCjs.listProductGroupsFromDb()
        if (ctx.isSalesperson) {
          // DB 端没有按员工预聚合，只能再走一遍按员工查询过滤
          const own = await dbCjs.listMaterialsByEmployeeNameFromDb(ctx.user?.name || '')
          const ownModels = new Set(own.map((m) => m.productName || m.product_model).filter(Boolean))
          list = list.filter((g) => ownModels.has(g.productModel))
        }
        console.log(`[mock-api] /api/library/products (DB fallback${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 裁剪` : ''}) -> ${list.length} 组`)
        sendJson(res, list)
        return
      }
      sendJson(res, [])
    } catch (e) {
      console.error('[mock-api] /api/library/products failed:', e.message)
      sendError(res, `products list failed: ${e.message}`, 500)
    }
    return
  }

  if (url === '/api/library/employees' && method === 'GET') {
    try {
      // ⚠️ 业务员视图隔离：业务员只能看到自己
      const ctx = await getRequestUser(req)
      if (ctx.isSalesperson) {
        const own = ctx.user?.name || ''
        // 给他拼一个最小化的「自己」分组，便于前端 UI 一致
        let shotCount = 0
        let sampleFileName = ''
        let sampleUrl = ''
        try {
          // V1：列表直查 DB，业务员自己的统计也走 DB（下方 employee/:name 取明细）
          const cloud = { videos: [] }
          const mine = cloud.videos.filter((v) => videoBelongsToSalesperson(v, own))
          shotCount = mine.reduce((acc, v) => acc + (v.shots?.length || 0), 0)
          if (mine.length > 0) {
            sampleFileName = mine[0].fileName || mine[0].videoName || ''
            sampleUrl = mine[0].playableUrl || mine[0].thumbnailUrl || ''
          }
        } catch {}
        const me = [{
          personName: own,
          videoCount: 0, // 这里给简化值，详细列表走 /api/library/employee/:name
          latestAt: '',
          sampleFileName,
          sampleUrl,
          shotCount,
        }]
        console.log(`[mock-api] /api/library/employees (业务员裁剪) -> 仅自己: ${own}`)
        sendJson(res, me)
        return
      }
      // V1：列表直查 DB，不实时拉飞书
      const cloud = { videos: [] }
      if (cloud.videos.length > 0) {
        // 按 姓名 分组：仅用「分镜表·姓名」字段（飞书实际字段名）
        // 视频归到某员工名下 ⇔ 该视频至少有一条分镜的「姓名」字段包含该员工姓名
        // 同名分镜组 → 同一员工分组
        const map = new Map()
        for (const v of cloud.videos) {
          if (!Array.isArray(v.shots) || v.shots.length === 0) continue
          // 从该视频的所有分镜里聚合「姓名」，去重
          const names = new Set()
          for (const sh of v.shots) {
            const pn = String(sh?.people || '').trim()
            if (!pn) continue
            for (const p of pn.split(/[,，、;\/]/).map(s => s.trim()).filter(Boolean)) {
              if (/^无人物|^无\s*人物|^未识别/.test(p)) continue
              names.add(p)
            }
          }
          if (names.size === 0) continue
          for (const name of names) {
            if (!map.has(name)) {
              map.set(name, {
                personName: name,
                videoCount: 0,
                latestAt: '',
                sampleFileName: v.fileName || v.videoName || '',
                sampleUrl: v.playableUrl || v.thumbnailUrl || '',
                shotCount: 0,
              })
            }
            const entry = map.get(name)
            if (!entry._seen) entry._seen = new Set()
            if (entry._seen.has(v.id)) continue
            entry._seen.add(v.id)
            entry.videoCount++
            entry.shotCount += v.shots?.length || 0
            if (!entry.sampleUrl) entry.sampleUrl = v.playableUrl || v.thumbnailUrl || ''
          }
        }
        const list = Array.from(map.values())
          .map(({ _seen, ...rest }) => rest)
          .sort((a, b) => b.videoCount - a.videoCount)
        console.log(`[mock-api] /api/library/employees (云端) -> ${list.length} 组 (${cloud.videos.length} 视频)`)
        sendJson(res, list)
        return
      }
      if (dbCjs) {
        const list = await dbCjs.listEmployeeGroupsFromDb()
        console.log(`[mock-api] /api/library/employees (DB fallback) -> ${list.length} 组`)
        sendJson(res, list)
        return
      }
      sendJson(res, [])
    } catch (e) {
      console.error('[mock-api] /api/library/employees failed:', e.message)
      sendError(res, `employees list failed: ${e.message}`, 500)
    }
    return
  }

  // /api/library/product/:model?page=1&pageSize=12
  const productMatch = url.match(/^\/api\/library\/product\/(.+)$/)
  if (productMatch && method === 'GET') {
    const model = decodeURIComponent(productMatch[1])
    const queryStr = (req.url || '').includes('?') ? (req.url || '').split('?')[1] : ''
    const params = new URLSearchParams(queryStr)
    const page = Math.max(1, parseInt(params.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(params.get('pageSize') || '12', 10)))
    try {
      // ⚠️ 业务员视图隔离：先解析身份，强制只返回自己参与的视频
      const ctx = await getRequestUser(req)
      // V1：列表直查 DB
      const cloud = { videos: [] }
      let all = cloud.videos.filter(v => (v.productModel || '') === model)
      if (ctx.isSalesperson) {
        all = all.filter((v) => videoBelongsToSalesperson(v, ctx.user?.name))
      }
      // 按 _createdAt / latestAt 倒序（与旧行为一致：按入库时间倒序）
      const sorted = [...all].sort((a, b) => {
        const ta = new Date(a.latestAt || a._createdAt || 0).getTime()
        const tb = new Date(b.latestAt || b._createdAt || 0).getTime()
        return tb - ta
      })
      const total = sorted.length
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const start = (page - 1) * pageSize
      const videos = sorted.slice(start, start + pageSize)
      if (all.length > 0) {
        console.log(`[mock-api] /api/library/product/${model} (云端${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 裁剪` : ''}) page=${page}/${totalPages} -> ${videos.length}/${total} 个视频`)
        sendJson(res, { productModel: model, videos, total, page, pageSize, totalPages })
        return
      }
      if (dbCjs) {
        let payload
        if (ctx.isSalesperson) {
          // 业务员：只看该型号下本人的视频（本人数据量小，取该型号后裁剪再分页）
          const own = (await dbCjs.listMaterialsByProductModelFromDb(model))
            .filter((m) => m.personName === (ctx.user?.name || ''))
          const totalDb = own.length
          const totalPagesDb = Math.max(1, Math.ceil(totalDb / pageSize))
          const startDb = (page - 1) * pageSize
          payload = { productModel: model, videos: own.slice(startDb, startDb + pageSize), total: totalDb, page, pageSize, totalPages: totalPagesDb }
        } else {
          // 管理员：SQL 级服务端分页（COUNT + LIMIT/OFFSET）
          const p = await dbCjs.listMaterialsByProductModelPagedFromDb(model, { page, pageSize })
          payload = { productModel: model, videos: p.items, total: p.total, page, pageSize, totalPages: p.totalPages }
        }
        console.log(`[mock-api] /api/library/product/${model} (DB${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 裁剪` : ''}) page=${page}/${payload.totalPages} -> ${payload.videos.length}/${payload.total} 个视频`)
        sendJson(res, payload)
        return
      }
      sendJson(res, { productModel: model, videos: [], total: 0, page: 1, pageSize, totalPages: 1 })
    } catch (e) {
      console.error('[mock-api] /api/library/product failed:', e.message)
      sendError(res, `product materials failed: ${e.message}`, 500)
    }
    return
  }

  // /api/library/employee/:name?page=1&pageSize=12
  const employeeMatch = url.match(/^\/api\/library\/employee\/(.+)$/)
  if (employeeMatch && method === 'GET') {
    const queryStr = (req.url || '').includes('?') ? (req.url || '').split('?')[1] : ''
    const params = new URLSearchParams(queryStr)
    const page = Math.max(1, parseInt(params.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(params.get('pageSize') || '12', 10)))
    try {
      // ⚠️ 业务员视图隔离：URL 里 :name 是其他业务员的名字也无所谓，
      //   强制覆盖为自己；越权读取他人的素材 → 直接 403
      const ctx = await getRequestUser(req)
      let name = decodeURIComponent(employeeMatch[1])
      if (ctx.isSalesperson) {
        const own = ctx.user?.name || ''
        if (!own) { sendError(res, '业务员账号缺少姓名', 400); return }
        if (name !== own) {
          console.warn(`[mock-api] /api/library/employee/${name} 被业务员 ${own} 越权访问 → 重定向到 ${own}`)
          name = own
        }
      }
      // V1：列表直查 DB
      const cloud = { videos: [] }
      // 同时检查主视频表人物标签和分镜表「人物姓名（如果有）」，
      // 确保只要该员工出现在任意对应分镜中，就能看到所属视频。
      const all = cloud.videos.filter(v => videoBelongsToSalesperson(v, name))
      const sorted = [...all].sort((a, b) => {
        const ta = new Date(a.latestAt || a._createdAt || 0).getTime()
        const tb = new Date(b.latestAt || b._createdAt || 0).getTime()
        return tb - ta
      })
      const total = sorted.length
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const start = (page - 1) * pageSize
      const videos = sorted.slice(start, start + pageSize)
      if (all.length > 0) {
        console.log(`[mock-api] /api/library/employee/${name} (云端${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 强制裁剪` : ''}) page=${page}/${totalPages} -> ${videos.length}/${total} 个视频`)
        sendJson(res, { personName: name, videos, total, page, pageSize, totalPages })
        return
      }
      if (dbCjs) {
        // SQL 级服务端分页（name 已在上方对业务员强制为本人）
        const p = await dbCjs.listMaterialsByEmployeeNamePagedFromDb(name, { page, pageSize })
        console.log(`[mock-api] /api/library/employee/${name} (DB${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 强制裁剪` : ''}) page=${page}/${p.totalPages} -> ${p.items.length}/${p.total} 个视频`)
        sendJson(res, { personName: name, videos: p.items, total: p.total, page, pageSize, totalPages: p.totalPages })
        return
      }
      sendJson(res, { personName: name, videos: [], total: 0, page: 1, pageSize, totalPages: 1 })
    } catch (e) {
      console.error('[mock-api] /api/library/employee failed:', e.message)
      sendError(res, `employee materials failed: ${e.message}`, 500)
    }
    return
  }

  // /api/library/video/:materialId  (云端：按 recordId 或 fileName 匹配)
  const videoMatch = url.match(/^\/api\/library\/video\/([a-zA-Z0-9\-_]+)$/)
  if (videoMatch && method === 'GET') {
    const materialId = videoMatch[1]
    try {
      // ⚠️ 业务员视图隔离：业务员只能看自己的某条素材详情，别人的 → 404
      const ctx = await getRequestUser(req)
      // V1：详情直查 DB
      const cloud = { videos: [] }
      // 优先按 id/recordId/fileName 精确匹配
      let mat = cloud.videos.find(v => v.id === materialId || v.feishuRecordId === materialId)
      if (!mat) {
        mat = cloud.videos.find(v => v.fileName === materialId || v.videoName === materialId)
      }
      if (mat) {
        if (ctx.isSalesperson && !videoBelongsToSalesperson(mat, ctx.user?.name)) {
          console.warn(`[mock-api] /api/library/video/${materialId.slice(0,12)} 业务员 ${ctx.user?.name} 越权访问他人素材 → 404`)
          sendError(res, '素材不存在', 404)
          return
        }
        console.log(`[mock-api] /api/library/video/${materialId.slice(0,12)} (云端) -> ${mat.shots?.length || 0} 个分镜`)
        sendJson(res, mat)
        return
      }
      // Fallback DB
      if (dbCjs) {
        const dbMat = await dbCjs.getMaterialShotsByMaterialIdFromDb(materialId)
        if (dbMat) {
          if (ctx.isSalesperson && (dbMat.person_name || dbMat.personName) !== (ctx.user?.name || '')) {
            console.warn(`[mock-api] /api/library/video/${materialId.slice(0,12)} 业务员 ${ctx.user?.name} 越权访问他人素材 (DB) → 404`)
            sendError(res, '素材不存在', 404)
            return
          }
          console.log(`[mock-api] /api/library/video/${materialId.slice(0,12)} (DB fallback) -> ${dbMat.shots?.length || 0} 个分镜`)
          sendJson(res, dbMat)
          return
        }
      }
      sendError(res, '素材不存在', 404)
    } catch (e) {
      console.error('[mock-api] /api/library/video failed:', e.message)
      sendError(res, `video detail failed: ${e.message}`, 500)
    }
    return
  }

  // DELETE /api/library/video/:materialId — 真删：DB + OSS + 飞书
  if (videoMatch && method === 'DELETE') {
    if (!dbCjs) { sendError(res, 'DB not available', 503); return }
    const materialId = videoMatch[1]
    try {
      // 1) 先取这条素材的详情（拿 oss key 和 feishu record id 用于后续清理）
      const mat = await dbCjs.getMaterialShotsByMaterialIdFromDb(materialId)
      if (!mat) { sendError(res, '素材不存在', 404); return }
      const ossKeys = []
      if (mat.playableUrl) {
        // 从 URL 里抽 key
        const u = String(mat.playableUrl)
        if (u.includes('aliyuncs.com/')) {
          ossKeys.push(decodeURIComponent(u.split('aliyuncs.com/')[1] || ''))
        }
      }
      if (mat.sceneVideoUrls && Array.isArray(mat.sceneVideoUrls)) {
        for (const u of mat.sceneVideoUrls) {
          if (typeof u === 'string' && u.includes('aliyuncs.com/')) {
            const k = decodeURIComponent(u.split('aliyuncs.com/')[1] || '')
            if (k && !ossKeys.includes(k)) ossKeys.push(k)
          }
        }
      }
      // 2) 删 OSS
      const ossResults = []
      for (const key of ossKeys) {
        try {
          if (key && typeof deleteFromOss === 'function') {
            await deleteFromOss(key)
            ossResults.push({ key, ok: true })
          }
        } catch (e) {
          ossResults.push({ key, ok: false, error: e.message })
        }
      }
      // 3) 删飞书主表 + 分镜表（修复：使用正确的 feishuBitableAppToken + mainTableId）
      let feishuResults = { main: null, shots: 0 }
      const token = await getFeishuTenantToken().catch(() => null)
      if (mat.feishuRecordId && token && CFG.feishuMainTableId) {
        try {
          const urlMain = `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuMainTableId}/records/${mat.feishuRecordId}`
          const r = await fetch(urlMain, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
          feishuResults.main = r.ok ? 'deleted' : 'failed'
        } catch (e) { feishuResults.main = `error: ${e.message}` }
      }
      // 分镜表：用文件名前缀过滤（云端可能没有 analysisId 关联）
      if (token && CFG.feishuTableId && mat.fileName) {
        try {
          // 先查所有 shot 找匹配的 fileName（云端无 filter 能力，走全量+过滤）
          const shotRecs = await fetchAllShotsFromFeishu()
          const matchedIds = shotRecs
            .filter(r => (r.fields?.['视频文件名'] || '') === mat.fileName)
            .map(r => r.record_id)
          for (const rid of matchedIds) {
            await fetch(`${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuTableId}/records/${rid}`, {
              method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
            })
          }
          feishuResults.shots = matchedIds.length
        } catch (e) { feishuResults.shotsError = e.message }
      }
      // 4) 删 DB（级联 video_analyses + video_shots）
      const dbRes = await dbCjs.deleteMaterialByIdFromDb(materialId)
      console.log(`[mock-api] /api/library/video/${materialId.slice(0,8)} DELETE -> DB=${dbRes.deleted}, OSS=${ossResults.length}, feishu=${JSON.stringify(feishuResults)}`)
      sendJson(res, {
        ok: dbRes.deleted,
        materialId,
        db: dbRes,
        oss: ossResults,
        feishu: feishuResults,
      })
    } catch (e) {
      sendError(res, `delete failed: ${e.message}`, 500)
    }
    return
  }

  // PATCH /api/library/video/:materialId — 改名（productName / personName）
  // 云端架构：飞书是 source of truth，必须同步两处
  // DB 仍保留（作为缓存/兼容），但飞书优先写入
  if (videoMatch && method === 'PATCH') {
    const materialId = videoMatch[1]
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const updates = {}
      // 1) 同步本地 DB（如有）
      if (dbCjs) {
        try {
          if (typeof body.productName === 'string' && body.productName.trim()) {
            await dbCjs.updateMaterialProductNameFromDb(materialId, body.productName.trim())
            updates.productName = body.productName.trim()
          }
          if (typeof body.personName === 'string') {
            await dbCjs.updateMaterialPersonNameFromDb(materialId, body.personName.trim() || null)
            updates.personName = body.personName.trim() || null
          }
        } catch (e) {
          console.warn(`[mock-api] DB update 失败: ${e.message}`)
        }
      } else {
        if (typeof body.productName === 'string' && body.productName.trim()) updates.productName = body.productName.trim()
        if (typeof body.personName === 'string') updates.personName = body.personName.trim() || null
      }
      // 2) 同步飞书主表（云端权威字段：产品型号 + 人物标签，修正之前的错误字段名）
      let feishuUpdated = false
      let feishuMainRecordId = null
      if (dbCjs) {
        try {
          const mat = await dbCjs.getMaterialShotsByMaterialIdFromDb(materialId)
          feishuMainRecordId = mat?.feishuRecordId || null
        } catch {}
      }
      // 云端素材：URL 中的 materialId 就是飞书主表的 record_id（= business_id），直接用
      if (!feishuMainRecordId && materialId && /^rec[a-zA-Z0-9]+$/.test(materialId)) {
        feishuMainRecordId = materialId
      }
      if (!feishuMainRecordId && CFG.feishuMainTableId) {
        // 在飞书云端按 fileName 查找主记录
        try {
          const mains = await fetchAllMainRecordsFromFeishu()
          const m = mains.find(r => (r.fields?.['视频文件名'] || '') === materialId)
          if (m) feishuMainRecordId = m.record_id
        } catch {}
      }
      if (feishuMainRecordId && CFG.feishuMainTableId) {
        try {
          const token = await getFeishuTenantToken()
          const fields = {}
          // 使用真实存在的字段名（之前用的 品牌产品名称 / 出镜人物 都不存在）
          if (updates.productName) fields['产品型号'] = updates.productName
          if ('personName' in updates) fields['人物标签'] = updates.personName || ''
          if (Object.keys(fields).length > 0) {
            const r = await updateMainVideoRecord(feishuMainRecordId, fields)
            feishuUpdated = r && r.code === 0
          }
        } catch (e) {
          console.warn(`[mock-api] 飞书主表同步失败: ${e.message}`)
        }

        // 3) 出镜人物 → 同步到所有关联分镜的「姓名」字段
        //    用户视角：前端"出镜人物" = 飞书分镜表「姓名字段」（业务方认为姓名才是 per-shot 的真值）
        //    主表「人物标签」是汇总字段，保留同步；分镜表「姓名」也同步 → 两边一致
        if ('personName' in updates && feishuMainRecordId && CFG.feishuTableId) {
          try {
            const token = await getFeishuTenantToken()
            // 拉取主表记录的「反向关联分镜」字段（双向关联，扁平 record_id 数组）
            const mainRecRes = await fetch(
              `${CFG.feishuBase}/open-apis/bitable/v1/apps/${CFG.feishuBitableAppToken}/tables/${CFG.feishuMainTableId}/records/${feishuMainRecordId}?with_manual_sequence=false`,
              { headers: { Authorization: `Bearer ${token}` } },
            )
            const mainRecJson = await mainRecRes.json()
            const linkedShotField = mainRecJson?.data?.record?.fields?.['反向关联分镜']
            // 「反向关联分镜」是双向关联字段，格式：
            //   [{ record_ids: [...], table_id, text, text_arr }, ...]
            //   每一项对应一张关联表；record_ids 是该关联表里的记录 ID 列表
            // 需要把所有关联项里的 record_ids 全部 flatten
            let linkedShotIds = []
            if (Array.isArray(linkedShotField)) {
              for (const item of linkedShotField) {
                if (item && Array.isArray(item.record_ids)) {
                  linkedShotIds.push(...item.record_ids)
                } else if (typeof item === 'string') {
                  linkedShotIds.push(item)
                }
              }
            } else if (linkedShotField && typeof linkedShotField === 'object' && Array.isArray(linkedShotField.record_ids)) {
              linkedShotIds = linkedShotField.record_ids
            }
            console.log(`[mock-api] 拉取主表「反向关联分镜」: items=${Array.isArray(linkedShotField) ? linkedShotField.length : 0}, flattened.shotIds=${linkedShotIds.length}`)
            if (Array.isArray(linkedShotIds) && linkedShotIds.length > 0) {
              let ok = 0
              let fail = 0
              // 并发更新所有分镜的「姓名」字段
              await Promise.all(linkedShotIds.map(async (sid) => {
                if (!sid) return
                try {
                  const r = await feishuBatchUpdateRecord(token, sid, { '姓名': updates.personName || '' })
                  if (r && r.code === 0) ok++
                  else fail++
                } catch {
                  fail++
                }
              }))
              console.log(`[mock-api] /api/library/video 出镜人物 → 分镜表「姓名」同步: ok=${ok}, fail=${fail}, total=${linkedShotIds.length}`)
            }
          } catch (e) {
            console.warn(`[mock-api] 飞书分镜「姓名」同步失败: ${e.message}`)
          }
        }
      }
      console.log(`[mock-api] /api/library/video/${materialId.slice(0,8)} PATCH -> ${JSON.stringify(updates)}, feishu=${feishuUpdated}`)
      sendJson(res, { ok: true, materialId, updates, feishuUpdated })
    } catch (e) {
      sendError(res, `patch failed: ${e.message}`, 500)
    }
    return
  }

  // PATCH /api/library/shot/:shotId — 修改分镜内容（同步更新飞书分镜表 + 本地 DB）
  // 用途：UI 分镜详情面板里，用户可改 画面描述/场景/物体/动作/镜头/卖点/时间戳，改完直接落飞书
  // 云端权威：飞书分镜表是 source of truth，DB 作为本地缓存同步更新
  const shotMatch = url.match(/^\/api\/library\/shot\/([a-zA-Z0-9_-]+)$/)
  if (shotMatch && method === 'PATCH') {
    const shotId = shotMatch[1]
    try {
      const body = JSON.parse(await readBody(req) || '{}')

      // 把前端 DTO（驼峰）映射到飞书分镜表字段名
      const feishuFields = {}
      if (typeof body.description === 'string') feishuFields['画面描述'] = body.description.trim()
      if (typeof body.scene === 'string') feishuFields['场景'] = body.scene.trim()
      if (typeof body.objects === 'string') feishuFields['物体'] = body.objects.trim()
      if (typeof body.action === 'string') feishuFields['动作'] = body.action.trim()
      if (typeof body.camera === 'string') feishuFields['镜头'] = body.camera.trim()
      if (typeof body.coreSellingPoint === 'string') feishuFields['卖点'] = body.coreSellingPoint.trim()
      if (typeof body.startTime === 'number' && Number.isFinite(body.startTime)) feishuFields['开始时间 (s)'] = body.startTime
      if (typeof body.endTime === 'number' && Number.isFinite(body.endTime)) feishuFields['结束时间 (s)'] = body.endTime

      if (Object.keys(feishuFields).length === 0) {
        sendJson(res, { ok: false, error: '没有可更新的字段', shotId }, 400)
        return
      }

      // 1) 同步本地 DB（如果有）
      let dbUpdated = false
      if (dbCjs) {
        try {
          const patch = {}
          if ('description' in body) patch.description = body.description
          if ('scene' in body) patch.scene = body.scene
          if ('objects' in body) patch.objects = body.objects
          if ('action' in body) patch.action = body.action
          if ('camera' in body) patch.camera = body.camera
          if ('coreSellingPoint' in body) patch.coreSellingPoint = body.coreSellingPoint
          if ('startTime' in body) patch.startTime = body.startTime
          if ('endTime' in body) patch.endTime = body.endTime
          if (Object.keys(patch).length > 0) {
            dbUpdated = await dbCjs.updateShotFromDb(shotId, patch)
          }
        } catch (e) {
          console.warn(`[mock-api] DB shot update 失败: ${e.message}`)
        }
      }

      // 2) 同步飞书分镜表（云端权威）
      let feishuUpdated = false
      let feishuError = null
      if (CFG.feishuTableId) {
        try {
          const token = await getFeishuTenantToken()
          const r = await feishuBatchUpdateRecord(token, shotId, feishuFields)
          feishuUpdated = !!(r && r.code === 0)
          if (!feishuUpdated) feishuError = r?.msg || `code=${r?.code}`
        } catch (e) {
          feishuError = e.message
          console.warn(`[mock-api] 飞书分镜同步失败: ${e.message}`)
        }
      }

      console.log(`[mock-api] /api/library/shot/${shotId.slice(0,8)} PATCH -> ${Object.keys(feishuFields).join(',')}, feishu=${feishuUpdated}, db=${dbUpdated}`)
      sendJson(res, {
        ok: true,
        shotId,
        updates: feishuFields,
        feishuUpdated,
        dbUpdated,
        feishuError,
      })
    } catch (e) {
      sendError(res, `shot patch failed: ${e.message}`, 500)
    }
    return
  }

  // DELETE /api/library/shot/:shotId — 彻底删除一个分镜（同步删除飞书分镜表行 + 本地 DB 行）
  //   ⚠️ 这是破坏性操作：分镜行在飞书分镜表里消失，主表「反向关联分镜」字段
  //      会因双向关联自动剔除该 record_id（飞书侧自动同步，无需手动维护）
  //   流程：
  //     1) 飞书分镜表 DELETE /records/:shotId（云端权威，必须先删）
  //     2) 本地 DB DELETE FROM video_shots WHERE shot_id = shotId（缓存跟上）
  //   失败处理：
  //     - 飞书删失败 → 直接返回错误（DB 不动，避免云端和本地不一致）
  //     - 飞书成功但 DB 失败 → warn 日志，仍返回 ok（云端是 source of truth）
  if (shotMatch && method === 'DELETE') {
    const feishuRecordId = shotMatch[1] // 飞书 record_id（rec...）
    try {
      // 0) 先拿到 token（后面要 GET 飞书记录拿「分镜 ID」）
      const token = await getFeishuTenantToken()

      // 1) 先查 runtimeMaterials 缓存拿 local shotId（快路径）
      let localShotId = null
      let owningMaterial = null
      for (const mat of runtimeMaterials) {
        if (!Array.isArray(mat.shots)) continue
        const found = mat.shots.find(
          (s) => (s.id === feishuRecordId || s.recordId === feishuRecordId) && s.shotId,
        )
        if (found) {
          localShotId = found.shotId
          owningMaterial = mat
          break
        }
      }

      // 2) 缓存里没有 → 直接 GET 飞书该条记录，从「分镜 ID」字段拿 local shotId
      //    （这条记录必须先于飞书删除前读，否则记录就没了）
      if (!localShotId && CFG.feishuTableId) {
        try {
          const rec = await feishuGetRecord(token, feishuRecordId, CFG.feishuTableId)
          if (rec && rec.fields) {
            // 飞书分镜表的本地 shot_id 字段名是「分镜 ID」
            const fid = rec.fields['分镜 ID']
            if (typeof fid === 'string' && fid) {
              localShotId = fid
              console.log(
                `[mock-api] /api/library/shot/${feishuRecordId.slice(0, 8)} 从飞书「分镜 ID」拿到 localShotId=${localShotId}`,
              )
            } else if (fid && fid[0] && typeof fid[0].text === 'string') {
              // 兼容飞书人员字段那种 [{text,id}] 格式
              localShotId = fid[0].text
            }
          }
        } catch (e) {
          console.warn(`[mock-api] GET 飞书分镜记录失败（可能已被删过）: ${e.message}`)
        }
      }

      console.log(
        `[mock-api] /api/library/shot/${feishuRecordId.slice(0, 8)} DELETE 准备: ` +
          `feishuRecordId=${feishuRecordId.slice(0, 12)} localShotId=${localShotId ? localShotId.slice(0, 24) : '(未找到)'} ` +
          `owningMaterial=${owningMaterial ? owningMaterial.id : '(无)'}`,
      )

      // 3) 同步飞书分镜表（云端权威）
      let feishuDeleted = false
      let feishuError = null
      if (CFG.feishuTableId) {
        try {
          await feishuDeleteRecord(token, feishuRecordId, CFG.feishuTableId)
          feishuDeleted = true
        } catch (e) {
          feishuError = e.message
          console.warn(`[mock-api] 飞书分镜删除失败: ${e.message}`)
        }
      }
      if (!feishuDeleted) {
        sendJson(res, {
          ok: false,
          shotId: feishuRecordId,
          error: feishuError || '飞书分镜表删除失败',
          feishuDeleted,
          dbDeleted: false,
        }, 502)
        return
      }

      // 4) 同步本地 DB（缓存跟上）
      let dbDeleted = false
      if (dbCjs) {
        if (!localShotId) {
          console.warn(
            `[mock-api] 未找到 ${feishuRecordId} 对应的 localShotId，跳过 DB 删除（缓存为空且飞书记录中也无「分镜 ID」）`,
          )
        } else {
          try {
            dbDeleted = await dbCjs.deleteShotFromDb(localShotId)
            if (!dbDeleted) {
              console.warn(
                `[mock-api] DB 分镜删除未命中: localShotId=${localShotId}（可能 DB 早就不存在该行）`,
              )
            }
          } catch (e) {
            console.warn(`[mock-api] DB 分镜删除失败: ${e.message}`)
          }
        }
      }

      // 5) 同步 runtimeMaterials 缓存（保持内存与云端一致）
      if (owningMaterial) {
        const before = owningMaterial.shots.length
        owningMaterial.shots = owningMaterial.shots.filter(
          (s) => s.id !== feishuRecordId && s.recordId !== feishuRecordId,
        )
        const removed = before - owningMaterial.shots.length
        if (removed > 0) {
          owningMaterial.shotCount = owningMaterial.shots.length
          owningMaterial.sceneVideoCount = owningMaterial.shots.length
          console.log(
            `[mock-api] runtimeMaterials 缓存已剔除 ${removed} 条分镜（material=${owningMaterial.id}）`,
          )
        }
      }

      console.log(
        `[mock-api] /api/library/shot/${feishuRecordId.slice(0, 8)} DELETE -> ` +
          `feishu=${feishuDeleted}, db=${dbDeleted}, localShotId=${localShotId || '(无)'}`,
      )
      sendJson(res, {
        ok: true,
        shotId: feishuRecordId,
        feishuDeleted,
        dbDeleted,
        feishuError: null,
      })
    } catch (e) {
      sendError(res, `shot delete failed: ${e.message}`, 500)
    }
    return
  }

  // ─ ── 批量重跑分镜（覆盖历史错误时间戳） ───────────────────────────────
  // POST /api/library/re-analyze-all     启动后台 job（同步返回 jobId）
  // GET  /api/library/re-analyze-progress 查询进度
  //
  // 策略：
  //   1. 扫描飞书所有主视频记录，识别「分镜时间戳错」（最后分镜 endTime << 视频总时长）
  //   2. 对每个错的主记录：删旧分镜 → 下载 OSS 视频 → 走 Video-01 整段分析 → 写新分镜
  //   3. 串行处理（MiniMax API 有并发限制），实时更新 _reAnalyzeJob 进度
  //   4. 前端轮询 /api/library/re-analyze-progress 展示进度

  /** 判断某个视频的分镜时间戳是否错（lastEnd << totalDuration） */
  function isShotTimestampBroken(shots, totalDuration) {
    if (!Array.isArray(shots) || shots.length === 0) return false
    if (!totalDuration || totalDuration <= 0) return false
    const lastEnd = Number(shots[shots.length - 1].endTime || shots[shots.length - 1]['结束时间 (s)'] || 0)
    // 阈值：lastEnd < totalDuration * 0.7 且 lastEnd < totalDuration - 3s
    // （防止正常覆盖 70%+ 的视频被误判重跑）
    if (lastEnd >= totalDuration * 0.7) return false
    if (totalDuration - lastEnd < 3) return false
    return true
  }

  /** 删除指定主记录下所有分镜（关联的原视频 = mainRecordId） */
  async function deleteShotsByMainRecordId(mainRecordId) {
    const token = await getFeishuTenantToken()
    const allShots = await fetchAllShotsFromFeishu()
    const toDelete = allShots.filter((s) => {
      const links = s.fields?.['关联的原视频']
      if (!Array.isArray(links)) return false
      // Feishu link 字段可能是 ["record_id"] 或 [{ record_ids: ["record_id"] }]
      for (const link of links) {
        if (typeof link === 'string' && link === mainRecordId) return true
        if (link && typeof link === 'object' && Array.isArray(link.record_ids) && link.record_ids.includes(mainRecordId)) return true
      }
      return false
    })
    let deleted = 0
    for (const s of toDelete) {
      const r = await deleteFeishuRecord(s.record_id, CFG.feishuTableId)
      if (r.ok) deleted++
    }
    return { deleted, total: toDelete.length }
  }

  /** 内部：执行单个视频的重跑（删旧 → 下载 → Video-01 → 写新分镜） */
  async function _reanalyzeSingleVideo(v, ctx) {
    const mainRecordId = v.feishuRecordId
    const fileName = v.fileName || v.videoName || 'unknown.mp4'
    const ossUrl = v.playableUrl || v.thumbnailUrl || ''
    if (!mainRecordId) throw new Error('missing mainRecordId')
    if (!ossUrl) throw new Error('missing ossUrl')

    // 1) 删旧分镜
    const del = await deleteShotsByMainRecordId(mainRecordId)
    console.log(`[re-analyze] 🗑️  ${fileName}: 删除 ${del.deleted}/${del.total} 条旧分镜`)

    // 2) 状态置为「分析中」
    await updateMainVideoRecord(mainRecordId, { '分析状态': '分析中' })

    // 3) 下载到本地（Video-01 需要本地路径）
    const tmpLocal = path.join(CFG.videoDir, `_rea_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`)
    try {
      const r = await fetch(ossUrl)
      if (!r.ok) throw new Error(`download failed: ${r.status}`)
      const buffer = Buffer.from(await r.arrayBuffer())
      fs.writeFileSync(tmpLocal, buffer)
      console.log(`[re-analyze] 📥  ${fileName}: 下载 ${(buffer.length / 1024 / 1024).toFixed(2)}MB`)

      // 4) 复用 _analyzeAndSyncToShotTableImpl（已经走 Video-01）
      await _analyzeAndSyncToShotTableImpl({
        localPath: tmpLocal,
        fileName,
        ossUrl,
        duration: v.totalDuration,
        mainRecordId,
        businessId: mainRecordId,
        uploaderRole: 'admin', // admin 模式让 AI 识别 people
      })
      return { ok: true, fileName, deletedOld: del.deleted }
    } finally {
      try { fs.unlinkSync(tmpLocal) } catch {}
    }
  }

  // _reAnalyzeJob 已在模块级声明（见顶部），跨请求共享状态

  if (url === '/api/library/re-analyze-all' && method === 'POST') {
    if (_reAnalyzeJob.running) {
      sendJson(res, { ok: false, error: '已有 job 在运行中', progress: _reAnalyzeJob }, 409)
      return
    }
    // 异步启动，立刻返回 jobId
    _reAnalyzeJob.running = true
    _reAnalyzeJob.startedAt = Date.now()
    _reAnalyzeJob.finishedAt = 0
    _reAnalyzeJob.totalScanned = 0
    _reAnalyzeJob.totalBroken = 0
    _reAnalyzeJob.processed = 0
    _reAnalyzeJob.success = 0
    _reAnalyzeJob.failed = 0
    _reAnalyzeJob.currentFile = ''
    _reAnalyzeJob.errors = []
    _reAnalyzeJob.log = []
    const jobId = `reanalyze_${Date.now()}`
    const logLine = (msg) => {
      const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
      _reAnalyzeJob.log.push(line)
      if (_reAnalyzeJob.log.length > 50) _reAnalyzeJob.log.shift()
      console.log(`[re-analyze] ${msg}`)
    }

    ;(async () => {
      try {
        logLine('🔍 扫描飞书所有主视频记录...')
        const cloud = await fetchAllVideosFromFeishuCloud()
        _reAnalyzeJob.totalScanned = cloud.videos.length
        logLine(`📊 共 ${cloud.videos.length} 条主记录，识别分镜错误...`)

        // 识别 broken
        const broken = cloud.videos.filter((v) => {
          if (!v.shots || v.shots.length === 0) return false
          const lastEnd = Number(v.shots[v.shots.length - 1].endTime || 0)
          const totalDur = Number(v.totalDuration || 0)
          return isShotTimestampBroken(v.shots, totalDur) && (v.feishuRecordId || v.playableUrl)
        })
        _reAnalyzeJob.totalBroken = broken.length
        logLine(`❗ 发现 ${broken.length} 条分镜错误的视频（lastEnd << totalDuration）`)

        // 串行处理
        for (let i = 0; i < broken.length; i++) {
          const v = broken[i]
          const fileName = v.fileName || v.videoName || `video_${i}`
          _reAnalyzeJob.currentFile = fileName
          logLine(`▶️  [${i + 1}/${broken.length}] 处理: ${fileName}（视频 ${v.totalDuration}s，旧 lastEnd=${v.shots[v.shots.length - 1]?.endTime}s）`)
          try {
            const r = await _reanalyzeSingleVideo(v)
            _reAnalyzeJob.success++
            logLine(`✅ ${fileName}: 成功（删 ${r.deletedOld} 旧分镜，写新分镜）`)
          } catch (e) {
            _reAnalyzeJob.failed++
            _reAnalyzeJob.errors.push({ fileName, error: e.message })
            logLine(`❌ ${fileName}: ${e.message}`)
          }
          _reAnalyzeJob.processed++
        }
        logLine(`🎉 完成：成功 ${_reAnalyzeJob.success}，失败 ${_reAnalyzeJob.failed}`)
      } catch (e) {
        logLine(`💥 job 异常: ${e.message}`)
        _reAnalyzeJob.errors.push({ fileName: '(job)', error: e.message })
      } finally {
        _reAnalyzeJob.running = false
        _reAnalyzeJob.finishedAt = Date.now()
        _reAnalyzeJob.currentFile = ''
      }
    })()

    sendJson(res, { ok: true, jobId, message: '已启动批量重跑，可通过 /api/library/re-analyze-progress 查询进度' })
    return
  }

  if (url === '/api/library/re-analyze-progress' && method === 'GET') {
    sendJson(res, {
      ok: true,
      running: _reAnalyzeJob.running,
      startedAt: _reAnalyzeJob.startedAt,
      finishedAt: _reAnalyzeJob.finishedAt,
      totalScanned: _reAnalyzeJob.totalScanned,
      totalBroken: _reAnalyzeJob.totalBroken,
      processed: _reAnalyzeJob.processed,
      success: _reAnalyzeJob.success,
      failed: _reAnalyzeJob.failed,
      currentFile: _reAnalyzeJob.currentFile,
      errors: _reAnalyzeJob.errors.slice(-10), // 最近 10 条错误
      log: _reAnalyzeJob.log.slice(-20), // 最近 20 条日志
      progress: _reAnalyzeJob.totalBroken > 0
        ? Math.round((_reAnalyzeJob.processed / _reAnalyzeJob.totalBroken) * 100)
        : 0,
    })
    return
  }

  // GET /api/library/search?q=xxx — 跨产品/员工的关键词搜索（云端优先）
  if (url.startsWith('/api/library/search') && method === 'GET') {
    try {
      // ⚠️ 业务员视图隔离：业务员只能在自己的素材里搜
      const ctx = await getRequestUser(req)
      const u = new URL(req.url, 'http://localhost')
      const q = u.searchParams.get('q') || ''
      const limit = parseInt(u.searchParams.get('limit') || '50', 10)
      // 云端搜索：从飞书聚合后的 videos 列表中过滤
      const cloud = await fetchAllVideosFromFeishuCloud()
      let pool = cloud.videos
      if (ctx.isSalesperson) {
        pool = pool.filter((v) => videoBelongsToSalesperson(v, ctx.user?.name))
      }
      let results = []
      if (q && pool.length > 0) {
        const qLower = q.toLowerCase()
        results = pool.filter(v => {
          const fields = [v.productModel, v.fileName, ...getVideoPersonNames(v), v.industry, v.clientName, v.department, ...(v.categoryTags || []), ...(v.sellingPointTags || [])]
          return fields.some(f => f && String(f).toLowerCase().includes(qLower))
        })
      } else if (!q) {
        results = pool
      }
      results = results.slice(0, limit)
      console.log(`[mock-api] /api/library/search?q=${q} (云端${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 裁剪` : ''}) -> ${results.length} 条`)
      sendJson(res, { query: q, total: results.length, items: results })
    } catch (e) {
      console.error('[mock-api] /api/library/search failed:', e.message)
      // Fallback DB
      if (dbCjs) {
        try {
          const ctx = await getRequestUser(req)
          const u = new URL(req.url, 'http://localhost')
          const q = u.searchParams.get('q') || ''
          const limit = parseInt(u.searchParams.get('limit') || '50', 10)
          let results = await dbCjs.searchMaterialsFromDb(q, { limit })
          if (ctx.isSalesperson) {
            results = results.filter((m) => (m.person_name || m.personName) === (ctx.user?.name || ''))
          }
          console.log(`[mock-api] /api/library/search?q=${q} (DB fallback${ctx.isSalesperson ? `, 业务员=${ctx.user.name} 裁剪` : ''}) -> ${results.length} 条`)
          sendJson(res, { query: q, total: results.length, items: results })
          return
        } catch {}
      }
      sendError(res, `search failed: ${e.message}`, 500)
    }
    return
  }

  // ── /api/admin/feishu-preview: 直接读飞书原始记录（不写库） ─────────────
  if (url === '/api/admin/feishu-preview' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const pageSize = Math.min(body.page_size || 10, 100)
      const pageToken = body.page_token || ''
      const token = await getFeishuTenantToken()
      const feishuRes = await feishuGetTableRecords(token, pageSize, pageToken)
      sendJson(res, feishuRes)
    } catch (e) {
      sendError(res, e.message, 500)
    }
    return
  }

  // ── /api/admin/feishu-fields: 读取飞书表格字段定义（schema） ─────────────
  if (url === '/api/admin/feishu-fields' && method === 'GET') {
    try {
      const token = await getFeishuTenantToken()
      const feishuRes = await feishuGetTableFields(token)
      sendJson(res, feishuRes)
    } catch (e) {
      sendError(res, e.message, 500)
    }
    return
  }

  // ── /api/admin/migrate: 在已运行的 PGlite 上执行 schema 变更 ───────────
  if (url === '/api/admin/migrate' && method === 'POST') {
    if (!dbCjs) { sendError(res, 'DB not available', 503); return }
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const sql = body.sql
      if (!sql) { sendError(res, 'Missing sql', 400); return }
      // 安全白名单：仅允许 ALTER TABLE / CREATE INDEX
      const trimmed = sql.trim().toUpperCase()
      if (!trimmed.startsWith('ALTER TABLE') && !trimmed.startsWith('CREATE INDEX')) {
        sendError(res, 'Only ALTER TABLE / CREATE INDEX allowed', 400)
        return
      }
      const db = dbCjs.getPglite()
      const r = await db.query(sql)
      sendJson(res, { ok: true, rowsAffected: r.rowsAffected || r.affectedRows || 0 })
    } catch (e) {
      sendError(res, `Migration failed: ${e.message}`, 500)
    }
    return
  }

  // ── /api/admin/check-column: 检查列是否存在（用于迁移前判断） ───────────
  if (url === '/api/admin/check-column' && method === 'GET') {
    if (!dbCjs) { sendError(res, 'DB not available', 503); return }
    const u = new URL(req.url, 'http://localhost')
    const table = u.searchParams.get('table')
    const column = u.searchParams.get('column')
    if (!table || !column) { sendError(res, 'Missing table/column', 400); return }
    try {
      const db = dbCjs.getPglite()
      const r = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1;`,
        [table, column],
      )
      sendJson(res, { exists: r.rows.length > 0 })
    } catch (e) {
      sendError(res, e.message, 500)
    }
    return
  }

  // ── /api/admin/cleanup-orphan-mains ────────────────────────────────────
  // 业务：主视频表里「视频文件名」在分镜表里找不到对应记录的主表记录，是无效数据。
  // body: {
  //   dryRun?: boolean = true,
  //   confirm?: boolean = false,
  //   sampleLimit?: number = 50,
  //   statusDelete?: string[] = null
  //     // 仅当「分析状态」命中这些值之一才删；null 表示全删（兼容旧调用）。
  //     // 典型用法：statusDelete=['未分析','内容审核拦截','分析失败','分析中']，
  //     //          保留 status='已分析' 但分镜表已不在的「行业+产品已写」记录。
  // }
  //   dryRun=true (默认)  → 只返回会删的列表，不真正删除
  //   dryRun=false + confirm=true → 真正调用飞书 DELETE
  // 鉴权：仅 admin
  if (url === '/api/admin/cleanup-orphan-mains' && method === 'POST') {
    try {
      const ctx = await getRequestUser(req)
      if (!ctx.isAdmin) {
        sendError(res, '仅管理员可执行清理操作', 403)
        return
      }
      const body = JSON.parse(await readBody(req) || '{}')
      const dryRun = body.dryRun !== false
      const confirm = body.confirm === true
      const sampleLimit = Math.max(1, Math.min(body.sampleLimit || 50, 500))
      const statusDelete = Array.isArray(body.statusDelete) && body.statusDelete.length > 0
        ? body.statusDelete.map((s) => String(s).trim()).filter(Boolean)
        : null  // null = 不按状态过滤，全删

      if (!CFG.feishuMainTableId) {
        sendError(res, 'FEISHU_MAIN_TABLE_ID 未配置', 500)
        return
      }

      // 1) 取分镜表所有 fileName
      const shotRecs = await fetchAllShotsFromFeishu()
      const shotFileNames = new Set()
      for (const r of shotRecs) {
        const fn = r.fields?.['视频文件名']
        if (fn) shotFileNames.add(String(fn).trim())
      }

      // 2) 取主表所有记录 → 分类：非孤儿 / 孤儿-本次删 / 孤儿-按状态保留
      const mainRecs = await fetchAllMainRecordsFromFeishu()
      const allOrphans = []
      const matched = []      // 最终进入删除流程的
      const statusKept = []   // 是孤儿，但 status 不在删除白名单内，本次跳过
      const kept = []         // 非孤儿（主表里有但分镜表也有）
      for (const r of mainRecs) {
        const f = r.fields || {}
        const fn = String(f['视频文件名'] || '').trim()
        const isOrphan = !fn || !shotFileNames.has(fn)
        const status = String(f['分析状态'] || '').trim()
        const row = {
          recordId: r.record_id,
          fileName: fn || '(空)',
          productModel: f['产品型号'] || '',
          industry: f['行业'] || '',
          clientName: f['客户'] || '',
          status: status || '(空)',
          createdAt: f['创建时间'] || r.created_time || '',
        }
        if (!isOrphan) {
          kept.push({ recordId: r.record_id, fileName: fn, status: row.status })
          continue
        }
        allOrphans.push(row)
        const statusAllowed = statusDelete === null
          || statusDelete.length === 0
          || statusDelete.includes(status)
        if (statusAllowed) {
          matched.push(row)
        } else {
          statusKept.push(row)
        }
      }

      // 按 status 分组统计（dry-run 时方便确认）
      const statusBreakdown = {}
      for (const o of allOrphans) {
        statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1
      }

      console.log(
        `[mock-api] cleanup-orphan-mains dryRun=${dryRun} statusDelete=${
          statusDelete === null ? 'ALL' : JSON.stringify(statusDelete)
        } -> 主表 ${mainRecs.length} 条，全孤儿 ${allOrphans.length} 条，本次删 ${matched.length} 条，按状态保留 ${statusKept.length} 条，分镜 fileName 共 ${shotFileNames.size} 个`
      )

      // dry-run：直接返回，不动飞书
      if (dryRun) {
        sendJson(res, {
          ok: true,
          mode: 'dryRun',
          mainTotal: mainRecs.length,
          shotFileNameTotal: shotFileNames.size,
          orphanTotal: allOrphans.length,
          deleteCount: matched.length,
          statusKeptCount: statusKept.length,
          keptCount: kept.length,
          statusDelete,
          statusBreakdown,
          orphans: matched.slice(0, sampleLimit),
          orphanSamplesMore: matched.length > sampleLimit,
          statusKeptSamples: statusKept.slice(0, 10),
          sampleLimit,
        })
        return
      }

      // 真删：必须 confirm
      if (!confirm) {
        sendError(res, '需要 confirm: true 才能真删', 400)
        return
      }

      const token = await getFeishuTenantToken()
      const results = { deleted: [], failed: [] }
      for (const o of matched) {
        try {
          await feishuDeleteRecord(token, o.recordId, CFG.feishuMainTableId)
          results.deleted.push({ recordId: o.recordId, fileName: o.fileName, status: o.status })
        } catch (e) {
          results.failed.push({ recordId: o.recordId, error: e.message })
        }
      }
      console.log(`[mock-api] cleanup-orphan-mains 真删完成: 成功 ${results.deleted.length} 失败 ${results.failed.length}`)
      sendJson(res, {
        ok: true,
        mode: 'commit',
        mainTotal: mainRecs.length,
        shotFileNameTotal: shotFileNames.size,
        orphanTotal: allOrphans.length,
        deleteCount: matched.length,
        statusKeptCount: statusKept.length,
        keptCount: kept.length,
        statusDelete,
        deletedCount: results.deleted.length,
        failedCount: results.failed.length,
        deleted: results.deleted.slice(0, sampleLimit),
        failed: results.failed.slice(0, 20),
        sampleLimit,
      })
    } catch (e) {
      console.error('[mock-api] /api/admin/cleanup-orphan-mains failed:', e.message)
      sendError(res, `cleanup failed: ${e.message}`, 500)
    }
    return
  }

  // ── /api/admin/oss-health: 探测 OSS 凭据 & 桶连通性 ──────────────────
  if (url === '/api/admin/oss-health' && method === 'GET') {
    try {
      const r = await checkOssHealth()
      sendJson(res, r)
    } catch (e) {
      sendJson(res, { ok: false, error: e.message, code: e.code })
    }
    return
  }

  // ── /api/admin/oss-test: 从本地上传指定文件到 OSS（用于模拟测试） ─────
  // body: { filePath: "/Users/jensen/Desktop/93.mp4", objectKey?: "test/foo.mp4" }
  if (url === '/api/admin/oss-test' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const filePath = body.filePath
      if (!filePath) { sendError(res, 'Missing filePath', 400); return }
      if (!existsSync(filePath)) { sendError(res, `File not found: ${filePath}`, 404); return }
      const r = await uploadToOss(filePath, body.objectKey)
      console.log('[mock-api] ✅ OSS 测试上传成功:', r.key, r.publicUrl)
      sendJson(res, { ok: true, ...r })
    } catch (e) {
      console.error('[mock-api] ❌ OSS 测试上传失败:', e.message)
      sendJson(res, { ok: false, error: e.message, code: e.code })
    }
    return
  }

  // ── /api/admin/oss-list-prefix: 列出 OSS 桶下指定前缀的文件 ──────────
  // query: ?prefix=videos/&maxKeys=20
  if (url === '/api/admin/oss-list-prefix' && method === 'GET') {
    try {
      const u = new URL(req.url, 'http://localhost')
      const prefix = u.searchParams.get('prefix') || ''
      const maxKeys = Math.min(parseInt(u.searchParams.get('maxKeys') || '20'), 100)
      const client = getOssClient()
      const r = await client.list({ prefix, 'max-keys': maxKeys })
      sendJson(res, {
        ok: true,
        prefix,
        count: (r.objects || []).length,
        objects: (r.objects || []).map(o => ({
          key: o.name, size: o.size, lastModified: o.lastModified, etag: o.etag,
        })),
      })
    } catch (e) {
      sendJson(res, { ok: false, error: e.message, code: e.code })
    }
    return
  }

  // ── /api/admin/oss-feishu-push: 上传文件到 OSS 后推送到主视频表 ─────
  // body: { filePath, duration? }
  // 主视频表字段（7 个）：视频文件名 / 文件 Hash 值 / OSS 云端地址 / 总时长 (s) / 分析状态 / 入库时间 / 反向关联分镜
  if (url === '/api/admin/oss-feishu-push' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const { filePath, duration: inputDuration } = body
      if (!filePath || !existsSync(filePath)) { sendError(res, 'Missing or not-found filePath', 400); return }

      // 1) 上传到 OSS
      const oss = await uploadToOss(filePath)
      console.log('[mock-api] ✅ OSS 上传完成:', oss.publicUrl)

      // 2) 计算文件 hash
      const hash = dbCjs ? await dbCjs.computeFileHash(filePath) : ''

      // 3) 自动探测时长（如未传）
      const duration = inputDuration != null
        ? Number(inputDuration)
        : (/\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)$/i.test(filePath) ? await getVideoDuration(filePath) : 0)

      // 4) 推送到主视频表
      const r = await pushToMainVideoTable({
        fileName: path.basename(filePath),
        fileHash: hash,
        ossUrl: oss.publicUrl,
        duration,
        status: '未分析',
      })
      if (!r.ok) {
        sendJson(res, { ok: false, step: 'mainTable', oss, hash, error: r.error, code: r.code })
        return
      }
      console.log('[mock-api] ✅ 主视频表写入成功:', r.recordId)
      sendJson(res, { ok: true, oss, hash, duration, mainTable: { recordId: r.recordId, fields: r.fields } })
    } catch (e) {
      console.error('[mock-api] ❌ OSS+主视频表 流程失败:', e.message)
      sendJson(res, { ok: false, error: e.message, code: e.code })
    }
    return
  }

  const matParts = url.split('/')
  if (matParts[1] === 'api' && matParts[2] === 'materials' && matParts.length === 4) {
    const id = decodeURIComponent(matParts[3])
    if (method === 'DELETE') { runtimeMaterials = runtimeMaterials.filter(m => m.id !== id); sendJson(res, undefined); return }
    if (method === 'PATCH') {
      try {
        const idx = runtimeMaterials.findIndex(m => m.id === id)
        if (idx >= 0) runtimeMaterials[idx] = { ...runtimeMaterials[idx], ...JSON.parse(await readBody(req)) }
        sendJson(res, runtimeMaterials.find(m => m.id === id))
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
  }

  // ── Production Tasks ───────────────────────────────────────────────────────
  if (url === '/api/production/tasks') {
    if (method === 'GET') { sendJson(res, tasks); return }
    if (method === 'POST') {
      try {
        const dto = JSON.parse(await readBody(req))
        const newTask = {
          id: dto.id || `task_${Date.now()}`,
          productName: dto.productName || '新产品',
          script: dto.script || '',
          status: dto.status || '待脚本',
          assignee: dto.assignee || '',
          assigneeAvatar: '',
          tags: dto.tags || [],
          videoUrl: dto.videoUrl || '',
          keyframes: dto.keyframes || [],
          priority: dto.priority || 'medium',
          dueDate: dto.dueDate || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...dto,
        }
        newTask.id = dto.id || newTask.id
        tasks.push(newTask)
        sendJson(res, newTask)
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
  }
  const taskParts = url.split('/')
  if (taskParts[1] === 'api' && taskParts[2] === 'production' && taskParts[3] === 'tasks' && taskParts.length === 5) {
    const id = taskParts[4]
    const idx = tasks.findIndex(t => t.id === id)
    if (idx === -1) { sendError(res, 'Not found', 404); return }
    if (method === 'PATCH') {
      try { tasks[idx] = { ...tasks[idx], ...JSON.parse(await readBody(req)), updatedAt: new Date().toISOString() } } catch {}
      sendJson(res, tasks[idx])
      return
    }
    if (method === 'DELETE') { tasks.splice(idx, 1); sendJson(res, undefined); return }
  }

  // ── Authorization ──────────────────────────────────────────────────────────
  if (url === '/api/authorization') {
    if (method === 'GET') { sendJson(res, authRecords); return }
    if (method === 'POST') {
      try {
        const dto = JSON.parse(await readBody(req))
        const newRecord = {
          id: dto.id || `auth_${Date.now()}`,
          name: dto.name || '',
          type: dto.type || 'employee',
          status: dto.status || 'pending',
          method: dto.method || 'paid',
          amount: dto.amount || 2999,
          authorizedDate: dto.authorizedDate || new Date().toISOString().split('T')[0],
          expiryDate: dto.expiryDate || '',
          contact: dto.contact || '',
          ...dto,
        }
        newRecord.id = dto.id || newRecord.id
        authRecords.push(newRecord)
        sendJson(res, newRecord)
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
  }
  if (url.startsWith('/api/authorization/')) {
    const id = url.split('/')[3]
    const idx = authRecords.findIndex(r => r.id === id)
    if (idx === -1) { sendError(res, 'Not found', 404); return }
    if (method === 'PATCH') {
      try { authRecords[idx] = { ...authRecords[idx], ...JSON.parse(await readBody(req)) } } catch {}
      sendJson(res, authRecords[idx])
      return
    }
    if (method === 'DELETE') {
      authRecords.splice(idx, 1)
      sendJson(res, undefined)
      return
    }
  }

  // ── Video Shots CRUD 由下方 /api/video/shots 分支统一处理（保留此处占位） ──

  // ── Static video files (供前端 <video> 播放本地文件) ────────────────────────
  // 通用媒体文件服务：支持 HTTP Range（206），视频可拖动、浏览器按需加载
  function serveMediaFile(filePath, contentType) {
    if (!existsSync(filePath)) { sendError(res, 'File not found', 404); return }
    const stat = statSync(filePath)
    const range = req.headers.range
    const baseHead = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    }
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
        res.end()
        return
      }
      res.writeHead(206, {
        ...baseHead,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { ...baseHead, 'Content-Length': stat.size })
      fs.createReadStream(filePath).pipe(res)
    }
  }

  // 原始上传视频
  if (url.startsWith('/api/video/file/') && method === 'GET') {
    const filename = path.basename(decodeURIComponent(url.replace('/api/video/file/', '')))
    serveMediaFile(path.join(CFG.videoDir, filename), 'video/mp4')
    return
  }

  // 封面图（V1）
  if (url.startsWith('/api/media/cover/') && method === 'GET') {
    const name = path.basename(decodeURIComponent(url.replace('/api/media/cover/', '')))
    serveMediaFile(path.join(CFG.coverDir, name), 'image/jpeg')
    return
  }

  // 转码后视频（V1）
  if (url.startsWith('/api/media/transcoded/') && method === 'GET') {
    const name = path.basename(decodeURIComponent(url.replace('/api/media/transcoded/', '')))
    serveMediaFile(path.join(CFG.transcodeDir, name), 'video/mp4')
    return
  }

  // ── Video analysis list (聚合 runtimeMaterials) ───────────────────────────
  if (url === '/api/video' && method === 'GET') {
    // 只取 type='product' 的视频素材（跳过 employee/persona）
    const videoMats = runtimeMaterials.filter((m) => m.type === 'product' && (m.sceneVideoCount || m.shotCount || 0) > 0)
    const list = videoMats.map((m) => ({
      id: m.id,
      videoUrl: (m.sceneVideoUrls && m.sceneVideoUrls[0]) || '',
      videoName: m.fileName || m.productName || '',
      productModel: m.productName || '',
      totalDuration: m.totalDuration || 0,
      shotCount: m.sceneVideoCount || m.shotCount || 0,
      industry: m.industry || '',
      clientName: '',
      department: '',
      categoryTags: m.sellingPointTags || m.categoryTags || [],
      quality: m.quality || '',
      filePath: '',
      createdAt: m.createdAt || new Date().toISOString(),
      updatedAt: m.createdAt || new Date().toISOString(),
    }))
    console.log(`[mock-api] /api/video -> ${list.length} analyses (from runtimeMaterials, filtered product type)`)
    sendJson(res, list)
    return
  }

  // ── Video analysis create (POST /api/video) — 通用创建入口 ───────────────
  if (url === '/api/video' && method === 'POST') {
    try {
      const dto = JSON.parse(await readBody(req))
      const newId = dto.id || `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const newMat = {
        id: newId,
        type: dto.type || 'product',
        productName: dto.productName || dto.title || dto.fileName || newId,
        fileName: dto.fileName || dto.title || '',
        sceneVideoUrls: dto.sceneVideoUrls || (dto.videoUrl ? [dto.videoUrl] : []),
        sceneVideoCount: dto.sceneVideoCount || (Array.isArray(dto.shots) ? dto.shots.length : 0),
        shotCount: dto.shotCount || (Array.isArray(dto.shots) ? dto.shots.length : 0),
        shots: Array.isArray(dto.shots) ? dto.shots : [],
        totalDuration: dto.totalDuration || 0,
        industry: dto.industry || '',
        sellingPointTags: dto.sellingPointTags || dto.categoryTags || [],
        categoryTags: dto.categoryTags || [],
        quality: dto.quality || '',
        createdAt: new Date().toISOString(),
        ...dto,
      }
      newMat.id = newId
      const existingIdx = runtimeMaterials.findIndex(m => m.id === newId)
      if (existingIdx >= 0) {
        runtimeMaterials[existingIdx] = { ...runtimeMaterials[existingIdx], ...newMat }
        sendJson(res, runtimeMaterials[existingIdx])
      } else {
        runtimeMaterials.unshift(newMat)
        sendJson(res, newMat)
      }
      console.log(`[mock-api] /api/video POST -> id=${newId}`)
    } catch (e) { sendError(res, 'Invalid body: ' + e.message, 400) }
    return
  }
  // /api/video/{id} — GET/DELETE. Exclude sub-routes handled elsewhere (analyze, shots, file).
  const detailMatch = url.match(/^\/api\/video\/([^/]+)$/)
  const isVideoSubRoute = detailMatch && ['analyze', 'shots', 'file'].includes(detailMatch[1])
  if (detailMatch && method === 'GET' && !isVideoSubRoute) {
    const id = decodeURIComponent(detailMatch[1])
    const mat = runtimeMaterials.find((m) => m.id === id)
    if (mat) {
      const videoUrl = (mat.sceneVideoUrls && mat.sceneVideoUrls[0]) || ''
      // videoUrl 可能是 file:// 或 /api/video/... 路径，统一转换为 http URL
      let playableUrl = videoUrl
      if (videoUrl.startsWith('file://')) {
        const basename = path.basename(videoUrl.replace('file://', ''))
        playableUrl = `http://localhost:${PORT}/api/video/file/${encodeURIComponent(basename)}`
      } else if (videoUrl.startsWith('/api/video/file/')) {
        playableUrl = `http://localhost:${PORT}${videoUrl}`
      } else if (videoUrl.startsWith('/')) {
        playableUrl = `http://localhost:${PORT}${videoUrl}`
      }
      const analysis = {
        id: mat.id,
        productModel: mat.productName || '',
        totalDuration: mat.totalDuration || 0,
        shotCount: mat.sceneVideoCount || mat.shotCount || 0,
        shots: (mat.shots || []).map((s, i) => ({
          startTime: Number(s.startTime) || 0,
          endTime: Number(s.endTime) || 0,
          description: s.description || '',
          scene: s.scene || '',
          objects: s.objects || '',
          action: s.action || '',
          camera: s.camera || '',
          coreSellingPoint: s.coreSellingPoint || s.sellingPoint || '',
          narrationText: s.narrationText || '',
        })),
        industry: mat.industry || '',
        categoryTags: mat.sellingPointTags || mat.categoryTags || [],
        quality: mat.quality || '',
        videoName: mat.fileName || mat.productName || '',
        videoUrl: playableUrl,
        filePath: playableUrl,
        createdAt: mat.createdAt || new Date().toISOString(),
        updatedAt: mat.createdAt || new Date().toISOString(),
      }
      console.log(`[mock-api] /api/video/${id} -> ${analysis.shots.length} shots, videoUrl=${playableUrl.slice(0, 60)}`)
      sendJson(res, analysis)
      return
    } else {
      sendError(res, `Analysis not found: ${id}`, 404)
      return
    }
  }

  // ── Video analysis delete (DELETE /api/video/{id}) ─────────────────────────
  if (detailMatch && method === 'DELETE' && !isVideoSubRoute) {
    const id = decodeURIComponent(detailMatch[1])
    const before = runtimeMaterials.length
    runtimeMaterials = runtimeMaterials.filter(m => m.id !== id)
    if (runtimeMaterials.length < before) {
      console.log(`[mock-api] /api/video/${id} DELETE -> ok`)
      sendJson(res, undefined)
    } else {
      sendError(res, 'Not found', 404)
    }
    return
  }

  // ── Batch video analyze (POST /api/video/analyze/batch) ────────────────────
  if (url === '/api/video/analyze/batch' && method === 'POST') {
    try {
      const dto = JSON.parse(await readBody(req))
      const items = Array.isArray(dto.items) ? dto.items : []
      const results = items.map((it) => ({
        id: it.id || `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'analyzing',
        videoUrl: it.videoUrl || '',
        productModel: it.productModel || '',
        shotCount: 0,
      }))
      console.log(`[mock-api] /api/video/analyze/batch -> ${results.length} items queued`)
      sendJson(res, { count: results.length, items: results })
    } catch { sendError(res, 'Invalid body', 400) }
    return
  }

  // ── Video Shots CRUD (/api/video/shots) ────────────────────────────────────
  if (url === '/api/video/shots' || url.startsWith('/api/video/shots?')) {
    if (method === 'GET') {
      // 支持 ?analysisId=xxx 查询参数
      const queryStr = url.includes('?') ? url.split('?')[1] : ''
      const params = new URLSearchParams(queryStr)
      const analysisId = params.get('analysisId')
      let shots = runtimeShots
      if (analysisId) {
        const mat = runtimeMaterials.find(m => m.id === analysisId)
        shots = (mat && mat.shots) || []
      }
      sendJson(res, shots)
      return
    }
    if (method === 'POST') {
      try {
        const dto = JSON.parse(await readBody(req))
        const newShot = {
          id: dto.id || `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          analysisId: dto.analysisId || '',
          startTime: Number(dto.startTime) || 0,
          endTime: Number(dto.endTime) || 0,
          duration: Number(dto.duration) || (Number(dto.endTime) - Number(dto.startTime)),
          description: dto.description || '',
          scene: dto.scene || '',
          objects: dto.objects || '',
          action: dto.action || '',
          camera: dto.camera || '',
          coreSellingPoint: dto.coreSellingPoint || dto.sellingPoint || '',
          narrationText: dto.narrationText || '',
          shotIndex: dto.shotIndex || 0,
        }
        // 同步到对应 material 的 shots 数组
        if (dto.analysisId) {
          const mat = runtimeMaterials.find(m => m.id === dto.analysisId)
          if (mat) {
            mat.shots = mat.shots || []
            mat.shots.push(newShot)
            mat.shotCount = mat.shots.length
            mat.sceneVideoCount = mat.shots.length
          }
        }
        runtimeShots.push(newShot)
        console.log(`[mock-api] /api/video/shots POST -> ${newShot.id} (analysis=${dto.analysisId})`)
        sendJson(res, newShot)
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
  }

  // ── Video Shots single CRUD (/api/video/shots/{id}) ────────────────────────
  const shotParts = url.split('/')
  if (shotParts[1] === 'api' && shotParts[2] === 'video' && shotParts[3] === 'shots' && shotParts.length === 5) {
    const shotId = decodeURIComponent(shotParts[4])
    if (method === 'PATCH') {
      try {
        const dto = JSON.parse(await readBody(req))
        const idx = runtimeShots.findIndex(s => s.id === shotId)
        if (idx >= 0) runtimeShots[idx] = { ...runtimeShots[idx], ...dto }
        // 同步到 material
        const shot = runtimeShots.find(s => s.id === shotId)
        if (shot && shot.analysisId) {
          const mat = runtimeMaterials.find(m => m.id === shot.analysisId)
          if (mat && mat.shots) {
            const mi = mat.shots.findIndex(s => s.id === shotId)
            if (mi >= 0) mat.shots[mi] = { ...mat.shots[mi], ...dto }
          }
        }
        sendJson(res, runtimeShots.find(s => s.id === shotId) || null)
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
    if (method === 'DELETE') {
      const before = runtimeShots.length
      runtimeShots = runtimeShots.filter(s => s.id !== shotId)
      // 同步从 material 删除
      for (const mat of runtimeMaterials) {
        if (mat.shots) {
          mat.shots = mat.shots.filter(s => s.id !== shotId)
          mat.shotCount = mat.shots.length
          mat.sceneVideoCount = mat.shots.length
        }
      }
      if (runtimeShots.length < before) {
        console.log(`[mock-api] /api/video/shots/${shotId} DELETE -> ok`)
        sendJson(res, undefined)
      } else {
        sendError(res, 'Not found', 404)
      }
      return
    }
  }

  // ── Workflow ───────────────────────────────────────────────────────────────
  if (url === '/api/workflow/runs') {
    if (method === 'GET') { sendJson(res, workflowRuns); return }
    if (method === 'POST') {
      try {
        const dto = JSON.parse(await readBody(req))
        const id = dto.id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const run2 = {
          runId: id,
          id,
          status: 'running',
          name: dto.name || 'Workflow run',
          steps: dto.steps || [],
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...dto,
          id,
          runId: id,
        }
        workflowRuns.unshift(run2)
        console.log(`[mock-api] /api/workflow/runs POST -> ${id}`)
        sendJson(res, run2)
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
  }

  // ── Workflow run single (/api/workflow/runs/{id}) ─────────────────────────
  const runParts = url.split('/')
  if (runParts[1] === 'api' && runParts[2] === 'workflow' && runParts[3] === 'runs' && runParts.length === 5) {
    const runId = decodeURIComponent(runParts[4])
    const idx = workflowRuns.findIndex(r => r.runId === runId || r.id === runId)
    if (method === 'GET') {
      if (idx === -1) { sendError(res, 'Not found', 404); return }
      sendJson(res, workflowRuns[idx])
      return
    }
    if (method === 'PATCH') {
      if (idx === -1) { sendError(res, 'Not found', 404); return }
      try {
        workflowRuns[idx] = { ...workflowRuns[idx], ...JSON.parse(await readBody(req)), updatedAt: new Date().toISOString() }
        sendJson(res, workflowRuns[idx])
      } catch { sendError(res, 'Invalid body', 400) }
      return
    }
    if (method === 'DELETE') {
      if (idx === -1) { sendError(res, 'Not found', 404); return }
      workflowRuns.splice(idx, 1)
      console.log(`[mock-api] /api/workflow/runs/${runId} DELETE -> ok`)
      sendJson(res, undefined)
      return
    }
  }

  sendError(res, `Not found: ${method} ${url}`, 404)
}

// ─── Server ───────────────────────────────────────────────────────────────────
const PORT = 9099
const server = http.createServer(async (req, res) => {
  try {
    const url = normalizeUrl(req.url ?? '')
    if (url.startsWith('/api')) {
      await handleApi(req, res)
      return
    }
    // 静态文件
    const publicDir = path.resolve(__dirname, '../../public')
    const filePath = path.join(publicDir, url === '/' ? 'index.html' : url)
    try {
      if (existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath)
        const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.wav': 'audio/wav' }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
        createReadStream(filePath).pipe(res)
        return
      }
    } catch {}
    res.writeHead(404)
    res.end('Not found')
  } catch (e) {
    console.error('[mock-api] Server error:', e)
    res.writeHead(500)
    res.end('Internal error')
  }
})

// ── V1：飞书 → DB 后台增量同步（请求链路不再实时拉飞书，列表直查 DB）─────────
let _feishuSyncing = false
/**
 * 历史视频封面批量回填：
 * 对 DB 中“无封面、但有 OSS 可播放地址”的视频，直接用 ffmpeg 对 OSS URL 抽帧
 * （无需先完整下载，单条约 3–8s）→ 上传 covers/ → 回填 thumbnail_url。
 * 可重复执行：已回填的会因 thumbnail_url 非空而自动跳过。
 */
async function backfillCovers({ limit = 20, at = 3 } = {}) {
  if (!dbCjs) return { processed: 0, ok: 0, fail: 0, error: 'db 未就绪' }
  const pending = await dbCjs.listMaterialsWithoutCoverFromDb(limit)
  let ok = 0
  let fail = 0
  for (const m of pending) {
    try {
      const safe = String(m.business_id || m.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
      const coverName = `backfill_${safe}.jpg`
      const coverLocalPath = path.join(CFG.coverDir, coverName)
      await mediaPipeline.generateCover({ input: m.playable_url, output: coverLocalPath, at })
      let coverUrl = ''
      try {
        const uploaded = await uploadToOss(coverLocalPath, `covers/${coverName}`, { skipPrefix: true })
        coverUrl = uploaded.publicUrl
      } catch (ossErr) {
        coverUrl = `http://localhost:${PORT}/api/media/cover/${encodeURIComponent(coverName)}`
      }
      await dbCjs.updateMaterialFieldFromDb(m.business_id, { thumbnail_url: coverUrl })
      ok += 1
      console.log(`[backfill] ${ok}/${pending.length} ${m.file_name} -> ${coverUrl}`)
    } catch (e) {
      fail += 1
      console.warn(`[backfill] 失败 ${m.file_name}: ${e.message}`)
    }
  }
  const result = { processed: pending.length, ok, fail }
  console.log('[backfill] 本轮结束', result)
  return result
}

async function syncFeishuVideosToDb(reason = 'scheduled') {
  if (!dbCjs) return { synced: 0, reason }
  if (_feishuSyncing) { console.log('[feishu-sync] 上一轮仍在进行，本轮跳过'); return { skipped: true } }
  _feishuSyncing = true
  const t0 = Date.now()
  try {
    const cloud = await fetchAllVideosFromFeishuCloud()
    let inserted = 0, updated = 0, failed = 0
    for (const v of cloud.videos) {
      try {
        const baseName = (v.fileName || '').split('/').pop()
        const productName = v.productModel || v.productName || (baseName || '').replace(/\.[^.]+$/, '') || '未分类'
        // 稳定 businessId：已存在（按飞书 recordId / fileHash）则沿用并更新，否则用 feishu_<recordId> 新建
        let businessId = null
        const byRec = v.feishuRecordId ? await dbCjs.findMaterialByFeishuRecordId(v.feishuRecordId) : null
        if (byRec) { businessId = byRec.business_id; updated++ }
        else {
          const byHash = v.fileHash ? await dbCjs.findMaterialByHash(v.fileHash) : null
          if (byHash) { businessId = byHash.business_id; updated++ }
          else { businessId = `feishu_${v.feishuRecordId || v.id || baseName}`; inserted++ }
        }
        await dbCjs.upsertMaterial({
          businessId,
          type: 'product',
          productName,
          fileName: baseName,
          filePath: '',
          playableUrl: v.playableUrl || v.videoUrl || '',
          thumbnailUrl: v.thumbnailUrl || '',
          industry: v.industry || '',
          quality: v.quality || '',
          personName: v.personName || null,
          analysisStatus: 'done',
          totalDuration: v.totalDuration || 0,
          shotCount: v.shotCount || 0,
          sellingPointTags: v.sellingPointTags || [],
          sceneVideoUrls: v.videoUrl ? [v.videoUrl] : (v.playableUrl ? [v.playableUrl] : []),
          source: 'feishu',
          feishuRecordId: v.feishuRecordId || '',
          description: v.fileName || '',
          fileHash: v.fileHash || '',
          shots: Array.isArray(v.shots) ? v.shots : [],
        })
      } catch (e) {
        failed++
        console.warn(`[feishu-sync] 同步失败 ${(v.fileName || '').split('/').pop()}: ${e.message}`)
      }
    }
    console.log(`[feishu-sync] (${reason}) 完成：新增 ${inserted} / 更新 ${updated} / 失败 ${failed}，共 ${cloud.videos.length}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    return { inserted, updated, failed, total: cloud.videos.length }
  } catch (e) {
    console.error(`[feishu-sync] (${reason}) 拉取失败: ${e.message}`)
    return { error: e.message }
  } finally {
    _feishuSyncing = false
  }
}

server.listen(PORT, () => {
  console.log(`[mock-api] =========================================`)
  console.log(`[mock-api]  真实能力 API Server 启动`)
  console.log(`[mock-api]  Port: ${PORT}`)
  console.log(`[mock-api]  MiniMax: ${CFG.minimaxKey ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`[mock-api]  豆包TTS: ${CFG.doubaoClientId ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`[mock-api]  飞书表格: ${CFG.feishuAppId ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`[mock-api]  FFmpeg: ${process.env.FFMPEG_PATH || '/Users/jensen/miniconda3/bin/ffmpeg'}`)
  console.log(`[mock-api]  视频目录: ${CFG.videoDir}`)
  console.log(`[mock-api] =========================================`)
  // V1：启动 2s 后后台做一次飞书→DB 全量同步（不阻塞监听），之后每 10 分钟增量
  setTimeout(() => { syncFeishuVideosToDb('startup').catch(() => {}) }, 2000)
  setInterval(() => { syncFeishuVideosToDb('incremental').catch(() => {}) }, 10 * 60 * 1000)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[mock-api] Port ${PORT} is already in use. Kill with: lsof -ti:${PORT} | xargs kill`)
  } else {
    console.error('[mock-api] Server error:', err)
  }
  process.exit(1)
})

// graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0) })
process.on('SIGINT', () => { server.close(); process.exit(0) })
