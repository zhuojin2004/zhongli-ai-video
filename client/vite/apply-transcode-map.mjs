/**
 * 把转码映射（原始 HEVC URL → H.264 URL）应用到静态演示数据 JSON。
 * 遍历 static-demo/data/ 下所有 JSON，递归替换其中的视频 URL。
 *
 * 运行时机：全量转码完成后（/tmp/hevc-transcode-map.json 完整）。
 * 用法：node client/vite/apply-transcode-map.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../src/static-demo/data')
const MAP_FILE = '/tmp/hevc-transcode-map.json'

const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'))

// 归一化：去掉协议（http/https 都能匹配），key = 域名+路径
const normMap = {}
for (const [k, v] of Object.entries(map)) {
  normMap[k.replace(/^https?:\/\//, '')] = v
}

function replaceUrl(u) {
  if (typeof u !== 'string') return u
  if (!u.includes('aliyuncs.com')) return u
  const key = u.replace(/^https?:\/\//, '')
  return normMap[key] || u
}

function walk(obj) {
  if (Array.isArray(obj)) return obj.map(walk)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) out[k] = walk(v)
    return out
  }
  return replaceUrl(obj)
}

let totalReplaced = 0
for (const f of readdirSync(DATA_DIR).filter(f => f.endsWith('.json'))) {
  const p = path.join(DATA_DIR, f)
  const before = readFileSync(p, 'utf8')
  // 统计替换次数
  let count = 0
  for (const key of Object.keys(normMap)) {
    const re = new RegExp('https?://' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    count += (before.match(re) || []).length
  }
  const after = JSON.stringify(walk(JSON.parse(before)), null, 2)
  if (before !== after) {
    writeFileSync(p, after)
    console.log(`已更新 ${f}（替换 ${count} 处）`)
    totalReplaced += count
  }
}
console.log(`共替换 ${totalReplaced} 处视频 URL，映射覆盖 ${Object.keys(map).length} 个视频`)
