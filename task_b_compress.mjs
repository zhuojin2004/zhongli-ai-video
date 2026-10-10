// Task B: ffmpeg 压缩 >50MB 的视频到 720p 30fps，目标 ≤45MB
import { execFile } from 'node:child_process'
import { readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = '/tmp/zhongli-videos'
const OUT_DIR = '/tmp/zhongli-videos/_compressed'
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

const allFiles = readdirSync(SRC_DIR)
  .filter(f => f.startsWith('upload_') && f.endsWith('.mp4'))
  .map(f => ({ name: f, path: join(SRC_DIR, f), size: statSync(join(SRC_DIR, f)).size }))

const big = allFiles.filter(f => f.size > 50 * 1024 * 1024)
const small = allFiles.filter(f => f.size <= 50 * 1024 * 1024)

console.log(`总: ${allFiles.length}, 大于50MB: ${big.length}, 小于等于50MB: ${small.length}`)

// 跳过已经是压缩版的（如果 _compressed 目录下已有同名文件）
const toCompress = big.filter(f => {
  const outPath = join(OUT_DIR, f.name)
  return !existsSync(outPath)
})
console.log(`待压缩: ${toCompress.length} 个`)

let done = 0, fail = 0
for (const f of toCompress) {
  const outPath = join(OUT_DIR, f.name)
  // 720p 30fps + aac 96k + crf 28 → 目标 ≤45MB
  const args = [
    '-y', '-i', f.path,
    '-vf', 'scale=-2:720',
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '28',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    outPath,
  ]
  try {
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', args, { timeout: 5 * 60 * 1000 }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr.slice(-200)))
        resolve()
      })
    })
    const newSize = statSync(outPath).size
    const newMB = (newSize / 1024 / 1024).toFixed(1)
    console.log(`  ✓ ${f.name}: ${(f.size/1024/1024).toFixed(1)}MB → ${newMB}MB`)
    done++
  } catch (e) {
    console.log(`  ✗ ${f.name}: ${e.message.slice(0, 100)}`)
    fail++
  }
}
console.log(`\n=== Task B done: 压缩 ${done}, 失败 ${fail} ===`)
