import { Injectable, Inject } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core'
import { dashboardKpis, productionTasks, workflowRuns } from '@server/database/schema'
import { desc, and, gte, lt } from 'drizzle-orm'
import type {
  DashboardData,
  DashboardKpi,
  PipelineStage,
  RecentContent,
  DailyPublishStats,
  SalesTrendPoint,
  VideoKpi,
  VideoTrendPoint,
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

const STATUS_ORDER: string[] = [
  'scripting',
  'reviewing',
  'approved',
  'tagged',
  'edited',
  'published',
  'iterating',
]

function relativeTime(date: Date): string {
  const now: Date = new Date()
  const diffMs: number = now.getTime() - date.getTime()
  const diffMin: number = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHr: number = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}小时前`
  const diffDay: number = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}天前`
  const diffMon: number = Math.floor(diffDay / 30)
  return `${diffMon}个月前`
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name)

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getDashboard(): Promise<DashboardData> {
    // 1. Read latest dashboard_kpis row
    const kpiRows = await this.db
      .select()
      .from(dashboardKpis)
      .orderBy(desc(dashboardKpis.createdAt))
      .limit(1)

    const kpiRow = kpiRows[0]
    const kpis: DashboardKpi[] =
      (kpiRow?.kpiData as DashboardKpi[] | undefined) ?? []
    const salesTrend: SalesTrendPoint[] =
      (kpiRow?.salesTrend as SalesTrendPoint[] | undefined) ?? []
    const videoKpis: VideoKpi[] =
      (kpiRow?.videoKpis as VideoKpi[] | undefined) ?? []
    const videoTrend: VideoTrendPoint[] =
      (kpiRow?.videoTrend as VideoTrendPoint[] | undefined) ?? []

    // 2. Aggregate pipelineStages from productionTasks grouped by status
    const tasks = await this.db.select().from(productionTasks)

    const statusCounts: Record<string, number> = {}
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1
    }

    const pipelineStages: PipelineStage[] = STATUS_ORDER.map(
      (dbStatus: string) => ({
        id: dbStatus,
        name: STATUS_MAP[dbStatus] ?? dbStatus,
        count: statusCounts[dbStatus] ?? 0,
        status: 'normal' as const,
      }),
    )

    // 3. Get recentContents from workflowRuns (latest 5)
    const recentRuns = await this.db
      .select()
      .from(workflowRuns)
      .orderBy(desc(workflowRuns.createdAt))
      .limit(5)

    const recentContents: RecentContent[] = recentRuns.map(
      (run: typeof workflowRuns.$inferSelect) => ({
        id: run.id,
        accountName: run.employeeName,
        accountType: '内部员工',
        contentTitle: run.productName,
        publishTime: relativeTime(run.createdAt),
        views: 0,
        likes: 0,
        comments: 0,
      }),
    )

    // 4. Compute dailyPublish: count workflowRuns created today
    const today: Date = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow: Date = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todayRuns = await this.db
      .select()
      .from(workflowRuns)
      .where(
        and(
          gte(workflowRuns.createdAt, today),
          lt(workflowRuns.createdAt, tomorrow),
        ),
      )

    const totalRuns = await this.db.select().from(workflowRuns)

    const dailyPublish: DailyPublishStats = {
      totalInternal: totalRuns.length,
      todayInternal: todayRuns.length,
      totalDealer: 0,
      todayDealer: 0,
    }

    this.logger.log(
      `Dashboard loaded: ${kpis.length} KPIs, ${pipelineStages.length} stages, ${recentContents.length} recent contents`,
    )

    return {
      kpis,
      pipelineStages,
      recentContents,
      dailyPublish,
      salesTrend,
      videoKpis,
      videoTrend,
    }
  }
}