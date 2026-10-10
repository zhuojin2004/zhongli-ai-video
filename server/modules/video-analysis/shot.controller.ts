import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
} from '@nestjs/common'
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core'
import { ShotService } from './shot.service'
import type { Request } from 'express'
import type { VideoShot, CreateVideoShotDto, UpdateVideoShotDto } from '@shared/api.interface'

@Controller('api/video/shots')
export class ShotController {
  constructor(private readonly service: ShotService) {}

  @Get()
  async list(@Query('analysisId') analysisId: string): Promise<VideoShot[]> {
    return this.service.listByAnalysis(analysisId)
  }

  @NeedLogin()
  @Post()
  async create(
    @Req() req: Request,
    @Body() dto: CreateVideoShotDto,
  ): Promise<VideoShot> {
    const { userId } = req.userContext as { userId: string }
    return this.service.create(dto, userId)
  }

  @NeedLogin()
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateVideoShotDto,
  ): Promise<VideoShot> {
    const { userId } = req.userContext as { userId: string }
    return this.service.update(id, dto, userId)
  }

  @NeedLogin()
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.service.remove(id)
    return { success: true }
  }
}