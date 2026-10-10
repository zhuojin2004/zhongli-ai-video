import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core'
import { videoShots } from '@server/database/schema'
import { eq, asc } from 'drizzle-orm'
import type { VideoShot, CreateVideoShotDto, UpdateVideoShotDto } from '@shared/api.interface'

@Injectable()
export class ShotService {
  private readonly logger = new Logger(ShotService.name)

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async listByAnalysis(analysisId: string): Promise<VideoShot[]> {
    const rows = await this.db
      .select()
      .from(videoShots)
      .where(eq(videoShots.analysisId, analysisId))
      .orderBy(asc(videoShots.startTime))
    return rows.map((row) => this.dbToApi(row))
  }

  async create(dto: CreateVideoShotDto, userId: string): Promise<VideoShot> {
    const [row] = await this.db
      .insert(videoShots)
      .values({
        analysisId: dto.analysisId,
        startTime: dto.startTime,
        endTime: dto.endTime,
        description: dto.description,
        scene: dto.scene,
        objects: dto.objects,
        action: dto.action,
        camera: dto.camera,
        coreSellingPoint: dto.coreSellingPoint,
        narrationText: dto.narrationText,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()
    return this.dbToApi(row)
  }

  async update(
    id: string,
    dto: UpdateVideoShotDto,
    userId: string,
  ): Promise<VideoShot> {
    const patch: Partial<typeof videoShots.$inferInsert> = {}
    if (dto.startTime !== undefined) patch.startTime = dto.startTime
    if (dto.endTime !== undefined) patch.endTime = dto.endTime
    if (dto.description !== undefined) patch.description = dto.description
    if (dto.scene !== undefined) patch.scene = dto.scene
    if (dto.objects !== undefined) patch.objects = dto.objects
    if (dto.action !== undefined) patch.action = dto.action
    if (dto.camera !== undefined) patch.camera = dto.camera
    if (dto.coreSellingPoint !== undefined) patch.coreSellingPoint = dto.coreSellingPoint
    if (dto.narrationText !== undefined) patch.narrationText = dto.narrationText

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段')
    }

    patch.updatedAt = new Date()
    patch.updatedBy = userId

    const [row] = await this.db
      .update(videoShots)
      .set(patch)
      .where(eq(videoShots.id, id))
      .returning()

    if (!row) {
      throw new NotFoundException('分镜记录不存在')
    }

    return this.dbToApi(row)
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(videoShots)
      .where(eq(videoShots.id, id))
      .returning({ id: videoShots.id })

    if (deleted.length === 0) {
      throw new NotFoundException('分镜记录不存在')
    }
  }

  private dbToApi(row: typeof videoShots.$inferSelect): VideoShot {
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
}