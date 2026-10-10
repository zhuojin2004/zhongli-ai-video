import { localAxios } from '@/utils/localAxios'
import type { VideoShot, CreateVideoShotDto, UpdateVideoShotDto } from '@shared/api.interface'

export function listShots(analysisId: string): Promise<{ data: VideoShot[] }> {
  return localAxios.get('/api/video/shots', { params: { analysisId } })
}

export function createShot(dto: CreateVideoShotDto): Promise<{ data: VideoShot }> {
  return localAxios.post('/api/video/shots', dto)
}

export function updateShot(id: string, dto: UpdateVideoShotDto): Promise<{ data: VideoShot }> {
  return localAxios.patch(`/api/video/shots/${id}`, dto)
}

export function deleteShot(id: string): Promise<{ data: void }> {
  return localAxios.delete(`/api/video/shots/${id}`)
}