import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Clapperboard, Loader2, Pencil, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination'
import { toast } from 'sonner'
import type { MaterialItem } from '@shared/api.interface'
import { deleteVideoFromLibrary, updateVideoInLibrary } from '@/api/materials'
import { deriveShortTitle } from '@/utils/videoTitle'

interface VideosGridSectionProps {
  title: string
  subtitle: string
  videos: MaterialItem[]
  loading: boolean
  /** 当前页（1-based） */
  page?: number
  /** 总页数 */
  totalPages?: number
  /** 每页条数 */
  pageSize?: number
  /** 总条数（用于显示 "x-y / total"） */
  total?: number
  /** 切页回调 */
  onPageChange?: (page: number) => void
  onSelect: (mat: MaterialItem) => void
  onBack: () => void
  /** 当列表内容发生变化（删除 / 改名）时通知父级刷新 */
  onChanged?: () => void
}

function formatTime(seconds: number): string {
  if (!seconds) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

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

/** 视频卡片骨架屏 */
function VideoCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="aspect-video bg-muted animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse" />
        <div className="h-2.5 w-full rounded bg-muted animate-pulse" />
        <div className="h-2.5 w-2/3 rounded bg-muted animate-pulse" />
      </div>
    </div>
  )
}

function VideoSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 12 }).map((_, i) => <VideoCardSkeleton key={i} />)}
    </div>
  )
}

