/**
 * 静态演示版数据导出脚本
 * 从运行中的后端（http://localhost:9099）拉取真实数据，保存为静态 JSON：
 *   - products.json      产品列表（产品型号分组）
 *   - employees.json     员工列表
 *   - productDetails.json 每个产品的分页详情（含视频数组）
 *   - videoDetails.json   每个视频的详情（含分镜 shots）
 *
 * 用法：node client/vite/export-static-data.mjs
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = process.env.EXPORT_API || 'http://localhost:9099'
const OUT_DIR = path.resolve(__dirname, '../src/static-demo/data')
const PAGE_SIZE = 50

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(API + p, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(new Error('JSON parse fail for ' + p + ': ' + d.slice(0, 200))) }
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('timeout ' + p)))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // 1. 产品列表
  const productsResp = await get('/api/library/products')
  const products = productsResp.data || productsResp
  console.log('产品分组数:', products.length)

  // 2. 员工列表
  let employees = []
  try {
    const empResp = await get('/api/library/employees')
    employees = empResp.data || empResp
  } catch (e) { console.warn('员工列表拉取失败:', e.message) }
  console.log('员工分组数:', employees.length)

  // 3. 每个产品的全部分页详情（聚合视频）
  const productDetails = {}
  const allVideoIds = new Set()
  for (let i = 0; i < products.length; i++) {
    const model = products[i].productModel
    const enc = encodeURIComponent(model)
    let page = 1
    let merged = null
    while (true) {
      const r = await get(`/api/library/product/${enc}?page=${page}&pageSize=${PAGE_SIZE}`)
      const detail = r.data || r
      if (!merged) {
        merged = { productModel: model, videos: [], total: detail.total, page: 1, pageSize: PAGE_SIZE, totalPages: detail.totalPages }
      }
      merged.videos.push(...(detail.videos || []))
      ;(detail.videos || []).forEach((v) => v.id && allVideoIds.add(v.id))
      if (page >= (detail.totalPages || 1)) break
      page++
      await sleep(50)
    }
    productDetails[model] = merged
    console.log(`  [${i + 1}/${products.length}] ${model}: ${merged.videos.length} 视频`)
  }

  // 4. 每个视频详情（含分镜）
  const videoDetails = {}
  const ids = [...allVideoIds]
  let withShots = 0
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    try {
      const r = await get('/api/library/video/' + encodeURIComponent(id))
      const detail = r.data || r
      videoDetails[id] = detail
      if (detail.shots && detail.shots.length) withShots++
    } catch (e) {
      console.warn('  视频详情失败', id, e.message)
    }
    if (i % 20 === 0) process.stdout.write(`  视频详情 ${i + 1}/${ids.length}\n`)
    await sleep(30)
  }
  console.log(`视频详情: ${ids.length} 个，其中 ${withShots} 个含分镜`)

  // 5. 写文件
  fs.writeFileSync(path.join(OUT_DIR, 'products.json'), JSON.stringify(products))
  fs.writeFileSync(path.join(OUT_DIR, 'employees.json'), JSON.stringify(employees))
  fs.writeFileSync(path.join(OUT_DIR, 'productDetails.json'), JSON.stringify(productDetails))
  fs.writeFileSync(path.join(OUT_DIR, 'videoDetails.json'), JSON.stringify(videoDetails))
  console.log('已写入:', OUT_DIR)
}

main().catch((e) => { console.error(e); process.exit(1) })
