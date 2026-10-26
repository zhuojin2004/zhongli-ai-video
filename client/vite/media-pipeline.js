/**
 * media-pipeline.js — 中力视频平台媒体处理流水线（V1）
 * ------------------------------------------------------------------
 * 独立、可复用、可单独在命令行测试的 FFmpeg 封装，不依赖 mockApiServer
 * 内部状态。上传链路在文件落盘后调用本模块：
 *   1. probeVideo()      探测时长 / 分辨率 / 编码 / 有无音轨
 *   2. generateCover()   抽 10% 处帧，统一输出 640×360 JPG（黑边填充，
 *                        避免开头黑屏，卡片尺寸一致）
 *   3. transcodeToMp4()  异步转 H.264/AAC 浏览器通用 MP4（不阻塞上传响应）
 *
 * 环境变量：
 *   FFMPEG_PATH / FFPROBE_PATH   可覆盖二进制路径
 *   MEDIA_COVER_WIDTH / HEIGHT   封面尺寸（默认 640×360）
 * ------------------------------------------------------------------
 */
'use strict'

const { execFile } = require('child_process')
const { existsSync, mkdirSync } = require('fs')
const path = require('path')

const FFMPEG =
  process.env.FFMPEG_PATH ||
  '/Users/jensen/miniconda3/bin/ffmpeg'
const FFPROBE =
  process.env.FFPROBE_PATH ||
  '/Users/jensen/miniconda3/bin/ffprobe'

const COVER_WIDTH = parseInt(process.env.MEDIA_COVER_WIDTH || '640', 10)
const COVER_HEIGHT = parseInt(process.env.MEDIA_COVER_HEIGHT || '360', 10)

/** 运行一个命令，resolve { code, stdout, stderr }；非 0 退出则 reject */
function runCmd(bin, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (bin.includes('/') && !existsSync(bin)) {
      return reject(new Error(`可执行文件不存在: ${bin}`))
    }
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr
        return reject(err)
      }
      resolve({ code: 0, stdout, stderr })
    })
  })
}

/** 确保目录存在 */
function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ── 编码器能力探测（缓存，进程内只跑一次 ffmpeg -encoders）──────────────
let _encodersCache = null
async function listEncoders() {
  if (_encodersCache) return _encodersCache
  const { stdout } = await runCmd(FFMPEG, ['-hide_banner', '-encoders'])
  const set = new Set()
  for (const line of stdout.split('\n')) {
    // 形如 " V....D libx264  x264 H.264 ..."，trim 后前 6 位为能力标志，
    // 第 7 列起是编码器名（标志位可能含 V/A/S/B/L/R/D/T/X 或 .）
    const m = line.trim().match(/^[A-Z.]{6}\s+([A-Za-z0-9_]+)/)
    if (m) set.add(m[1])
  }
  _encodersCache = set
  return set
}
async function hasEncoder(name) {
  const set = await listEncoders()
  return set.has(name)
}

/**
 * 选择当前 ffmpeg 可用的最佳 H.264 编码器。
 * 优先级：libx264（标准构建，质量/体积最佳，支持 CRF）
 *   → h264_videotoolbox（macOS 硬件加速，快）
 *   → libopenh264（跨平台软件兜底，如 conda 无 GPL 构建）
 * @returns {Promise<{name:string, mode:'crf'|'bitrate'}>}
 */
async function pickH264Encoder() {
  for (const name of ['libx264', 'h264_videotoolbox', 'libopenh264']) {
    if (await hasEncoder(name)) {
      return { name, mode: name === 'libx264' ? 'crf' : 'bitrate' }
    }
  }
  throw new Error('未找到任何可用的 H.264 编码器（libx264 / h264_videotoolbox / libopenh264）')
}

/** 按视频高度给出转码目标码率（H.264，1080p≈4.5M / 720p≈2.5M / 480p≈1.2M） */
function targetBitrate(height) {
  if (height >= 1080) return '4500k'
  if (height >= 720) return '2500k'
  if (height >= 480) return '1200k'
  return '800k'
}

/**
 * 探测视频元数据
 * @param {string} filePath 视频绝对路径
 * @returns {Promise<{duration:number,width:number,height:number,
 *   videoCodec:string,hasAudio:boolean,audioCodec:string,size:number,
 *   isPortrait:boolean}>}
 */
async function probeVideo(filePath) {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]
  const { stdout } = await runCmd(FFPROBE, args)
  let info
  try {
    info = JSON.parse(stdout)
  } catch (e) {
    throw new Error(`ffprobe 输出解析失败: ${e.message}`)
  }
  const streams = Array.isArray(info.streams) ? info.streams : []
  const video = streams.find((s) => s.codec_type === 'video') || {}
  const audio = streams.find((s) => s.codec_type === 'audio') || null
  const width = parseInt(video.width || '0', 10)
  const height = parseInt(video.height || '0', 10)
  const duration = parseFloat(
    (info.format && info.format.duration) || video.duration || '0'
  )
  const size = parseInt((info.format && info.format.size) || '0', 10)
  return {
    duration: isNaN(duration) ? 0 : duration,
    width,
    height,
    videoCodec: video.codec_name || '',
    hasAudio: !!audio,
    audioCodec: audio ? audio.codec_name || '' : '',
    size: isNaN(size) ? 0 : size,
    isPortrait: height > width,
  }
}

