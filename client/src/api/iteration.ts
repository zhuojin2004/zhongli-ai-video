import { localAxios } from '@/utils/localAxios'
import type { IterationData } from '@shared/api.interface'

export async function getIterationData(): Promise<{ data: IterationData }> {
  return localAxios({ url: '/api/iteration', method: 'GET' })
}