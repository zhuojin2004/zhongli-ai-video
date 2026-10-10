import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ProductionService } from './production.service'
import { CreateProductionTaskDto, UpdateProductionTaskDto, ProductionTaskListQuery } from '@shared/api.interface'

@Controller('api/production/tasks')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Get()
  async list(@Query() query: ProductionTaskListQuery) {
    return this.productionService.list(query)
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateProductionTaskDto) {
    const { userId } = req.userContext
    return this.productionService.create(dto, userId)
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductionTaskDto, @Req() req: Request) {
    const { userId } = req.userContext
    return this.productionService.update(id, dto, userId)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.productionService.remove(id)
  }
}