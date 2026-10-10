import { Module } from '@nestjs/common'
import { VideoAnalysisController } from './video-analysis.controller'
import { VideoAnalysisService } from './video-analysis.service'
import { ShotController } from './shot.controller'
import { ShotService } from './shot.service'

@Module({
  controllers: [ShotController, VideoAnalysisController],
  providers: [VideoAnalysisService, ShotService],
})
export class VideoAnalysisModule {}