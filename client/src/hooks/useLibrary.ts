import { useQuery } from '@tanstack/react-query'
import {
  listProductGroups,
  listEmployeeGroups,
  listVideosByProductModel,
  listVideosByEmployeeName,
  getVideoDetail,
} from '@/api/materials'

/** 统一的查询键，便于变更后精准失效缓存 */
export const libraryKeys = {
  all: ['library'] as const,
  productGroups: ['library', 'productGroups'] as const,
  employeeGroups: ['library', 'employeeGroups'] as const,
  productVideos: (model: string, page: number, pageSize: number) =>
    ['library', 'product', model, page, pageSize] as const,
  employeeVideos: (name: string, page: number, pageSize: number) =>
    ['library', 'employee', name, page, pageSize] as const,
  videoDetail: (id: string) => ['library', 'video', id] as const,
}

export function useProductGroups() {
  return useQuery({
    queryKey: libraryKeys.productGroups,
    queryFn: async () => (await listProductGroups()).data,
  })
}

export function useEmployeeGroups() {
  return useQuery({
    queryKey: libraryKeys.employeeGroups,
    queryFn: async () => (await listEmployeeGroups()).data,
  })
}

export function useProductVideos(model: string, page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: libraryKeys.productVideos(model, page, pageSize),
    queryFn: async () => (await listVideosByProductModel(model, { page, pageSize })).data,
    enabled: enabled && !!model,
    // 切页/切分组时保留上一页数据，避免整屏骨架闪烁
    placeholderData: (prev) => prev,
  })
}

export function useEmployeeVideos(name: string, page: number, pageSize: number, enabled = true) {
  return useQuery({
    queryKey: libraryKeys.employeeVideos(name, page, pageSize),
    queryFn: async () => (await listVideosByEmployeeName(name, { page, pageSize })).data,
    enabled: enabled && !!name,
    placeholderData: (prev) => prev,
  })
}

export function useVideoDetail(id: string) {
  return useQuery({
    queryKey: libraryKeys.videoDetail(id),
    queryFn: async () => (await getVideoDetail(id)).data,
    enabled: !!id,
  })
}
