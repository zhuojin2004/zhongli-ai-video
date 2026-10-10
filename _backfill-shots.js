// 把 DB 里有 shots 但飞书 SHOT 表里没有的素材，重新把 shots 推送到飞书分镜表
//
// 触发场景：之前 _add-shot-fields.js 没跑成功 / 飞书缺「时长标签」字段，导致
//   writeShotToFeishu() 报 FieldNameNotFound，全部 shot 写入失败。
// 现在字段已经补齐，这个脚本把历史数据补上。
//
// 流程：
//   1) 读 .env
//   2) 拿 tenant_access_token
//   3) GET /api/materials/from-db 拿所有 DB 素材
//   4) 对每个 shotCount>0 的素材：
//      - 飞书主表（MAIN）查 record_id
//      - 把每条 shot 写到飞书 SHOT 表
//      - 把 shot record_id 数组回填到主表的「反向关联分镜」字段
//   5) 打印汇总
const fs = require('fs')
const env = fs.readFileSync('.env', 'utf8')
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || ''
const APP = get('FEISHU_APP_ID')
const SECRET = get('FEISHU_APP_SECRET')
const APP_TOKEN = get('FEISHU_BITABLE_APP_TOKEN')
const SHOT_TABLE = get('FEISHU_TABLE_ID')
const MAIN_TABLE = get('FEISHU_MAIN_TABLE_ID')
const FEISHU_BASE = get('VITE_LARK_BASE') || 'https://open.feishu.cn'
const API_BASE = process.env.API_BASE || 'http://localhost:9099'

;(async () => {
  console.log('=== 回填分镜脚本 _backfill-shots.js ===')
  console.log(`飞书 base: ${FEISHU_BASE}`)
  console.log(`SHOT 表: ${SHOT_TABLE}`)
  console.log(`MAIN 表: ${MAIN_TABLE}`)
  console.log(`本地 API: ${API_BASE}`)

  // 1) 拿飞书 token
  const tkRes = await fetch(FEISHU_BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  })
  const tkJ = await tkRes.json()
  if (tkJ.code !== 0) { console.error('Token error:', JSON.stringify(tkJ, null, 2)); process.exit(1) }
  const token = tkJ.tenant_access_token
  console.log('✓ Token OK (expires in ' + tkJ.expire + 's)')

  // 2) 拉所有飞书 MAIN 表记录（按视频文件名匹配 DB 素材）
  const mainRecords = await fetchAllMain(token)
  console.log(`\n飞书主表 MAIN 记录数: ${mainRecords.length}`)
  const byFileName = new Map()
  for (const r of mainRecords) {
    const fn = r.fields['视频文件名']
    if (fn && typeof fn === 'string') byFileName.set(fn, r)
  }
  console.log(`飞书主表里能按视频文件名匹配的记录: ${byFileName.size}`)

  // 3) 拉所有 DB 素材
  const dbRes = await fetch(API_BASE + '/api/materials/from-db')
  const dbJ = await dbRes.json()
  if (!dbJ.data) { console.error('拉 DB 素材失败:', JSON.stringify(dbJ).slice(0, 300)); process.exit(1) }
  const materials = dbJ.data
  console.log(`DB 素材总数: ${materials.length}`)

  // 4) 筛选 + 回填
  let totalShotsWritten = 0
  let totalMaterialsProcessed = 0
  let totalMaterialsSkipped = 0
  const errors = []
  for (const m of materials) {
    const shots = m.shots || []
    if (shots.length === 0) { continue }
    // 用视频文件名匹配主表
    const main = byFileName.get(m.fileName)
    if (!main) {
      // 某些 DB 记录的主表 recordId 可能在 m.feishuRecordId 里
      console.log(`  ⏭  跳过（飞书主表无匹配）: ${m.fileName} (businessId=${m.id})`)
      totalMaterialsSkipped++
      continue
    }
    const mainRecordId = main.record_id
    console.log(`\n▶ ${m.fileName} (DB shots=${shots.length}, mainRecordId=${mainRecordId})`)

    const writtenShotIds = []
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      const startT = Number(shot.startTime || 0)
      const endT = Number(shot.endTime || 0)
      const durationSec = Math.max(0, endT - startT)
      const total = Math.floor(durationSec)
      const mm = Math.floor(total / 60)
      const ss = total % 60
      const ms = Math.round((durationSec - total) * 1000)
      const durationLabel = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`

      const fields = {
        '分镜 ID': `shot_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        '视频文件名': m.fileName,
        '产品型号': shot.productModel || m.productName || '未知产品',
        '产品型号_分镜': `${shot.productModel || m.productName || '未知'}_分镜${i + 1}`,
        '开始时间 (s)': startT,
        '结束时间 (s)': endT,
        '原视频地址': m.playableUrl || (m.sceneVideoUrls && m.sceneVideoUrls[0]) || '',
        '画面描述': shot.description || '',
        '场景': shot.scene || '',
        '物体': shot.objects || '',
        '动作': shot.action || '',
        '镜头': shot.camera || '',
        '卖点': shot.coreSellingPoint || shot.sellingPoint || '',
        '时长标签': durationLabel,
        '姓名': m.personName || '',
        '行业': m.industry || shot.industry || '',
        '关联的原视频': [mainRecordId],
      }

      const r = await fetch(
        `${FEISHU_BASE}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${SHOT_TABLE}/records`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ fields }),
        })
      const jj = await r.json()
      if (jj.code !== 0) {
        console.error(`    ✗ 分镜 #${i} 失败: ${jj.msg} (code=${jj.code})`)
        errors.push({ file: m.fileName, shot: i, msg: jj.msg })
      } else {
        const rid = jj.data?.record?.record_id || jj.data?.record_id
        writtenShotIds.push(rid)
        console.log(`    ✓ 分镜 #${i} 写入: rid=${rid}`)
      }
    }

    if (writtenShotIds.length > 0) {
      // 回填主表的「反向关联分镜」
      const reverseR = await fetch(
        `${FEISHU_BASE}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${MAIN_TABLE}/records/${mainRecordId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            fields: { '反向关联分镜': writtenShotIds },
          }),
        })
      const reverseJ = await reverseR.json()
      if (reverseJ.code !== 0) {
        console.error(`    ✗ 主表反向关联回填失败: ${reverseJ.msg}`)
      } else {
        console.log(`    ✓ 主表反向关联: ${writtenShotIds.length} 条分镜`)
      }
    }
    totalShotsWritten += writtenShotIds.length
    totalMaterialsProcessed++

    // 节流，避免飞书限流
    await sleep(200)
  }

  console.log('\n=== 汇总 ===')
  console.log(`处理的素材: ${totalMaterialsProcessed}`)
  console.log(`跳过的素材: ${totalMaterialsSkipped}（飞书主表无匹配）`)
  console.log(`成功写入分镜: ${totalShotsWritten}`)
  console.log(`失败: ${errors.length}`)
  if (errors.length > 0) {
    console.log('\n失败明细:')
    for (const e of errors) console.log(`  - ${e.file} 分镜#${e.shot}: ${e.msg}`)
  }
})()

async function fetchAllMain(token) {
  const all = []
  let pageToken = ''
  while (true) {
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${MAIN_TABLE}/records?page_size=100${pageToken ? `&page_token=${pageToken}` : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json()
    if (j.code !== 0) throw new Error(`fetch MAIN failed: ${j.msg}`)
    all.push(...(j.data?.items || []))
    if (!j.data?.has_more) break
    pageToken = j.data.page_token
  }
  return all
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }