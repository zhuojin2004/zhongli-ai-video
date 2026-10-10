import { Injectable, Inject } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core'
import { iterationItems } from '@server/database/schema'
import { asc } from 'drizzle-orm'
import type { IterationData } from '@shared/api.interface'

type IterationItemRow = typeof iterationItems.$inferSelect

@Injectable()
export class IterationService {
  private readonly logger = new Logger(IterationService.name)

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getAll(): Promise<IterationData> {
    const rows: IterationItemRow[] = await this.db
      .select()
      .from(iterationItems)
      .orderBy(asc(iterationItems.createdAt))

    const hotTags: IterationData['hotTags'] = []
    const competitors: IterationData['competitors'] = []
    const dealerCases: IterationData['dealerCases'] = []
    const suggestions: IterationData['suggestions'] = []

    for (const row of rows) {
      const meta = row.meta as Record<string, unknown> | null

      switch (row.type) {
        case 'hot_tag': {
          hotTags.push({
            id: row.id,
            name: row.title,
            count: (meta?.count as number) ?? 0,
          })
          break
        }
        case 'competitor': {
          competitors.push({
            id: row.id,
            title: row.title,
            competitorName: (meta?.competitorName as string) ?? '',
            views: (meta?.views as number) ?? 0,
            likes: (meta?.likes as number) ?? 0,
            takeaway: row.description ?? '',
            videoUrl: (meta?.videoUrl as string) ?? '',
          })
          break
        }
        case 'dealer_case': {
          dealerCases.push({
            id: row.id,
            dealerName: (meta?.dealerName as string) ?? '',
            region: (meta?.region as string) ?? '',
            title: row.title,
            views: (meta?.views as number) ?? 0,
            likes: (meta?.likes as number) ?? 0,
            shares: (meta?.shares as number) ?? 0,
            reusablePattern: row.description ?? '',
            videoUrl: (meta?.videoUrl as string) ?? '',
          })
          break
        }
        case 'suggestion': {
          suggestions.push({
            id: row.id,
            title: row.title,
            description: row.description ?? '',
            priority: (row.priority as IterationData['suggestions'][number]['priority']) ?? 'medium',
            source: (row.source as IterationData['suggestions'][number]['source']) ?? 'ai',
            relatedTag: row.relatedTag ?? '',
          })
          break
        }
        default:
          this.logger.log(`Unknown iteration item type: ${row.type}`)
      }
    }

    return { hotTags, competitors, dealerCases, suggestions }
  }
}