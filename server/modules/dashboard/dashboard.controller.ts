import { Controller, Get } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import type { DashboardData } from '@shared/api.interface'

@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async getDashboard(): Promise<DashboardData> {
    return this.dashboardService.getDashboard()
  }
}