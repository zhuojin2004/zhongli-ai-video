import { localAxios } from '@/utils/localAxios'

export interface ClipResponse {
  videoUrl: string
  duration: number
}

export interface ClipRequest {
  script: string
  videoUrls: string[]
  duration?: number
}

export async function clipVideo(dto: ClipRequest): Promise<ClipResponse> {
  const { data } = await localAxios({
    url: '/api/video-editing/clip',
    method: 'POST',
    data: dto,
  })
  return data
}