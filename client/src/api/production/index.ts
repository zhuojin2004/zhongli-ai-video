import { localAxios } from '@/utils/localAxios'
import type { ProductionTask, CreateProductionTaskDto, UpdateProductionTaskDto, ProductionTaskListQuery } from '@shared/api.interface'

export async function listTasks(query?: ProductionTaskListQuery): Promise<ProductionTask[]> {
  const res = await localAxios({ url: '/api/production/tasks', method: 'GET', params: query })
  return res.data
}

export async function createTask(dto: CreateProductionTaskDto): Promise<ProductionTask> {
  const res = await localAxios({ url: '/api/production/tasks', method: 'POST', data: dto })
  return res.data
}

export async function updateTask(id: string, dto: UpdateProductionTaskDto): Promise<ProductionTask> {
  const res = await localAxios({ url: `/api/production/tasks/${id}`, method: 'PATCH', data: dto })
  return res.data
}

export async function deleteTask(id: string): Promise<void> {
  await localAxios({ url: `/api/production/tasks/${id}`, method: 'DELETE' })
}