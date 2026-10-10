import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core'
import { workflowRuns } from '@server/database/schema'
import { eq, desc } from 'drizzle-orm'
import { WorkflowRun, CreateWorkflowRunDto, UpdateWorkflowRunDto } from '@shared/api.interface'

function dbToApi(row: typeof workflowRuns.$inferSelect): WorkflowRun {
  return {
    id: row.id,
    productName: row.productName,
    productDescription: row.productDescription,
    employeeName: row.employeeName,
    employeeId: row.employeeId,
    scriptContent: row.scriptContent ?? '',
    keyframeUrls: (row.keyframeUrls as string[]) ?? [],
    audioUrl: row.audioUrl ?? '',
    videoUrl: row.videoUrl ?? '',
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name)

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(): Promise<WorkflowRun[]> {
    const rows = await this.db.select().from(workflowRuns).orderBy(desc(workflowRuns.createdAt)).limit(100)
    return rows.map(dbToApi)
  }

  async detail(id: string): Promise<WorkflowRun> {
    const rows = await this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id))
    if (rows.length === 0) throw new NotFoundException('记录不存在')
    return dbToApi(rows[0])
  }

  async create(dto: CreateWorkflowRunDto, userId: string): Promise<WorkflowRun> {
    const inserted = await this.db.insert(workflowRuns).values({
      productName: dto.productName,
      productDescription: dto.productDescription,
      employeeName: dto.employeeName,
      employeeId: dto.employeeId,
      scriptContent: dto.scriptContent,
      keyframeUrls: dto.keyframeUrls as unknown as Record<string, unknown>,
      audioUrl: dto.audioUrl,
      videoUrl: dto.videoUrl,
      status: dto.status,
    }).returning()
    if (inserted.length === 0) throw new BadRequestException('创建记录失败')
    return dbToApi(inserted[0])
  }

  async update(id: string, dto: UpdateWorkflowRunDto, userId: string): Promise<WorkflowRun> {
    const patch: Partial<typeof workflowRuns.$inferInsert> = {}

    if (dto.scriptContent !== undefined) patch.scriptContent = dto.scriptContent
    if (dto.videoUrl !== undefined) patch.videoUrl = dto.videoUrl
    if (dto.status !== undefined) patch.status = dto.status
    if (dto.keyframeUrls !== undefined) {
      patch.keyframeUrls = dto.keyframeUrls as unknown as Record<string, unknown>
    }
    if (dto.audioUrl !== undefined) patch.audioUrl = dto.audioUrl

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段')
    }

    patch.updatedAt = new Date()
    patch.updatedBy = userId

    const updated = await this.db.update(workflowRuns)
      .set(patch)
      .where(eq(workflowRuns.id, id))
      .returning({ id: workflowRuns.id })

    if (updated.length === 0) throw new NotFoundException('记录不存在')

    return this.detail(id)
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db.delete(workflowRuns)
      .where(eq(workflowRuns.id, id))
      .returning({ id: workflowRuns.id })
    if (deleted.length === 0) throw new NotFoundException('记录不存在')
  }
}