import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common'
import type { Request } from 'express'
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core'
import { WorkflowService } from './workflow.service'
import { CreateWorkflowRunDto, UpdateWorkflowRunDto } from '@shared/api.interface'

@Controller('api/workflow/runs')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get()
  async list() {
    return this.workflowService.list()
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.workflowService.detail(id)
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateWorkflowRunDto) {
    const { userId } = req.userContext
    return this.workflowService.create(dto, userId)
  }

  @NeedLogin()
  @Patch(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateWorkflowRunDto) {
    const { userId } = req.userContext
    return this.workflowService.update(id, dto, userId)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.workflowService.remove(id)
  }
}