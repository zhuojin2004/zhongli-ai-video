import { useNavigate } from 'react-router-dom'
import { Clapperboard, User, ChevronRight, Loader2 } from 'lucide-react'
import type { ProductGroup, EmployeeGroup } from '@/api/materials'

interface ProductGroupGridSectionProps {
  groups: ProductGroup[]
  loading: boolean
}

interface EmployeeGroupGridSectionProps {
  groups: EmployeeGroup[]
  loading: boolean
}

function formatTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

/**
 * 封面组件：优先使用现成图片（keyframe JPG），否则用 <video> 显示视频首帧
 * - 关键帧图（真实 JPG/PNG）：用 <img> 静态预览，最稳定
 * - 视频 URL：用 <video preload="metadata"> + #t=0.1 让浏览器加载并显示首帧
 *   （与 VideosGridSection VideoCard 同方案，已验证可正常显示）
 */
function ProductCover({
  imageUrl,
  videoUrl,
  alt,
}: {
  imageUrl?: string
  videoUrl?: string
  alt: string
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    )
  }
  if (videoUrl) {
    // #t=0.1 让浏览器强制 seek 到 0.1s，触发 loadeddata 后显示第一帧
    const src = videoUrl.includes('#') ? videoUrl : `${videoUrl}#t=0.1`
    return (
      <video
        src={src}
        className="w-full h-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
    )
  }
  return <Clapperboard className="size-10 text-muted-foreground/40" />
}

export function ProductGroupGridSection({ groups, loading }: ProductGroupGridSectionProps) {
  const navigate = useNavigate()
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (groups.length === 0) {
    return (
      <div className="text-center py-20 text-sm text-muted-foreground">
        暂无产品素材，请先上传视频
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {groups.map((g) => (
        <button
          key={g.productModel}
          type="button"
          onClick={() => navigate(`/materials?tab=product&model=${encodeURIComponent(g.productModel)}`)}
          className="group relative overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary hover:shadow-lg"
        >
          <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
            <ProductCover
              imageUrl={g.sampleCoverUrl}
              videoUrl={g.sampleUrl}
              alt={g.productModel}
            />
          </div>
          <div className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Clapperboard className="size-4 shrink-0 text-primary" />
              <h3 className="text-sm font-bold truncate" title={g.productModel}>{g.productModel}</h3>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>共 {g.videoCount} 个视频</span>
              <span>{formatTime(g.latestAt)}</span>
            </div>
            <div className="flex items-center justify-end text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
              查看视频
              <ChevronRight className="size-3 ml-1" />
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

export function EmployeeGroupGridSection({ groups, loading }: EmployeeGroupGridSectionProps) {
  const navigate = useNavigate()
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (groups.length === 0) {
    return (
      <div className="text-center py-20 text-sm text-muted-foreground">
        暂无员工素材，请先上传含有人物的视频
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {groups.map((g) => (
        <button
          key={g.personName}
          type="button"
          onClick={() => navigate(`/materials?tab=employee&name=${encodeURIComponent(g.personName)}`)}
          className="group relative overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary hover:shadow-lg"
        >
          <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
            {g.sampleUrl ? (
              <video
                src={g.sampleUrl}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <User className="size-10 text-muted-foreground/40" />
            )}
          </div>
          <div className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <User className="size-4 shrink-0 text-primary" />
              <h3 className="text-sm font-bold truncate" title={g.personName}>{g.personName}</h3>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>共 {g.videoCount} 个视频</span>
              <span>{formatTime(g.latestAt)}</span>
            </div>
            <div className="flex items-center justify-end text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
              查看视频
              <ChevronRight className="size-3 ml-1" />
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}