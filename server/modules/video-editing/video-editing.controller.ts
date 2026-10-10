import { Controller, Post, Body } from '@nestjs/common'
import { VideoEditingService } from './video-editing.service'
import type {
  MatchShotsRequest,
  MatchShotsResponse,
  ShotClipItem,
  ClipShotRequest,
} from '@shared/api.interface'

interface ClipRequestBody {
  script: string
  videoUrls: string[]
  duration?: number
  shots?: ShotClipItem[]
}

@Controller('api/video-editing')
export class VideoEditingController {
  constructor(private readonly videoEditingService: VideoEditingService) {}

  @Post('clip')
  async clip(@Body() body: ClipRequestBody) {
    return this.videoEditingService.clipVideos(body)
  }

  @Post('clip-shots')
  async clipShots(@Body() body: ClipShotRequest) {
    return this.videoEditingService.clipWithFfmpeg(body.shots)
  }

  @Post('match-shots')
  async matchShots(
    @Body() dto: MatchShotsRequest,
  ): Promise<MatchShotsResponse> {
    return this.videoEditingService.matchShots(dto)
  }
}