export default function VideosGridSection({
  title,
  subtitle,
  videos,
  loading,
  page = 1,
  totalPages = 1,
  pageSize = 12,
  total = 0,
  onPageChange,
  onSelect,
  onBack,
  onChanged,
}: VideosGridSectionProps) {
  const [deleteTarget, setDeleteTarget] = useState<MaterialItem | null>(null)
  const [editTarget, setEditTarget] = useState<MaterialItem | null>(null)
  const [editProduct, setEditProduct] = useState('')
  const [editPerson, setEditPerson] = useState('')
  const [busy, setBusy] = useState(false)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setBusy(true)
    try {
      const r = await deleteVideoFromLibrary(id)
      const data = r.data
      toast.success('素材已删除', {
        description: `DB: ${data.db?.deleted ? '已删' : '失败'} · OSS: ${data.oss?.length || 0} 个文件 · 飞书: ${data.feishu?.main || '—'}`,
      })
      setDeleteTarget(null)
      onChanged?.()
    } catch (e) {
      toast.error('删除失败', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    if (!editTarget) return
    const id = editTarget.id
    setBusy(true)
    try {
      const r = await updateVideoInLibrary(id, {
        productName: editProduct.trim() || undefined,
        personName: editPerson.trim(),
      })
      const updates = r.data.updates || {}
      const desc = Object.entries(updates).map(([k, v]) => `${k}: ${v || '(空)'}`).join(' · ')
      toast.success('已更新', { description: desc })
      setEditTarget(null)
      onChanged?.()
    } catch (e) {
      toast.error('更新失败', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="返回">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 space-y-1.5">
            <div className="h-4 w-40 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-56 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <VideoSkeletonGrid />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="返回">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-lg font-bold truncate">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="text-center py-20 text-sm text-muted-foreground">
          该分组暂无视频
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map((v) => (
              <VideoCard
                key={v.id || v.dbId}
                video={v}
                onClick={() => onSelect(v)}
                onEdit={() => {
                  setEditTarget(v)
                  setEditProduct(v.productModel || v.productName || '')
                  setEditPerson(v.personName || '')
                }}
                onDelete={() => setDeleteTarget(v)}
              />
            ))}
          </div>

          {totalPages > 1 && onPageChange && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-xs text-muted-foreground">
                第 {Math.min((page - 1) * pageSize + 1, total)}–
                {Math.min(page * pageSize, total)} 条 / 共 {total} 条
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={(e) => { e.preventDefault(); if (page > 1) onPageChange(page - 1) }}
                      aria-disabled={page <= 1}
                      className={page <= 1 ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {buildPageNumbers(page, totalPages).map((it, i) =>
                    it === '…' ? (
                      <PaginationItem key={`e${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={it}>
                        <PaginationLink
                          isActive={it === page}
                          onClick={(e) => { e.preventDefault(); onPageChange(it) }}
                          className="cursor-pointer"
                        >
                          {it}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={(e) => { e.preventDefault(); if (page < totalPages) onPageChange(page + 1) }}
                      aria-disabled={page >= totalPages}
                      className={page >= totalPages ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" />
              确认删除素材？
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-relaxed pt-1">
              将同时删除：DB 素材库记录、阿里云 OSS 上的视频文件、飞书多维表格中的主记录与分镜记录。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-md bg-muted/40 border border-border p-3 text-xs space-y-1">
              <div className="text-foreground font-medium truncate">{deleteTarget.fileName}</div>
              <div className="text-muted-foreground">型号：{deleteTarget.productModel || '—'}</div>
              <div className="text-muted-foreground">人物：{deleteTarget.personName || '—'}</div>
              <div className="text-muted-foreground">分镜：{deleteTarget.shotCount || 0} 条</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={confirmDelete}>
              {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Trash2 className="size-4 mr-1" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 改名 */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Pencil className="size-5 text-primary" />
              编辑素材标签
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-relaxed pt-1">
              修改后同步更新 DB + 飞书多维表格主记录
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">产品型号</label>
              <Input
                value={editProduct}
                onChange={(e) => setEditProduct(e.target.value)}
                placeholder="例：中力 LICON XCP10E 自动化搬运机器人"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">出镜人物</label>
              <Input
                value={editPerson}
                onChange={(e) => setEditPerson(e.target.value)}
                placeholder="例：戴眼镜的中年男性销售"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button size="sm" disabled={busy} onClick={saveEdit}>
              {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function VideoCard({
  video,
  onClick,
  onEdit,
  onDelete,
}: {
  video: MaterialItem
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const videoSrc = video.playableUrl || video.videoUrl || ''
  // 缩略图 / 海报：优先 video.thumbnailUrl，其次第一条分镜的 keyframePath
  const posterSrc = video.thumbnailUrl || video.shots?.[0]?.keyframePath || ''
  // 懒加载：仅当卡片进入视口时才开始 fetch 视频元数据
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const isStaticDemo = import.meta.env.VITE_STATIC_DEMO === 'true'
  // 静态演示模式直接加载（内嵌浏览器 IntersectionObserver 可能不触发）
  const [shouldLoad, setShouldLoad] = useState(isStaticDemo)

  useEffect(() => {
    if (!wrapRef.current || shouldLoad) return
    const el = wrapRef.current
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShouldLoad(true)
            io.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0.01 },
    )
    io.observe(el)
    // 兜底：部分内嵌浏览器 IntersectionObserver 不触发回调，1.5s 后强制加载
    const fallback = window.setTimeout(() => setShouldLoad(true), 1500)
    return () => {
      io.disconnect()
      window.clearTimeout(fallback)
    }
  }, [shouldLoad, isStaticDemo])

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary hover:shadow-lg"
    >
      <div ref={wrapRef} className="aspect-video bg-muted flex items-center justify-center overflow-hidden relative">
        {videoSrc && shouldLoad ? (
          <video
            src={videoSrc}
            poster={posterSrc || undefined}
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : posterSrc ? (
          <img
            src={posterSrc}
            alt={video.fileName || ''}
            className="w-full h-full object-cover"
            loading="eager"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/60">
            <Clapperboard className="size-10" />
            <span className="text-[10px] truncate max-w-[80%]">{video.fileName || '暂无缩略图'}</span>
          </div>
        )}
        {video.quality === '优质' && (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-emerald-500/90 text-white text-xs font-semibold flex items-center gap-1">
            <Star className="size-3" />
            优质
          </span>
        )}
        {video.analysisStatus === 'analyzing' && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-amber-500/90 text-white text-xs">
            分析中
          </span>
        )}
        {video.analysisStatus === 'failed' && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-red-500/90 text-white text-xs flex items-center gap-1">
            <Trash2 className="size-3" />
            失败
          </span>
        )}
        {/* 悬浮操作按钮（stopPropagation 避免触发卡片 onClick 进入详情） */}
        <div
          className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onEdit() } }}
            className="size-7 rounded-md bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer"
            title="编辑"
          >
            <Pencil className="size-3.5" />
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete() } }}
            className="size-7 rounded-md bg-black/60 hover:bg-destructive text-white flex items-center justify-center cursor-pointer"
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </span>
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        {(() => {
          // 标题策略：从文件名派生简短标题（方案 X）
          //   「自动搬运车/机械制造业/RPG-普洛斯.mp4」→ 「普洛斯」
          //   「中力 EP 系列无人搬运叉车 (AGV/AMR ...)」这种 AI 长型号不再当主标题
          const shortTitle = deriveShortTitle(video.fileName)
          const fallback = video.productModel || video.productName || video.fileName
          const display = shortTitle || fallback
          return (
            <h3 className="text-sm font-semibold truncate" title={fallback}>
              {display}
            </h3>
          )
        })()}
        {/* 视频源文件名（来自飞书多维表格）—— 完整路径作辅助行；hover 看全名 */}
        {video.fileName && (
          <div className="text-[11px] text-muted-foreground/80 truncate font-mono" title={video.fileName}>
            {video.fileName}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clapperboard className="size-3" />
            {video.shotCount || 0} 分镜
          </span>
          <span>{formatTime(video.totalDuration || 0)}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{video.usageCount || 0} 次使用</span>
          <span>{video.consumptionCount || 0} 消耗</span>
        </div>
      </div>
    </button>
  )
}
