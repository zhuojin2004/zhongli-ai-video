import { localAxios } from '@/utils/localAxios'
import type { WorkflowRun, CreateWorkflowRunDto, UpdateWorkflowRunDto } from '@shared/api.interface'

export async function listRuns(): Promise<WorkflowRun[]> {
  const res = await localAxios({ url: '/api/workflow/runs', method: 'GET' })
  return res.data
}

export async function getRun(id: string): Promise<WorkflowRun> {
  const res = await localAxios({ url: `/api/workflow/runs/${id}`, method: 'GET' })
  return res.data
}

export async function createRun(dto: CreateWorkflowRunDto): Promise<WorkflowRun> {
  const res = await localAxios({ url: '/api/workflow/runs', method: 'POST', data: dto })
  return res.data
}

export async function updateRun(id: string, dto: UpdateWorkflowRunDto): Promise<{ data: WorkflowRun }> {
  return localAxios.patch(`/api/workflow/runs/${id}`, dto)
}

export async function deleteRun(id: string): Promise<void> {
  await localAxios({ url: `/api/workflow/runs/${id}`, method: 'DELETE' })
}