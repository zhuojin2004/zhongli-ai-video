import { Controller, Get } from '@nestjs/common'
import { IterationService } from './iteration.service'
import type { IterationData } from '@shared/api.interface'

@Controller('api/iteration')
export class IterationController {
  constructor(private readonly iterationService: IterationService) {}

  @Get()
  async getAll(): Promise<IterationData> {
    return this.iterationService.getAll()
  }
}