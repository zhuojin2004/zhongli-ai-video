import {
  Controller,
  Get,
  Delete,
  Patch,
  Post,
  Param,
  Body,
  Req,
} from '@nestjs/common'
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core'
import type { Request } from 'express'
import { MaterialsService } from './materials.service'
import type {
  MaterialItem,
  UpdateMaterialDto,
  ImportMaterialRequest,
  CreateMaterialDto,
} from '@shared/api.interface'

@Controller('api/materials')
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  async list(): Promise<MaterialItem[]> {
    return this.service.list()
  }

  @NeedLogin()
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.service.remove(id)
  }

  @NeedLogin()
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMaterialDto,
    @Req() req: Request,
  ): Promise<MaterialItem> {
    const { userId } = req.userContext
    return this.service.update(id, dto, userId)
  }

  @NeedLogin()
  @Post()
  async create(
    @Body() dto: CreateMaterialDto,
    @Req() req: Request,
  ): Promise<MaterialItem> {
    const { userId } = req.userContext
    return this.service.create(dto, userId)
  }

  @NeedLogin()
  @Post('import')
  async importMaterials(
    @Body() dto: ImportMaterialRequest,
  ): Promise<{ imported: number; skipped: number }> {
    return this.service.importMaterials(dto)
  }
}