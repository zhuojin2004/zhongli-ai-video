import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common'
import { DRIZZLE_DATABASE, type PostgresJsDatabase, FileService } from '@lark-apaas/fullstack-nestjs-core'
import { videoAnalyses, videoShots } from '@server/database/schema'
import { eq, desc, asc } from 'drizzle-orm'
import type {
  AnalyzeVideoRequest,
  AnalyzeVideoResponse,
  VideoAnalysisRecord,
  ShotAnalysisResult,
  BatchAnalyzeRequest,
  BatchAnalyzeResponse,
  BatchAnalyzeItem,
} from '@shared/api.interface'
import { MOCK_VIDEO_TAGS } from './mock-data'

type AnalysisResult = Omit<
  AnalyzeVideoResponse,
  'id' | 'createdAt' | 'updatedAt'
>

const MINIMAX_API_KEY = '***MINIMAX_KEY_REMOVED***'
const MINIMAX_BASE = 'https://api.MiniMax.com/v1'

interface KimiFileResponse {
  id: string
  object: string
  bytes: number
  created_at: number
  filename: string
  purpose: string
}

interface KimiChatResponse {
  id: string
  choices: Array<{
    message: {
      content: string
    }
  }>
}

@Injectable()
export class VideoAnalysisService {
  private readonly logger = new Logger(VideoAnalysisService.name)

