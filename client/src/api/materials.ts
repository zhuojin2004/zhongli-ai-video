import { localAxios } from '@/utils/localAxios'
import type { MaterialItem, UpdateMaterialDto, ImportMaterialRequest, CreateMaterialDto } from '@shared/api.interface'

export async function listMaterials(): Promise<{ data: MaterialItem[] }> {
  return localAxios({ url: '/api/materials', method: 'GET' })
}

/** 直接从 PGlite 数据库读取素材（持久化数据，重启 mock 也不丢） */
export async function listMaterialsFromDb(): Promise<{ data: MaterialItem[] }> {
  return localAxios({ url: '/api/materials/from-db', method: 'GET' })
}

/** 触发：从飞书多维表格拉取字段，匹配本地素材后写入 DB */
export async function syncMaterialsFromFeishu(): Promise<{
  data: { matched: number; created: number; updated: number; totalFeishuRecords: number; uniqueVideos: number }
}> {
  return localAxios.post('/api/materials/sync-feishu')
}

/* ── 双素材库导航 API ────────────────────────────────────────────────────── */

export interface ProductGroup {
  productModel: string
  videoCount: number
  latestAt: string
  sampleFileName: string
  sampleUrl: string
  /** 该产品第一个视频的封面（第一帧关键帧） */
  sampleCoverUrl?: string
}

export interface EmployeeGroup {
  personName: string
  videoCount: number
  latestAt: string
  sampleFileName: string
  sampleUrl: string
}

export async function listProductGroups(): Promise<{ data: ProductGroup[] }> {
  return localAxios({ url: '/api/library/products', method: 'GET' })
}

export async function listEmployeeGroups(): Promise<{ data: EmployeeGroup[] }> {
  return localAxios({ url: '/api/library/employees', method: 'GET' })
}

export interface ProductVideosResp {
  productModel: string
  videos: MaterialItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface EmployeeVideosResp {
  personName: string
  videos: MaterialItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function listVideosByProductModel(
  productModel: string,
  opts?: { page?: number; pageSize?: number },
): Promise<{ data: ProductVideosResp }> {
  const page = Math.max(1, opts?.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 12))
  return localAxios({
    url: `/api/library/product/${encodeURIComponent(productModel)}?page=${page}&pageSize=${pageSize}`,
    method: 'GET',
  })
}

export async function listVideosByEmployeeName(
  personName: string,
  opts?: { page?: number; pageSize?: number },
): Promise<{ data: EmployeeVideosResp }> {
  const page = Math.max(1, opts?.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 12))
  return localAxios({
    url: `/api/library/employee/${encodeURIComponent(personName)}?page=${page}&pageSize=${pageSize}`,
    method: 'GET',
  })
}

export async function getVideoDetail(materialId: string): Promise<{ data: MaterialItem }> {
  return localAxios({ url: `/api/library/video/${materialId}`, method: 'GET' })
}

/** 删除素材（DB + OSS + 飞书同步删除） */
export async function deleteVideoFromLibrary(
  materialId: string,
): Promise<{ data: { ok: boolean; db: any; oss: any; feishu: any } }> {
  return localAxios({ url: `/api/library/video/${materialId}`, method: 'DELETE' })
}

/** 改名：产品型号 / 人物姓名（同步更新飞书主表） */
export async function updateVideoInLibrary(
  materialId: string,
  dto: { productName?: string; personName?: string | null },
): Promise<{ data: { ok: boolean; materialId: string; updates: any; material: MaterialItem } }> {
  return localAxios({ url: `/api/library/video/${materialId}`, method: 'PATCH', data: dto })
}

/**
 * 修改分镜内容（同步飞书分镜表 + 本地 DB 缓存）
 * @param shotId   飞书分镜 record_id（即 VideoShot.shotId）
 * @param dto      { description?, scene?, objects?, action?, camera?, coreSellingPoint?, startTime?, endTime? }
 */
export async function updateShotInLibrary(
  shotId: string,
  dto: {
    description?: string
    scene?: string
    objects?: string
    action?: string
    camera?: string
    coreSellingPoint?: string
    startTime?: number
    endTime?: number
  },
): Promise<{
  data: {
    ok: boolean
    shotId: string
    updates: Record<string, unknown>
    feishuUpdated: boolean
    dbUpdated: boolean
    feishuError: string | null
  }
}> {
  return localAxios({ url: `/api/library/shot/${shotId}`, method: 'PATCH', data: dto })
}

/**
 * 彻底删除一个分镜（同步删除飞书分镜表行 + 本地 DB 行）
 * ⚠️ 破坏性操作：分镜行在飞书分镜表里消失
 *   主表「反向关联分镜」字段会自动剔除该 record_id（飞书侧双向关联自动维护）
 * @param shotId 飞书分镜 record_id（即 VideoShot.shotId）
 */
export async function deleteShotFromLibrary(
  shotId: string,
): Promise<{
  data: {
    ok: boolean
    shotId: string
    feishuDeleted: boolean
    dbDeleted: boolean
    feishuError: string | null
  }
}> {
  return localAxios({ url: `/api/library/shot/${shotId}`, method: 'DELETE' })
}

/** 跨产品/员工的关键词搜索 */
export async function searchMaterialsInLibrary(
  query: string,
  limit = 50,
): Promise<{ data: { query: string; total: number; items: MaterialItem[] } }> {
  return localAxios({
    url: `/api/library/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    method: 'GET',
  })
}

export async function createMaterial(dto: CreateMaterialDto): Promise<{ data: MaterialItem }> {
  return localAxios({ url: '/api/materials', method: 'POST', data: dto })
}

export async function deleteMaterial(id: string): Promise<{ data: void }> {
  return localAxios({ url: `/api/materials/${id}`, method: 'DELETE' })
}

export async function updateMaterial(id: string, dto: UpdateMaterialDto): Promise<{ data: MaterialItem }> {
  return localAxios({ url: `/api/materials/${id}`, method: 'PATCH', data: dto })
}

export async function importMaterials(
  dto: ImportMaterialRequest,
): Promise<{ data: { count: number } }> {
  return localAxios.post('/api/materials/import', dto)
}