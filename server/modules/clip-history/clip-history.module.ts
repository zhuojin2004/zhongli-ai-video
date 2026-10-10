import { Module } from '@nestjs/common'
import { ClipHistoryController } from './clip-history.controller'
import { ClipHistoryService } from './clip-history.service'

@Module({
  controllers: [ClipHistoryController],
  providers: [ClipHistoryService],
  exports: [ClipHistoryService],
})
export class ClipHistoryModule {}