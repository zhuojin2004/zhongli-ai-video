import { Controller, Post, Get, Delete, Param, Body } from '@nestjs/common'
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core'
import { VideoAnalysisService } from './video-analysis.service'
import type {
  AnalyzeVideoRequest,
  AnalyzeVideoResponse,
  VideoAnalysisRecord,
  BatchAnalyzeRequest,
  BatchAnalyzeResponse,
} from '@shared/api.interface'

@Controller('api/video')
export class VideoAnalysisController {
  constructor(private readonly service: VideoAnalysisService) {}

  @Get()
  async list(): Promise<VideoAnalysisRecord[]> {
    return this.service.list()
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<AnalyzeVideoResponse> {
    return this.service.detail(id)
  }

  @NeedLogin()
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.service.remove(id)
  }

  @Post('analyze')
  async analyze(
    @Body() dto: AnalyzeVideoRequest,
  ): Promise<AnalyzeVideoResponse> {
    return this.service.analyze(dto)
  }

  @Post('analyze/batch')
  async analyzeBatch(
    @Body() dto: BatchAnalyzeRequest,
  ): Promise<BatchAnalyzeResponse> {
    return this.service.analyzeBatch(dto)
  }
}