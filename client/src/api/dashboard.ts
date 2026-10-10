import { localAxios } from '@/utils/localAxios'
import type { DashboardData } from '@shared/api.interface'

export async function getDashboard(): Promise<{ data: DashboardData }> {
  return localAxios({ url: '/api/dashboard', method: 'GET' })
}