/**
 * 计算封面抽帧时间点：取时长 10% 处，避开片头黑屏/淡入，
 * 同时夹在 [0.3s, duration-0.2s] 安全区间内。
 */
function coverSeekTime(duration) {
  if (!duration || duration <= 0) return 0
  const t = duration * 0.1
  return Math.min(Math.max(t, 0.3), Math.max(duration - 0.2, 0.3))
}

/**
 * 抽取并生成统一尺寸封面 JPG（640×360，等比缩放后居中、黑边填充）
 * @param {object} p
 * @param {string} p.input    源视频路径
 * @param {string} p.output   封面 jpg 路径
 * @param {number} [p.at]     抽帧秒数；不传则按 10% 规则
 * @param {number} [p.duration] 视频时长（配合 at 自动计算）
 * @returns {Promise<{output:string,at:number,width:number,height:number}>}
 */
async function generateCover({ input, output, at, duration }) {
  if (!input || !output) throw new Error('generateCover 缺少 input/output')
  ensureDir(path.dirname(output))
  const seek = typeof at === 'number' ? at : coverSeekTime(duration || 0)
  const isUrl = /^https?:\/\//i.test(input)
  // scale 到“能装进目标框”的最大尺寸，再 pad 补齐到精确 W×H，居中黑边
  const vf =
    `scale=${COVER_WIDTH}:${COVER_HEIGHT}:force_original_aspect_ratio=increase,` +
    `crop=${COVER_WIDTH}:${COVER_HEIGHT},setsar=1`
  // 本地文件：-ss 放 -i 前（输入 seek，快）；网络 URL：-ss 放 -i 后（输出 seek，定位准）
  // -update 1：image2 覆盖写单图，避免 sequence pattern 警告
  const seekArgs = ['-ss', seek.toFixed(3)]
  const tailArgs = ['-frames:v', '1', '-update', '1', '-vf', vf, '-q:v', '3', '-f', 'image2', output]
  const args = isUrl
    ? ['-y', '-i', input, ...seekArgs, ...tailArgs]
    : ['-y', ...seekArgs, '-i', input, ...tailArgs]
  try {
    await runCmd(FFMPEG, args)
  } catch (e) {
    throw new Error(`封面生成失败 @${seek}s: ${e.message} | ${(e.stderr || '').slice(-300)}`)
  }
  return { output, at: seek, width: COVER_WIDTH, height: COVER_HEIGHT }
}

/**
 * 转码为浏览器通用 MP4（H.264 + AAC）。
 * - 有音轨：视频 libx264，音频 AAC 128k
 * - 无音轨：仅转视频（-an），不强行加静音
 * @param {object} p
 * @param {string} p.input
 * @param {string} p.output
 * @param {boolean} [p.hasAudio]  是否有音轨；不传则自动探测
 * @param {string} [p.preset='veryfast']  x264 预设
 * @param {number} [p.crf=23]      画质（越小越清晰、越大文件越小）
 * @returns {Promise<{output:string}>}
 */
async function transcodeToMp4({ input, output, hasAudio, height, preset = 'veryfast', crf = 23, timeoutMs = 480000 }) {
  if (!input || !output) throw new Error('transcodeToMp4 缺少 input/output')
  ensureDir(path.dirname(output))
  let audioPresent = hasAudio
  let videoHeight = height
  if (typeof audioPresent !== 'boolean' || typeof videoHeight !== 'number') {
    try {
      const meta = await probeVideo(input)
      if (typeof audioPresent !== 'boolean') audioPresent = meta.hasAudio
      if (typeof videoHeight !== 'number') videoHeight = meta.height
    } catch (_) {
      audioPresent = true // 探测失败按有音轨处理，兼容性更稳
    }
  }
  // 自动选编码器（不同 ffmpeg 构建 / 平台可用项不同）
  const enc = await pickH264Encoder()
  const args = ['-y', '-i', input]
  if (enc.mode === 'crf') {
    args.push('-c:v', enc.name, '-preset', preset, '-crf', String(crf))
  } else {
    // videotoolbox / openh264 用目标码率控制
    args.push('-c:v', enc.name, '-b:v', targetBitrate(videoHeight || 1080))
  }
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart')
  if (audioPresent) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000')
  } else {
    args.push('-an')
  }
  args.push(output)
  try {
    await runCmd(FFMPEG, args, { timeoutMs })
  } catch (e) {
    throw new Error(`转码失败[${enc.name}]: ${e.message} | ${(e.stderr || '').slice(-300)}`)
  }
  return { output, encoder: enc.name }
}

module.exports = {
  runCmd,
  ensureDir,
  listEncoders,
  hasEncoder,
  pickH264Encoder,
  targetBitrate,
  probeVideo,
  coverSeekTime,
  generateCover,
  transcodeToMp4,
  FFMPEG,
  FFPROBE,
  COVER_WIDTH,
  COVER_HEIGHT,
}
