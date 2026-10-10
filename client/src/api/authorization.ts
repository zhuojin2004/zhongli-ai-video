import { localAxios } from '@/utils/localAxios'
import type { AuthorizationRecord, CreateAuthorizationDto, UpdateAuthorizationDto } from '@shared/api.interface'

export async function listAuthorizations(): Promise<{ data: AuthorizationRecord[] }> {
  return localAxios({ url: '/api/authorization', method: 'GET' })
}

export async function createAuthorization(dto: CreateAuthorizationDto): Promise<{ data: AuthorizationRecord }> {
  return localAxios({ url: '/api/authorization', method: 'POST', data: dto })
}

export async function updateAuthorization(id: string, dto: UpdateAuthorizationDto): Promise<{ data: AuthorizationRecord }> {
  return localAxios({ url: `/api/authorization/${id}`, method: 'PATCH', data: dto })
}