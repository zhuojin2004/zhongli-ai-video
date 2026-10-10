import { localAxios } from '@/utils/localAxios'
import type {
  ClipHistoryItem,
  CreateClipHistoryDto,
  ClipHistoryListQuery,
} from '@shared/api.interface'

export function listClipHistory(
  query?: ClipHistoryListQuery,
): Promise<{ data: ClipHistoryItem[] }> {
  return localAxios({ url: '/api/clip-history', method: 'GET', params: query })
}

export function createClipHistory(
  dto: CreateClipHistoryDto,
): Promise<{ data: ClipHistoryItem }> {
  return localAxios.post('/api/clip-history', dto)
}

export function deleteClipHistory(id: string): Promise<{ data: void }> {
  return localAxios.delete(`/api/clip-history/${id}`)
}