import { localAxios, analyzeAxios } from '@/utils/localAxios'
import type { AnalyzeVideoRequest, AnalyzeVideoResponse, VideoAnalysisRecord } from '@shared/api.interface'

// AI 分析链路耗时 60-180s，用专用实例（10 分钟 timeout）
export function analyzeVideo(
  dto: AnalyzeVideoRequest,
): Promise<{ data: AnalyzeVideoResponse }> {
  return analyzeAxios.post('/api/video/analyze', dto)
}

// 批量分析同样耗时较长，走 analyzeAxios
export function analyzeVideoBatch(
  downloadUrls: string[],
): Promise<{
  data: { results: { downloadUrl: string; success: boolean; result?: AnalyzeVideoResponse; error?: string }[] }
}> {
  return analyzeAxios.post('/api/video/analyze/batch', { downloadUrls })
}

export function listAnalyses(): Promise<{ data: VideoAnalysisRecord[] }> {
  return localAxios.get('/api/video')
}

export function getAnalysis(id: string): Promise<{ data: AnalyzeVideoResponse }> {
  return localAxios.get(`/api/video/${id}`)
}

export function deleteAnalysis(id: string): Promise<{ data: void }> {
  return localAxios.delete(`/api/video/${id}`)
}