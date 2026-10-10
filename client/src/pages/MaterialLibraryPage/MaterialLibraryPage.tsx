import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useRole } from '@/contexts/RoleContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { ArrowUpDown, Loader2, Search, Upload } from 'lucide-react'
import {
  useProductGroups,
  useEmployeeGroups,
  useProductVideos,
  useEmployeeVideos,
  useVideoDetail,
  libraryKeys,
} from '@/hooks/useLibrary'
import type { ProductGroup, EmployeeGroup } from '@/api/materials'
import type { MaterialItem } from '@shared/api.interface'
import { ProductGroupGridSection, EmployeeGroupGridSection } from './sections/GroupGridSection'
import VideosGridSection from './sections/VideosGridSection'
import VideoShotDetailDialog from './sections/VideoShotDetailDialog'

type Tab = 'product' | 'employee'
type SortBy = 'videoCount' | 'latestAt'

/** 1,2,3 … 10, 1…9,10,11… 100 —— 简单截断的分页号生成 */
function buildPageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '…')[] = []
  const add = (n: number | '…') => out.push(n)
  add(1)
  if (current > 4) add('…')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) add(i)
  if (current < total - 3) add('…')
  add(total)
  return out
}

export default function MaterialLibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role } = useRole()
  const { user } = useAuth()
  const isManager = role === 'operator' || role === 'admin'

  // 业务员视角：以"我"为中心，URL 默认跳转到自己姓名下的视频列表
  const isSalesperson = role === 'user'
  const myName = user?.name || ''

  // URL state
  const tab = (searchParams.get('tab') as Tab) || (isSalesperson ? 'employee' : 'product')
  const model = searchParams.get('model') || ''
  const name = searchParams.get('name') || ''
  const videoId = searchParams.get('video') || ''

  const isProductDetail = tab === 'product' && !!model
  const isEmployeeDetail = tab === 'employee' && !!name

  // 业务员首次进入 / 刷新页面：自动跳到自己姓名下的视频（不是分组列表）
  useEffect(() => {
    if (isSalesperson && myName && !isEmployeeDetail && !isProductDetail && !videoId) {
      setSearchParams({ tab: 'employee', name: myName }, { replace: true })
    }
  }, [isSalesperson, myName, isEmployeeDetail, isProductDetail, videoId, setSearchParams])

  // Search + sort (顶层生效)
  const [keyword, setKeyword] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('videoCount')

  // ── React Query：分组 / 明细分页 / 详情 ─────────────────────────────────
  const productGroupsQ = useProductGroups()
  const employeeGroupsQ = useEmployeeGroups()

  // 分组页分页状态
  const [groupsPage, setGroupsPage] = useState(1)
  const [groupsPageSize] = useState(12)

  // 明细分页（服务端分页）
  const [videosPage, setVideosPage] = useState(1)
  const [videosPageSize] = useState(12)
  const realProductVideosQ = useProductVideos(model, videosPage, videosPageSize, isProductDetail)
  const realEmployeeVideosQ = useEmployeeVideos(name, videosPage, videosPageSize, isEmployeeDetail)

  // 详情
  const detailQ = useVideoDetail(videoId)

  const productGroups: ProductGroup[] = productGroupsQ.data || []
  const employeeGroups: EmployeeGroup[] = employeeGroupsQ.data || []
  const loadingGroups = tab === 'product' ? productGroupsQ.isPending : employeeGroupsQ.isPending

  // 明细数据（按当前 tab 取对应 hook）
  let groupVideos: MaterialItem[] = []
  let videosTotal = 0
  let videosTotalPages = 1
  if (isProductDetail && realProductVideosQ.data) {
    groupVideos = realProductVideosQ.data.videos || []
    videosTotal = realProductVideosQ.data.total || 0
    videosTotalPages = realProductVideosQ.data.totalPages || 1
  } else if (isEmployeeDetail && realEmployeeVideosQ.data) {
    groupVideos = realEmployeeVideosQ.data.videos || []
    videosTotal = realEmployeeVideosQ.data.total || 0
    videosTotalPages = realEmployeeVideosQ.data.totalPages || 1
  }
  const loadingVideos = isProductDetail
    ? realProductVideosQ.isPending
    : isEmployeeDetail
      ? realEmployeeVideosQ.isPending
      : false

  const detailMaterial: MaterialItem | null = detailQ.data || null
  const loadingDetail = detailQ.isPending

  // 列表内容变化（删除/改名）后失效缓存，React Query 自动重新拉取
  const handleListChanged = () => {
    qc.invalidateQueries({ queryKey: libraryKeys.all })
  }

  // 切换分组时重置到第 1 页
  useEffect(() => {
    setVideosPage(1)
  }, [isProductDetail, isEmployeeDetail, model, name])

  // 切 tab / 切关键词时回到第 1 页
  useEffect(() => {
    setGroupsPage(1)
  }, [tab, keyword])

  // URL 操作
  const handleTabChange = (next: Tab) => {
    setSearchParams({ tab: next })
  }

  const handleBackToGroups = () => {
    setSearchParams({ tab })
  }

  const handleOpenVideo = (mat: MaterialItem) => {
    // 详情/删除/改名接口均按 business_id（mat.id，飞书 record_id）查询，不用内部 UUID 主键 dbId
    const id = mat.id
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('video', id)
      return next
    })
  }

  const handleCloseVideo = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('video')
      return next
    })
  }

  // 过滤 + 排序（顶层用）
  const filteredProductGroups = (() => {
    const kw = keyword.trim().toLowerCase()
    let list = productGroups
    if (kw) list = list.filter((g) => g.productModel.toLowerCase().includes(kw))
    list = [...list].sort((a, b) =>
      sortBy === 'videoCount'
        ? b.videoCount - a.videoCount
        : new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    )
    return list
  })()

  const filteredEmployeeGroups = (() => {
    const kw = keyword.trim().toLowerCase()
    let list = employeeGroups
    if (kw) list = list.filter((g) => g.personName.toLowerCase().includes(kw))
    list = [...list].sort((a, b) =>
      sortBy === 'videoCount'
        ? b.videoCount - a.videoCount
        : new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    )
    return list
  })()

  // 分组页分页（产品 / 员工共用）
  const groupsTotal = tab === 'product' ? filteredProductGroups.length : filteredEmployeeGroups.length
  const groupsTotalPages = Math.max(1, Math.ceil(groupsTotal / groupsPageSize))
  const paginatedProductGroups = filteredProductGroups.slice(
    (groupsPage - 1) * groupsPageSize,
    groupsPage * groupsPageSize,
  )
  const paginatedEmployeeGroups = filteredEmployeeGroups.slice(
    (groupsPage - 1) * groupsPageSize,
    groupsPage * groupsPageSize,
  )

  const topTitle =
    isProductDetail ? `产品 / ${model}`
    : isEmployeeDetail ? (isSalesperson ? `我的素材库` : `员工 / ${name}`)
    : isSalesperson ? `我的素材库`
    : '双素材库'

  const topSubtitle = isProductDetail
    ? `当前分组共 ${videosTotal} 个视频（按入库时间倒序，第 ${videosPage} / ${videosTotalPages} 页），点击视频查看分镜标签与时间轴`
    : isEmployeeDetail
      ? (isSalesperson
          ? `${myName} 的视频共 ${videosTotal} 个（按入库时间倒序，第 ${videosPage} / ${videosTotalPages} 页），点击视频查看分镜与时间轴`
          : `当前员工名下 ${videosTotal} 个视频（按入库时间倒序，第 ${videosPage} / ${videosTotalPages} 页），点击视频查看分镜标签与时间轴`)
      : isSalesperson
        ? `正在加载 ${myName} 的视频素材…`
        : '按产品型号或员工姓名浏览素材，点击进入下钻查看视频与分镜'

  return (
    <div className="flex-1 min-w-0 px-6 py-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">{topTitle}</h1>
          <p className="text-sm text-muted-foreground mt-1">{topSubtitle}</p>
        </div>
        {/* 业务员：常驻「上传素材」按钮（其他角色在下面 toolbar 区也有） */}
        {isSalesperson && (
          <Button size="sm" onClick={() => navigate('/upload')}>
            <Upload className="size-4 mr-2" />
            上传素材
          </Button>
        )}
      </div>

      {!isProductDetail && !isEmployeeDetail && !isSalesperson ? (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => handleTabChange('employee')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === 'employee' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              员工素材库
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('product')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === 'product' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              产品素材库
            </button>
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={tab === 'product' ? '搜索产品型号' : '搜索员工姓名'}
              className="pl-9"
            />
          </div>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-[180px]">
              <ArrowUpDown className="size-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="videoCount">视频数量</SelectItem>
              <SelectItem value="latestAt">最近上传</SelectItem>
            </SelectContent>
          </Select>

          {isManager && (
            <Button size="sm" onClick={() => navigate('/upload')}>
              <Upload className="size-4 mr-2" />
              上传素材
            </Button>
          )}
        </div>
      ) : null}

      {!isProductDetail && !isEmployeeDetail && !isSalesperson ? (
        <p className="text-xs text-muted-foreground">
          {tab === 'employee'
            ? `当前员工 ${filteredEmployeeGroups.length} 位 / 共 ${employeeGroups.length} 位，第 ${groupsPage} / ${groupsTotalPages} 页`
            : `当前产品型号 ${filteredProductGroups.length} 个 / 共 ${productGroups.length} 个，第 ${groupsPage} / ${groupsTotalPages} 页`}
        </p>
      ) : null}

      {isSalesperson && !isEmployeeDetail ? (
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>正在为你准备 {myName} 的视频素材…</span>
        </div>
      ) : null}

      {!isSalesperson && !isProductDetail && !isEmployeeDetail ? (
        <>
          {tab === 'product' ? (
            <ProductGroupGridSection groups={paginatedProductGroups} loading={loadingGroups} />
          ) : (
            <EmployeeGroupGridSection groups={paginatedEmployeeGroups} loading={loadingGroups} />
          )}

          {/* 分组分页（每页 12 个） */}
          {groupsTotalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-xs text-muted-foreground">
                第 {Math.min((groupsPage - 1) * groupsPageSize + 1, groupsTotal)}–
                {Math.min(groupsPage * groupsPageSize, groupsTotal)} 个 / 共 {groupsTotal} 个
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={(e) => { e.preventDefault(); if (groupsPage > 1) setGroupsPage(groupsPage - 1) }}
                      aria-disabled={groupsPage <= 1}
                      className={groupsPage <= 1 ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {buildPageNumbers(groupsPage, groupsTotalPages).map((it, i) =>
                    it === '…' ? (
                      <PaginationItem key={`ge${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={it}>
                        <PaginationLink
                          isActive={it === groupsPage}
                          onClick={(e) => { e.preventDefault(); setGroupsPage(it) }}
                          className="cursor-pointer"
                        >
                          {it}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={(e) => { e.preventDefault(); if (groupsPage < groupsTotalPages) setGroupsPage(groupsPage + 1) }}
                      aria-disabled={groupsPage >= groupsTotalPages}
                      className={groupsPage >= groupsTotalPages ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      ) : (
        <VideosGridSection
          title={
            isProductDetail
              ? `产品型号：${model}`
              : isSalesperson
                ? `${myName} 的视频`
                : `员工：${name}`
          }
          subtitle={`共 ${videosTotal} 个视频（按入库时间倒序，第 ${videosPage} / ${videosTotalPages} 页）`}
          videos={groupVideos}
          loading={loadingVideos}
          page={videosPage}
          totalPages={videosTotalPages}
          pageSize={videosPageSize}
          total={videosTotal}
          onPageChange={setVideosPage}
          onSelect={handleOpenVideo}
          onBack={isSalesperson ? undefined : handleBackToGroups}
          onChanged={handleListChanged}
        />
      )}

      <VideoShotDetailDialog
        material={loadingDetail ? null : detailMaterial}
        open={!!videoId}
        onClose={handleCloseVideo}
      />
    </div>
  )
}