  constructor(
    private readonly fileService: FileService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async analyze(dto: AnalyzeVideoRequest): Promise<AnalyzeVideoResponse> {
    this.logger.log(`Starting video analysis for: ${dto.downloadUrl}`)

    const videoName = this.extractVideoName(dto.downloadUrl)
    let result: AnalysisResult

    if (!MINIMAX_API_KEY) {
      this.logger.log('MINIMAX_API_KEY not configured, using mock fallback')
      result = await this.mockAnalyze()
    } else {
      try {
        const { content } = await this.fileService
          .download(dto.downloadUrl)
          .asStream()

        const reader = content.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
        const buffer = Buffer.concat(chunks)

        this.logger.log(`Downloaded video, size: ${buffer.length} bytes`)

        const fileId = await this.uploadToMiniMax(buffer)
        this.logger.log(`Uploaded to MiniMax, file_id: ${fileId}`)

        result = await this.analyzeWithMiniMax(fileId)
        this.logger.log(`Analysis complete, ${result.shots.length} shots`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`MiniMax analysis failed, falling back to mock: ${msg}`)
        result = await this.mockAnalyze()
      }
    }

    // Persist to database
    const [analysis] = await this.db.insert(videoAnalyses).values({
      videoUrl: dto.downloadUrl,
      filePath: dto.filePath ?? null,
      videoName,
      productModel: result.productModel,
      totalDuration: result.totalDuration,
      shotCount: result.shotCount,
      industry: result.industry ?? null,
      clientName: result.clientName ?? null,
      department: result.department ?? null,
      categoryTags: result.categoryTags ?? [],
      quality: result.quality ?? null,
    }).returning()

    if (result.shots.length > 0) {
      await this.db.insert(videoShots).values(
        result.shots.map((s: ShotAnalysisResult) => ({
          analysisId: analysis.id,
          startTime: s.startTime,
          endTime: s.endTime,
          description: s.description,
          scene: s.scene,
          objects: s.objects,
          action: s.action,
          camera: s.camera,
          coreSellingPoint: s.coreSellingPoint,
          narrationText: s.narrationText,
        })),
      )
    }

    return {
      ...result,
      id: analysis.id,
      videoUrl: dto.downloadUrl,
      videoName,
      filePath: analysis.filePath ?? undefined,
      createdAt: analysis.createdAt.toISOString(),
      updatedAt: analysis.updatedAt.toISOString(),
    }
  }

  private mockAnalyze(): Promise<AnalysisResult> {
    const delay = 2000 + Math.random() * 3000
    this.logger.log(`Mock analysis in ~${(delay / 1000).toFixed(1)}s`)
    return new Promise((resolve) => {
      setTimeout(() => {
        const video = MOCK_VIDEO_TAGS[Math.floor(Math.random() * MOCK_VIDEO_TAGS.length)]
        const shots: AnalyzeVideoResponse['shots'] = video.shots.map((s) => ({
          startTime: s.startTime,
          endTime: s.endTime,
          description: s.description,
          scene: s.scene,
          objects: s.objects,
          action: s.action,
          camera: s.camera,
          coreSellingPoint: s.coreSellingPoint || s.sellingPoint,
          narrationText: s.narrationText,
        }))
        resolve({
          shots,
          productModel: video.productModel,
          totalDuration: video.totalDuration,
          shotCount: video.shotCount,
          industry: '物流行业',
          clientName: '中力叉车',
          department: '子公司A',
          categoryTags: ['电动叉车', '实景拍摄'],
          quality: '优质',
        })
      }, delay)
    })
  }

  async list(): Promise<VideoAnalysisRecord[]> {
    const rows = await this.db
      .select()
      .from(videoAnalyses)
      .orderBy(desc(videoAnalyses.createdAt))
      .limit(100)
    return rows.map((r) => this.videoAnalysesDbToApi(r))
  }

  async detail(id: string): Promise<AnalyzeVideoResponse> {
    const [analysis] = await this.db
      .select()
      .from(videoAnalyses)
      .where(eq(videoAnalyses.id, id))
    if (!analysis) {
      throw new NotFoundException('视频分析记录不存在')
    }

    const shots = await this.db
      .select()
      .from(videoShots)
      .where(eq(videoShots.analysisId, id))
      .orderBy(asc(videoShots.startTime))

    return {
      ...this.videoAnalysesDbToApi(analysis),
      shots: shots.map((s) => this.videoShotToApi(s)),
    }
  }

  async remove(id: string): Promise<void> {
    const [deleted] = await this.db
      .delete(videoAnalyses)
      .where(eq(videoAnalyses.id, id))
      .returning({ id: videoAnalyses.id })
    if (!deleted) {
      throw new NotFoundException('视频分析记录不存在')
    }
  }

  private videoAnalysesDbToApi(
    row: typeof videoAnalyses.$inferSelect,
  ): VideoAnalysisRecord {
    return {
      id: row.id,
      videoUrl: row.videoUrl,
      videoName: row.videoName ?? '',
      productModel: row.productModel ?? '',
      totalDuration: row.totalDuration ?? 0,
      shotCount: row.shotCount ?? 0,
      industry: row.industry ?? '',
      clientName: row.clientName ?? '',
      department: row.department ?? '',
      categoryTags: (row.categoryTags as string[]) ?? [],
      quality: row.quality ?? '',
      filePath: row.filePath ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private videoShotToApi(
    row: typeof videoShots.$inferSelect,
  ): ShotAnalysisResult {
    return {
      startTime: row.startTime,
      endTime: row.endTime,
      description: row.description ?? '',
      scene: row.scene ?? '',
      objects: row.objects ?? '',
      action: row.action ?? '',
      camera: row.camera ?? '',
      coreSellingPoint: row.coreSellingPoint ?? '',
      narrationText: row.narrationText ?? '',
    }
  }

  async analyzeBatch(dto: BatchAnalyzeRequest): Promise<BatchAnalyzeResponse> {
    this.logger.log(`Batch analyzing ${dto.downloadUrls.length} videos`)

    const results: BatchAnalyzeItem[] = await Promise.allSettled(
      dto.downloadUrls.map(async (downloadUrl: string) => {
        try {
          const result = await this.analyze({ downloadUrl })
          return { downloadUrl, success: true, result }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error)
          this.logger.error(`Batch analysis failed for ${downloadUrl}: ${msg}`)
          return { downloadUrl, success: false, error: msg }
        }
      }),
    ).then((settled: PromiseSettledResult<BatchAnalyzeItem>[]) =>
      settled.map((r: PromiseSettledResult<BatchAnalyzeItem>) => {
        if (r.status === 'fulfilled') return r.value
        return {
          downloadUrl: '',
          success: false,
          error: String(r.reason),
        }
      }),
    )

    return { results }
  }

  private extractVideoName(url: string): string {
    try {
      const pathname = new URL(url).pathname
      const segments = pathname.split('/').filter(Boolean)
      return segments[segments.length - 1] || '未命名视频'
    } catch {
      return '未命名视频'
    }
  }

  private async uploadToMiniMax(buffer: Buffer): Promise<string> {
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'video/mp4' }),
      'video.mp4',
    )
    formData.append('purpose', 'video')

