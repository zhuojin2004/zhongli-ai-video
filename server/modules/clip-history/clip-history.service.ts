import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core'
import { clipHistory } from '@server/database/schema'
import { eq, desc } from 'drizzle-orm'
import type {
  ClipHistoryItem,
  CreateClipHistoryDto,
  ClipHistoryListQuery,
} from '@shared/api.interface'

@Injectable()
export class ClipHistoryService {
  private readonly logger = new Logger(ClipHistoryService.name)

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async list(query: ClipHistoryListQuery): Promise<ClipHistoryItem[]> {
    this.logger.log(
      `Listing clip history, category: ${query.category ?? 'all'}`,
    )

    const dbQuery = query.category
      ? this.db
          .select()
          .from(clipHistory)
          .where(eq(clipHistory.category, query.category))
          .orderBy(desc(clipHistory.createdAt))
      : this.db
          .select()
          .from(clipHistory)
          .orderBy(desc(clipHistory.createdAt))

    const rows = await dbQuery
    return rows.map((row) => this.dbToApi(row))
  }

  async detail(id: string): Promise<ClipHistoryItem> {
    const rows = await this.db
      .select()
      .from(clipHistory)
      .where(eq(clipHistory.id, id))

    if (rows.length === 0) {
      throw new NotFoundException('剪辑记录不存在')
    }

    return this.dbToApi(rows[0])
  }

  async create(
    dto: CreateClipHistoryDto,
    userId: string,
  ): Promise<ClipHistoryItem> {
    this.logger.log(`Creating clip history: ${dto.title}`)

    const [row] = await this.db
      .insert(clipHistory)
      .values({
        title: dto.title,
        requirement: dto.requirement,
        duration: dto.duration,
        scriptContent: dto.scriptContent,
        videoUrl: dto.videoUrl,
        shotIds: dto.shotIds,
        category: dto.category,
        employeeName: dto.employeeName,
        employeeId: dto.employeeId,
        status: 'completed',
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    return this.dbToApi(row)
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(clipHistory)
      .where(eq(clipHistory.id, id))
      .returning({ id: clipHistory.id })

    if (deleted.length === 0) {
      throw new NotFoundException('剪辑记录不存在')
    }
  }

  private dbToApi(
    row: typeof clipHistory.$inferSelect,
  ): ClipHistoryItem {
    return {
      id: row.id,
      title: row.title,
      requirement: row.requirement ?? '',
      duration: row.duration ?? 0,
      scriptContent: row.scriptContent ?? '',
      videoUrl: row.videoUrl ?? '',
      shotIds: (row.shotIds as string[]) ?? [],
      category: row.category ?? '',
      status: row.status,
      employeeName: row.employeeName ?? undefined,
      employeeId: row.employeeId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}