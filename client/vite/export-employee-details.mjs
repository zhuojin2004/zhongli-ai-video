/**
 * 补充导出员工详情：employeeDetails.json
 * 用法：node client/vite/export-employee-details.mjs
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
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch { reject(new Error('parse fail ' + p)) } })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('timeout')))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const employees = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'employees.json'), 'utf8'))
  const employeeDetails = {}
  for (let i = 0; i < employees.length; i++) {
    const name = employees[i].personName
    const enc = encodeURIComponent(name)
    let page = 1, merged = null
    while (true) {
      const r = await get(`/api/library/employee/${enc}?page=${page}&pageSize=${PAGE_SIZE}`)
      const detail = r.data || r
      if (!merged) merged = { personName: name, videos: [], total: detail.total, page: 1, pageSize: PAGE_SIZE, totalPages: detail.totalPages }
      merged.videos.push(...(detail.videos || []))
      if (page >= (detail.totalPages || 1)) break
      page++
      await sleep(50)
    }
    employeeDetails[name] = merged
    console.log(`[${i + 1}/${employees.length}] ${name}: ${merged.videos.length}`)
  }
  fs.writeFileSync(path.join(OUT_DIR, 'employeeDetails.json'), JSON.stringify(employeeDetails))
  console.log('已写 employeeDetails.json')
}
main().catch((e) => { console.error(e); process.exit(1) })
