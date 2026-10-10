import { Injectable, Logger, Inject } from '@nestjs/common'
import {
  ConnectionsService,
} from '@lark-apaas/miaoda-connections-sdk'
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
  FileService,
} from '@lark-apaas/fullstack-nestjs-core'
import { videoShots } from '@server/database/schema'
import { or, ilike } from 'drizzle-orm'
import type {
  MatchShotsRequest,
  MatchShotsResponse,
  VideoShot,
  ShotCandidate,
  ShotClipItem,
} from '@shared/api.interface'
import { FfmpegClipper } from './ffmpeg-clipper'

interface ClipRequest {
  script: string
  videoUrls: string[]
  duration?: number
  shots?: ShotClipItem[]
}

export interface ClipResponse {
  videoUrl: string
  duration: number
}

@Injectable()
export class VideoEditingService {
  private readonly logger = new Logger(VideoEditingService.name)

  constructor(
    private readonly connections: ConnectionsService,
    private readonly fileService: FileService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async clipVideos(dto: ClipRequest): Promise<ClipResponse> {
    this.logger.log(
      `Starting video clip: ${dto.videoUrls.length} sources, ${dto.shots?.length ?? 0} shots, script length: ${dto.script.length}`,
    )

    if (dto.shots && dto.shots.length > 0) {
      try {
        return await this.clipWithFfmpeg(dto.shots)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Ffmpeg clip failed: ${msg}, falling back to bailian/mock`)
      }
    }

    let apiKey = ''

    try {
      const connection = await this.connections.getConnection({
        connectionName: 'aliyun-bailian',
      })

      if (connection.state === 'connected' && connection.value.type === 'api_key') {
        apiKey = connection.value.apiKey
        this.logger.log('Using aliyun-bailian connection for API key')
      } else {
        this.logger.warn(
          `aliyun-bailian connection state: ${connection.state}, falling back to mock`,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Failed to load aliyun-bailian connection: ${msg}, falling back to mock`)
    }

    if (apiKey) {
      try {
        const result = await this.callBailianClipAPI(apiKey, dto)
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Bailian clip API failed: ${msg}, falling back to mock`)
      }
    }

    return this.mockClip(dto)
  }

  private async callBailianClipAPI(
    apiKey: string,
    dto: ClipRequest,
  ): Promise<ClipResponse> {
    const res = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'video-synthesis',
          input: {
            script: dto.script,
            video_urls: dto.videoUrls,
            duration: dto.duration || 30,
          },
        }),
      },
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Bailian API error: ${res.status} ${body}`)
    }

    const data = (await res.json()) as {
      output?: { video_url?: string; duration?: number }
    }

    if (!data.output?.video_url) {
      throw new Error('Bailian API returned empty video_url')
    }

    return {
      videoUrl: data.output.video_url,
      duration: data.output.duration || 30,
    }
  }

  async matchShots(dto: MatchShotsRequest): Promise<MatchShotsResponse> {
    this.logger.log(
      `Matching shots for ${dto.scriptSegments.length} segments, target duration: ${dto.duration}s`,
    )

    const segments = dto.scriptSegments.map((seg) => {
      const keywords = this.extractKeywords(seg.text)
      return { text: seg.text, keywords }
    })

    const allKeywords = [
      ...new Set(segments.flatMap((s) => s.keywords)),
    ]

    const keywordShotMap = new Map<string, VideoShot[]>()
    for (const keyword of allKeywords) {
      const pattern = `%${keyword}%`
      const rows = await this.db
        .select()
        .from(videoShots)
        .where(
          or(
            ilike(videoShots.description, pattern),
            ilike(videoShots.coreSellingPoint, pattern),
            ilike(videoShots.scene, pattern),
            ilike(videoShots.objects, pattern),
          ),
        )
      keywordShotMap.set(
        keyword,
        rows.map((row) => this.shotDbToApi(row)),
      )
    }

    const expectedDuration =
      dto.segmentCount > 0
        ? dto.duration / dto.segmentCount
        : dto.duration / segments.length

    const result = segments.map(({ text, keywords }) => {
      const shotScores = new Map<
        string,
        { shot: VideoShot; score: number; shotDuration: number }
      >()

      for (const keyword of keywords) {
        const shots = keywordShotMap.get(keyword) || []
        for (const shot of shots) {
          const existing = shotScores.get(shot.id)
          if (existing) {
            existing.score += 1
          } else {
            const shotDuration = shot.endTime - shot.startTime
            shotScores.set(shot.id, { shot, score: 1, shotDuration })
          }
        }
      }

      const candidates: ShotCandidate[] = [...shotScores.values()]
        .map(({ shot, score, shotDuration }) => {
          const durationPenalty =
            expectedDuration > 0
              ? (Math.abs(shotDuration - expectedDuration) / expectedDuration) * 0.5
              : 0
          return { shot, score, shotDuration, adjustedScore: score - durationPenalty }
        })
        .sort(
          (
            a: ShotCandidate & { adjustedScore: number },
            b: ShotCandidate & { adjustedScore: number },
          ) => b.adjustedScore - a.adjustedScore,
        )
        .slice(0, 3)
        .map(
          ({
            shot,
            score,
            shotDuration,
          }: ShotCandidate & { adjustedScore: number }) => ({
            shot,
            score,
            shotDuration: Math.round(shotDuration * 10) / 10,
          }),
        )

      return { text, candidates }
    })

    return { segments: result }
  }

  private extractKeywords(text: string): string[] {
    const tokens = text.split(
      /[\s,.;:!?，。；：！？、""''【】《》（）…—\-\/\\]+/u,
    )
    return tokens
      .filter((t: string) => t.length >= 2)
      .map((t: string) => t.toLowerCase())
  }

  private shotDbToApi(
    row: typeof videoShots.$inferSelect,
  ): VideoShot {
    return {
      id: row.id,
      analysisId: row.analysisId,
      startTime: row.startTime,
      endTime: row.endTime,
      description: row.description ?? '',
      scene: row.scene ?? '',
      objects: row.objects ?? '',
      action: row.action ?? '',
      camera: row.camera ?? '',
      coreSellingPoint: row.coreSellingPoint ?? '',
      narrationText: row.narrationText ?? '',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private mockClip(dto: ClipRequest): Promise<ClipResponse> {
    const delay = 1500 + Math.random() * 2000
    this.logger.log(`Mock clip in ~${(delay / 1000).toFixed(1)}s`)

    return new Promise((resolve) => {
      setTimeout(() => {
        const fallbackUrl =
          dto.videoUrls.length > 0
            ? dto.videoUrls[0]
            : 'https://example.com/mock-clip.mp4'
        resolve({
          videoUrl: fallbackUrl,
          duration: dto.duration || 30,
        })
      }, delay)
    })
  }

  async clipWithFfmpeg(shots: ShotClipItem[]): Promise<ClipResponse> {
    this.logger.log(`clipWithFfmpeg: ${shots.length} shots`)
    const clipper = new FfmpegClipper(this.logger)
    const sourceUrl = shots[0]!.url
    this.logger.log(`Downloading source via fileService: ${sourceUrl}`)
    const stream = await this.fileService.download(sourceUrl).asStream()
    const sourceBuffer = await this.readStreamToBuffer(stream.content)
    this.logger.log(`Source downloaded: ${(sourceBuffer.length / 1024 / 1024).toFixed(2)}MB`)
    const { outputPath, duration } = await clipper.run(shots, sourceBuffer)
    try {
      const buffer = await clipper.readOutputFile(outputPath)
      const meta = await this.fileService.upload(buffer, {
        fileName: `clip-${Date.now()}.mp4`,
        contentType: 'video/mp4',
        upsert: false,
      })
      this.logger.log(`Uploaded clip: ${meta.downloadURL}`)
      return { videoUrl: meta.downloadURL, duration }
    } finally {
      const workDir = outputPath.replace(/\/out\.mp4$/, '')
      await clipper.cleanup(workDir)
    }
  }

  private async readStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return Buffer.concat(chunks)
  }
}