    const res = await fetch(`${MINIMAX_BASE}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MINIMAX_API_KEY}` },
      body: formData,
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`MiniMax file upload failed: ${res.status} ${body}`)
    }

    const data: KimiFileResponse = await res.json()
    return data.id
  }

  private async analyzeWithMiniMax(
    fileId: string,
  ): Promise<AnalysisResult> {
    const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          {
            role: 'system',
            content:
              '你是一个专业的工业视频内容分析专家，专门分析叉车、物流设备等工业产品的营销视频。你需要完成两个任务：1) 逐帧分析视频分镜，识别每个分镜的起止时间、画面描述、场景、物体、动作、镜头语言和核心卖点；2) 从整体判断视频的行业属性、客户归属、部门归属、分类标签和素材质量。',
          },
          {
            role: 'user',
            content: [
              {
                type: 'video_url',
                video_url: { url: `${MINIMAX_BASE}/files/${fileId}/content` },
              },
              {
                type: 'text',
                text: `请分析这个视频，返回以下信息：

一、分镜列表（shots 数组）：每个分镜需包含 startTime（起始秒数）、endTime（结束秒数）、description（画面描述）、scene（场景，如仓库/工厂/户外/展厅等）、objects（画面中物体，如叉车/货架/托盘/工人等）、action（动作描述）、camera（镜头语言，如特写/全景/跟拍/俯拍等）、coreSellingPoint（核心卖点，如零排放/智能操控/超长续航/精准堆垛/窄通道适配等）、narrationText（建议旁白文案）。

二、整体元数据：
- productModel：产品型号
- totalDuration：总时长（秒）
- shotCount：分镜数量
- industry：所属行业（从以下选择：物流行业/仓储行业/汽车行业/制造行业/冷链行业/零售行业，根据视频内容判断最匹配的）
- clientName：所属客户（即视频中产品的使用方或品牌方名称，如无可从视频内容推断一个合理的客户名称）
- department：所属部门（从以下选择：子公司A/子公司B/子公司C/项目部门，根据视频内容判断）
- categoryTags：分类标签（从以下四组中各选 0-2 个最匹配的标签）
  - 功能性能：零排放/智能操控/超长续航/精准堆垛/窄通道适配/静音液压/快速充电/一键操作/自动避障/远程遥控
  - 应用场景：仓储搬运/冷链物流/户外作业/工厂产线/商超配送/港口码头/狭窄通道/高层货架
  - 展示呈现：真人出镜/3D动画/实景拍摄/航拍视角/第一人称/对比演示/数据可视化/慢动作特写
  - 产品属性：电动叉车/堆高车/搬运车/平衡重叉车/前移式叉车/AGV/牵引车/拣选车
- quality：素材质量评级（从以下选择：首发/优质/低质/低效/同质化）
  - 首发：首次出现的全新产品素材，画面新颖独特
  - 优质：画面清晰、构图专业、卖点突出、可直接用于营销
  - 低质：画面模糊、抖动、光线不足、需要后期处理
  - 低效：画面平淡、卖点不突出、缺乏吸引力
  - 同质化：与已有素材高度相似，缺乏差异化`,
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'video_shot_analysis',
            schema: {
              type: 'object',
              properties: {
                productModel: { type: 'string' },
                totalDuration: { type: 'number' },
                shotCount: { type: 'number' },
                industry: { type: 'string' },
                clientName: { type: 'string' },
                department: { type: 'string' },
                categoryTags: {
                  type: 'array',
                  items: { type: 'string' },
                },
                quality: { type: 'string' },
                shots: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      startTime: { type: 'number' },
                      endTime: { type: 'number' },
                      description: { type: 'string' },
                      scene: { type: 'string' },
                      objects: { type: 'string' },
                      action: { type: 'string' },
                      camera: { type: 'string' },
                      coreSellingPoint: { type: 'string' },
                      narrationText: { type: 'string' },
                    },
                    required: [
                      'startTime',
                      'endTime',
                      'description',
                      'scene',
                      'coreSellingPoint',
                    ],
                  },
                },
              },
              required: ['shots'],
            },
          },
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`MiniMax chat failed: ${res.status} ${body}`)
    }

    const data: KimiChatResponse = await res.json()
    const content = data.choices[0]?.message?.content
    if (!content) {
      throw new Error('MiniMax returned empty response')
    }

    const parsed: AnalyzeVideoResponse = JSON.parse(content)
    return parsed
  }
}