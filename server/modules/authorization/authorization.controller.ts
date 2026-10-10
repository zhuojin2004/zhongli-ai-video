import { Controller, Get, Post, Patch, Body, Param, Req } from '@nestjs/common'
import type { Request } from 'express'
import { AuthorizationService } from './authorization.service'
import {
  CreateAuthorizationDto,
  UpdateAuthorizationDto,
} from '@shared/api.interface'

@Controller('api/authorization')
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @Get()
  async list() {
    return this.authorizationService.list()
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateAuthorizationDto) {
    const { userId } = req.userContext
    return this.authorizationService.create(dto, userId)
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAuthorizationDto,
    @Req() req: Request,
  ) {
    const { userId } = req.userContext
    return this.authorizationService.update(id, dto, userId)
  }
}