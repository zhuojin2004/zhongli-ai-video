import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common'
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core'
import { ClipHistoryService } from './clip-history.service'
import type {
  ClipHistoryItem,
  CreateClipHistoryDto,
} from '@shared/api.interface'

@Controller('api/clip-history')
export class ClipHistoryController {
  constructor(
    private readonly clipHistoryService: ClipHistoryService,
  ) {}

  @Get()
  async list(
    @Query('category') category?: string,
  ): Promise<ClipHistoryItem[]> {
    return this.clipHistoryService.list({ category })
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<ClipHistoryItem> {
    return this.clipHistoryService.detail(id)
  }

  @NeedLogin()
  @Post()
  async create(
    @Req() req: any,
    @Body() dto: CreateClipHistoryDto,
  ): Promise<ClipHistoryItem> {
    const { userId } = req.userContext
    return this.clipHistoryService.create(dto, userId)
  }

  @NeedLogin()
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.clipHistoryService.remove(id)
  }
}