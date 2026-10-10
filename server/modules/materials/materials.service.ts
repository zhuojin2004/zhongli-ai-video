import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { Logger } from '@nestjs/common'
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core'
import { videoAnalyses, videoShots } from '@server/database/schema'
import { eq, desc } from 'drizzle-orm'
import type {
  MaterialItem,
  UpdateMaterialDto,
  ImportMaterialRequest,
  ImportMaterialDto,
  ImportShotDto,
  CreateMaterialDto,
} from '@shared/api.interface'

function dbToApi(row: typeof videoAnalyses.$inferSelect): MaterialItem {
  return {
    id: row.id,
    type: (row.type as MaterialItem['type']) ?? 'product',
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

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name)

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async list(): Promise<MaterialItem[]> {
    const rows = await this.db
      .select()
      .from(videoAnalyses)
      .orderBy(desc(videoAnalyses.createdAt))
      .limit(100)
    return rows.map(dbToApi)
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(videoAnalyses)
      .where(eq(videoAnalyses.id, id))
      .returning({ id: videoAnalyses.id })
    if (deleted.length === 0) throw new NotFoundException('素材不存在')
  }

  async update(
    id: string,
    dto: UpdateMaterialDto,
    userId: string,
  ): Promise<MaterialItem> {
    const patch: Partial<typeof videoAnalyses.$inferInsert> = {}
    if (dto.categoryTags !== undefined) patch.categoryTags = dto.categoryTags
    if (dto.quality !== undefined) patch.quality = dto.quality
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段')
    }
    patch.updatedAt = new Date()
    patch.updatedBy = userId
    const updated = await this.db
      .update(videoAnalyses)
      .set(patch)
      .where(eq(videoAnalyses.id, id))
      .returning()
    if (updated.length === 0) throw new NotFoundException('素材不存在')
    return dbToApi(updated[0])
  }

  async create(dto: CreateMaterialDto, userId: string): Promise<MaterialItem> {
    const [row] = await this.db
      .insert(videoAnalyses)
      .values({
        type: dto.type,
        videoUrl: dto.videoUrl,
        videoName: dto.videoName ?? null,
        productModel: dto.productModel ?? null,
        totalDuration: dto.totalDuration ?? null,
        shotCount: dto.shotCount ?? null,
        industry: dto.industry ?? null,
        clientName: dto.clientName ?? null,
        department: dto.department ?? null,
        categoryTags: dto.categoryTags ?? [],
        quality: dto.quality ?? null,
        filePath: dto.filePath ?? null,
        updatedBy: userId,
      })
      .returning()
    if (!row) throw new BadRequestException('创建素材失败')
    this.logger.log(`Created material: ${row.id} (type=${row.type})`)
    return dbToApi(row)
  }

  async importMaterials(
    dto: ImportMaterialRequest,
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0
    let skipped = 0

    for (const material of dto.materials) {
      const existing = await this.db
        .select({ id: videoAnalyses.id })
        .from(videoAnalyses)
        .where(eq(videoAnalyses.videoName, material.videoName))

      if (existing.length > 0) {
        skipped++
        this.logger.log(`Skipping duplicate: ${material.videoName}`)
        continue
      }

        await this.db.transaction(async (tx) => {
        const [analysis] = await tx
          .insert(videoAnalyses)
          .values({
            type: material.type ?? 'product',
            videoUrl: material.videoUrl ?? '',
            videoName: material.videoName,
            productModel: material.productModel ?? null,
            totalDuration: material.totalDuration ?? null,
            shotCount: material.shotCount ?? null,
            industry: material.industry ?? null,
            clientName: material.clientName ?? null,
            department: material.department ?? null,
            categoryTags: material.categoryTags ?? [],
            quality: material.quality ?? null,
          })
          .returning()

        if (material.shots.length > 0) {
          await tx.insert(videoShots).values(
            material.shots.map((s: ImportShotDto) => ({
              analysisId: analysis.id,
              startTime: s.startTime,
              endTime: s.endTime,
              description: s.description ?? null,
              scene: s.scene ?? null,
              objects: s.objects ?? null,
              action: s.action ?? null,
              camera: s.camera ?? null,
              coreSellingPoint: s.coreSellingPoint ?? null,
              narrationText: s.narrationText ?? null,
            })),
          )
        }
      })

      imported++
      this.logger.log(`Imported: ${material.videoName}`)
    }

    this.logger.log(
      `Import complete: ${imported} imported, ${skipped} skipped`,
    )
    return { imported, skipped }
  }
}