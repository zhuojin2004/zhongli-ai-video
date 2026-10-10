import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core'
import { productionTasks } from '@server/database/schema'
import { eq, desc } from 'drizzle-orm'
import {
  ProductionTask,
  CreateProductionTaskDto,
  UpdateProductionTaskDto,
  ProductionTaskListQuery,
} from '@shared/api.interface'

const STATUS_MAP: Record<string, string> = {
  scripting: '待脚本',
  reviewing: '待审核',
  approved: '已审核',
  tagged: '已打标',
  edited: '已混剪',
  published: '已发布',
  iterating: '迭代中',
}

const STATUS_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_MAP).map(([k, v]) => [v, k])
)

function dbToApi(row: typeof productionTasks.$inferSelect): ProductionTask {
  return {
    id: row.id,
    productName: row.productName,
    script: row.scriptContent ?? '',
    status: (STATUS_MAP[row.status] ?? '待脚本') as ProductionTask['status'],
    assignee: row.assignee,
    assigneeAvatar: '',
    tags: [],
    videoUrl: row.videoUrl ?? '',
    keyframes: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name)

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(query: ProductionTaskListQuery): Promise<ProductionTask[]> {
    const conditions = []
    if (query.status) {
      const dbStatus = STATUS_REVERSE[query.status]
      if (dbStatus) {
        conditions.push(eq(productionTasks.status, dbStatus))
      }
    }
    const q = conditions.length > 0
      ? this.db.select().from(productionTasks).where(conditions[0]).limit(100).orderBy(desc(productionTasks.createdAt))
      : this.db.select().from(productionTasks).limit(100).orderBy(desc(productionTasks.createdAt))
    const rows = await q
    return rows.map(dbToApi)
  }

  async create(dto: CreateProductionTaskDto, userId: string): Promise<ProductionTask> {
    const inserted = await this.db.insert(productionTasks).values({
      title: dto.title,
      assignee: dto.assignee,
      assigneeType: dto.assigneeType,
      productName: dto.productName,
      status: 'reviewing',
    }).returning()
    const row = inserted[0]
    if (!row) throw new BadRequestException('创建任务失败')
    return dbToApi(row)
  }

  async update(id: string, dto: UpdateProductionTaskDto, userId: string): Promise<ProductionTask> {
    const patch: Partial<typeof productionTasks.$inferInsert> = {}
    if (dto.title !== undefined) patch.title = dto.title
    if (dto.scriptContent !== undefined) patch.scriptContent = dto.scriptContent
    if (dto.videoUrl !== undefined) patch.videoUrl = dto.videoUrl
    if (dto.publishAccount !== undefined) patch.publishAccount = dto.publishAccount
    if (dto.status !== undefined) {
      const dbStatus = STATUS_REVERSE[dto.status]
      if (dbStatus) patch.status = dbStatus
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段')
    patch.updatedAt = new Date()
    patch.updatedBy = userId
    const updated = await this.db.update(productionTasks)
      .set(patch)
      .where(eq(productionTasks.id, id))
      .returning()
    if (updated.length === 0) throw new NotFoundException('任务不存在')
    return dbToApi(updated[0])
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db.delete(productionTasks)
      .where(eq(productionTasks.id, id))
      .returning({ id: productionTasks.id })
    if (deleted.length === 0) throw new NotFoundException('任务不存在')
  }
}