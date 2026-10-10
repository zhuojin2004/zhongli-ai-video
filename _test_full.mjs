// dry_run.mjs: 跑 2 个视频（1 原始 + 1 压缩版），验证完整链路
// 用 node --env-file=.env 跑（避免 import hoisting 问题）

import { statSync, existsSync, createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import OSS from 'ali-oss'

const oss = new OSS({
  accessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET,
  bucket: process.env.ALI_OSS_BUCKET,
  region: process.env.ALI_OSS_REGION,
})
console.log("REACHED END")
