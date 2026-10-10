import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { writeFile, mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { Logger } from '@nestjs/common'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { ShotClipItem } from '@shared/api.interface'

const FFMPEG_CANDIDATES = [
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  typeof ffmpegStatic === 'string' ? ffmpegStatic : null,
  join(__dirname, '../node_modules/ffmpeg-static/ffmpeg'),
].filter((p): p is string => Boolean(p))

const FFPROBE_CANDIDATES = [
  '/usr/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  typeof ffprobeStatic === 'string' ? ffprobeStatic : null,
  join(__dirname, '../node_modules/ffprobe-static/bin/linux/x64/ffprobe'),
].filter((p): p is string => Boolean(p))

function resolveBinary(
  candidates: string[],
  name: string,
  logger: Logger,
): string {
  for (const p of candidates) {
    if (!p) continue
    try {
      if (existsSync(p)) {
        const size = statSync(p).size
        if (size > 50 * 1024) {
          logger.log(`Using ${name} at ${p} (${(size / 1024 / 1024).toFixed(1)}MB)`)
          return p
        }
      }
    } catch {
      // ignore
    }
  }
  throw new Error(`No usable ${name} binary found in candidates: ${candidates.join(', ')}`)
}

export interface ClipResult {
  videoUrl: string
  duration: number
  outputPath: string
}

export class FfmpegClipper {
  private readonly logger: Logger
  private readonly ffmpegPath: string
  private readonly ffprobePath: string

  constructor(logger: Logger) {
    this.logger = logger
    this.ffmpegPath = resolveBinary(FFMPEG_CANDIDATES, 'ffmpeg', logger)
    this.ffprobePath = resolveBinary(FFPROBE_CANDIDATES, 'ffprobe', logger)
  }

  async run(shots: ShotClipItem[], sourceBuffer: Buffer): Promise<ClipResult> {
    if (shots.length === 0) {
      throw new Error('shots is empty')
    }

    const workDir = join(
      '/tmp',
      `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    await mkdir(workDir, { recursive: true })
    const sourcePath = join(workDir, 'source.mp4')
    const concatListPath = join(workDir, 'list.txt')
    const srtPath = join(workDir, 'subs.srt')
    const cutDir = join(workDir, 'cuts')
    await mkdir(cutDir, { recursive: true })
    const outputPath = join(workDir, 'out.mp4')

    try {
      await writeFile(sourcePath, sourceBuffer)
      this.logger.log(`Wrote source: ${(sourceBuffer.length / 1024 / 1024).toFixed(2)}MB`)

      const cutPaths: string[] = []
      let cursor = 0
      for (let i = 0; i < shots.length; i += 1) {
        const shot = shots[i]!
        const shotDur = Math.max(0.1, shot.endTime - shot.startTime)
        const cutPath = join(cutDir, `cut-${i}.mp4`)
        await this.runFfmpeg([
          '-y',
          '-ss', shot.startTime.toFixed(3),
          '-i', sourcePath,
          '-t', shotDur.toFixed(3),
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-c:a', 'aac',
          '-avoid_negative_ts', 'make_zero',
          cutPath,
        ])
        cutPaths.push(cutPath)
        cursor += shotDur
        this.logger.log(`Cut shot ${i + 1}/${shots.length} (${shotDur.toFixed(2)}s)`)
      }

      const concatList = cutPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
      await writeFile(concatListPath, concatList + '\n')

      const srt = this.buildSrt(shots)
      await writeFile(srtPath, srt)

      const subFilter =
        `subtitles=${srtPath}:force_style='FontName=Noto Sans CJK SC,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2'`
      await this.runFfmpeg([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-vf', subFilter,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-shortest',
        outputPath,
      ])

      const totalDur = shots.reduce((s, sh) => s + (sh.endTime - sh.startTime), 0)
      this.logger.log(
        `Clip complete: ${cutPaths.length} shots, ${totalDur.toFixed(2)}s total -> ${outputPath}`,
      )

      return { videoUrl: '', duration: totalDur, outputPath }
    } finally {
      // output file is uploaded by caller; cleanup of intermediate happens after upload
    }
  }

  async cleanup(workDir: string): Promise<void> {
    try {
      await rm(workDir, { recursive: true, force: true })
      this.logger.log(`Cleaned up ${workDir}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Cleanup ${workDir} failed: ${msg}`)
    }
  }

  async readOutputFile(outputPath: string): Promise<Buffer> {
    return readFile(outputPath)
  }

  private buildSrt(shots: ShotClipItem[]): string {
    let cursor = 0
    const lines: string[] = []
    for (let i = 0; i < shots.length; i += 1) {
      const shot = shots[i]!
      const dur = Math.max(0.1, shot.endTime - shot.startTime)
      const start = this.toSrtTime(cursor)
      const end = this.toSrtTime(cursor + dur)
      const text = (shot.narrationText || '').trim() || `镜头 ${i + 1}`
      lines.push(`${i + 1}\n${start} --> ${end}\n${text}\n`)
      cursor += dur
    }
    return lines.join('\n')
  }

  private toSrtTime(seconds: number): string {
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000)
    const total = Math.floor(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      proc.on('error', (err) => reject(err))
      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          const tail = stderr.split('\n').slice(-10).join('\n')
          reject(new Error(`ffmpeg exit ${code}: ${tail}`))
        }
      })
    })
  }

}

