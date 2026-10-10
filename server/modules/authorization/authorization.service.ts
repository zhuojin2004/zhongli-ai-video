import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core'
import { authorizations } from '@server/database/schema'
import { eq, desc } from 'drizzle-orm'
import {
  AuthorizationRecord,
  CreateAuthorizationDto,
  UpdateAuthorizationDto,
} from '@shared/api.interface'

function dbToApi(row: typeof authorizations.$inferSelect): AuthorizationRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type as 'employee' | 'dealer',
    status: row.status as 'authorized' | 'pending' | 'expired',
    method: row.method as 'free' | 'paid',
    amount: row.amount,
    authorizedDate: row.authorizedDate ?? '',
    expiryDate: row.expiryDate ?? '',
    contact: row.contact ?? '',
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name)

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(): Promise<AuthorizationRecord[]> {
    const rows = await this.db
      .select()
      .from(authorizations)
      .orderBy(desc(authorizations.createdAt))
    return rows.map(dbToApi)
  }

  async create(
    dto: CreateAuthorizationDto,
    userId: string,
  ): Promise<AuthorizationRecord> {
    const inserted = await this.db
      .insert(authorizations)
      .values({
        name: dto.name,
        type: dto.type,
        method: dto.method,
        amount: dto.amount,
        contact: dto.contact,
        status: 'pending',
        authorizedDate: '',
        expiryDate: '',
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new BadRequestException('创建授权记录失败')
    return dbToApi(row)
  }

  async update(
    id: string,
    dto: UpdateAuthorizationDto,
    userId: string,
  ): Promise<AuthorizationRecord> {
    const patch: Partial<typeof authorizations.$inferInsert> = {}
    if (dto.status !== undefined) patch.status = dto.status
    if (dto.amount !== undefined) patch.amount = dto.amount
    if (dto.authorizedDate !== undefined) patch.authorizedDate = dto.authorizedDate
    if (dto.expiryDate !== undefined) patch.expiryDate = dto.expiryDate
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段')
    }
    patch.updatedAt = new Date()
    patch.updatedBy = userId
    const updated = await this.db
      .update(authorizations)
      .set(patch)
      .where(eq(authorizations.id, id))
      .returning()
    if (updated.length === 0) throw new NotFoundException('授权记录不存在')
    return dbToApi(updated[0])
  }
}