import { Module } from '@nestjs/common'
import { MiaodaConnectionsModule } from '@lark-apaas/miaoda-connections-sdk'
import { VideoEditingController } from './video-editing.controller'
import { VideoEditingService } from './video-editing.service'

@Module({
  imports: [MiaodaConnectionsModule.forRoot()],
  controllers: [VideoEditingController],
  providers: [VideoEditingService],
  exports: [VideoEditingService],
})
export class VideoEditingModule {}