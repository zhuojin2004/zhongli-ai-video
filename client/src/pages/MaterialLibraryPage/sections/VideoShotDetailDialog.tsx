import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clapperboard, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { MaterialItem, VideoShot } from '@shared/api.interface'
import { updateShotInLibrary, deleteShotFromLibrary } from '@/api/materials'

interface VideoShotDetailDialogProps {
  material: MaterialItem | null
  open: boolean
  onClose: () => void
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds - Math.floor(seconds)) * 100)
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

function findCurrentShotIndex(shots: VideoShot[], currentTime: number): number {
  for (let i = 0; i < shots.length; i += 1) {
    if (currentTime >= shots[i].startTime && currentTime < shots[i].endTime) return i
  }
  return -1
}

export default function VideoShotDetailDialog({
  material,
  open,
  onClose,
}: VideoShotDetailDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // 本地维护 shots 列表，支持删除分镜后立即刷新（不再走服务端刷新整个素材）
  const [shotsState, setShotsState] = useState<VideoShot[]>([])
  useEffect(() => {
    setShotsState(((material?.shots ?? []) as unknown) as VideoShot[])
  }, [material?.id, material])

  const handleShotDeleted = (shotId: string): void => {
    setShotsState((prev) =>
      prev.filter((s) => (s.shotId || s.recordId) !== shotId),
    )
    // 删完后若 currentTime 落在被删分镜区间，跳到上一个分镜的 endTime
    setCurrentTime((t) => t)
  }

  const shots = shotsState
  const totalDuration = useMemo(() => {
    if (shots.length > 0) {
      return Math.max(...shots.map((s) => s.endTime || 0), material?.totalDuration ?? 0)
    }
    return material?.totalDuration ?? 0
  }, [shots, material])

  const currentShotIndex = useMemo(
    () => findCurrentShotIndex(shots, currentTime),
    [shots, currentTime],
  )
  const currentShot = currentShotIndex >= 0 ? shots[currentShotIndex] : null

  // 重置 state 当切换素材时
  useEffect(() => {
    if (!open) {
      setCurrentTime(0)
      setIsPlaying(false)
      return
    }
    setCurrentTime(0)
    setIsPlaying(false)
  }, [open, material?.id])

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }

  const handlePlay = () => setIsPlaying(true)
  const handlePause = () => setIsPlaying(false)

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  if (!material) return null
  const videoSrc = material.playableUrl || material.videoUrl || ''

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Clapperboard className="size-4 text-primary" />
                {material.productModel || material.productName || material.fileName}
              </DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {material.fileName} · {shots.length} 个分镜 · 时长 {fmt(totalDuration)}
                {material.personName ? ` · 人物：${material.personName}` : ''}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
          {/* 左侧：播放器 */}
          <div className="lg:col-span-2 bg-black">
            {videoSrc ? (
              <video
                ref={videoRef}
                src={videoSrc}
                className="w-full aspect-video"
                controls
                onTimeUpdate={handleTimeUpdate}
                onPlay={handlePlay}
                onPause={handlePause}
              />
            ) : (
              <div className="w-full aspect-video flex items-center justify-center bg-muted">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">无可播放源</span>
              </div>
            )}
          </div>

          {/* 右侧：分镜标签面板 */}
          <div className="border-l border-border p-4 lg:max-h-[60vh] overflow-y-auto">
            {currentShot ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 text-primary">
                    分镜 #{currentShotIndex + 1}
                  </span>
                  <EditableTimeField shot={currentShot} totalDuration={totalDuration} />
                </div>

                <EditableField
                  label="画面描述"
                  shot={currentShot}
                  fieldKey="description"
                  multiline
                  highlight={false}
                />
                <EditableField label="场景" shot={currentShot} fieldKey="scene" />
                <EditableField label="物体" shot={currentShot} fieldKey="objects" />
                <EditableField label="动作" shot={currentShot} fieldKey="action" />
                <EditableField label="镜头" shot={currentShot} fieldKey="camera" />
                <EditableField
                  label="卖点"
                  shot={currentShot}
                  fieldKey="coreSellingPoint"
                  highlight
                />

                {/* 右下角：彻底删除该分镜（小垃圾箱） */}
                <div className="flex justify-end pt-1">
                  <DeleteShotTagsButton
                    shot={currentShot}
                    material={{ ...material, shots: shotsState }}
                    onDeleted={handleShotDeleted}
                  />
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-12 text-center">
                播放视频或点击下方分镜查看标签
              </div>
            )}
          </div>
        </div>

        {/* 底部：分镜时间轴 */}
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              分镜时间轴 · 当前 {fmt(currentTime)} · {isPlaying ? '播放中' : '已暂停'}
            </span>
            <span className="text-xs text-muted-foreground">
              {currentShotIndex >= 0 ? `分镜 ${currentShotIndex + 1}` : '间隙'} / 共 {shots.length}
            </span>
          </div>
          {shots.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center space-y-1">
              <div>该素材暂无分镜数据</div>
              <div className="text-[11px] text-muted-foreground/70">
                可能原因：飞书主表「视频文件名」与分镜表不对应、或分镜分析尚未完成
              </div>
            </div>
          ) : (
            <ShotTimelineBar
              shots={shots}
              totalDuration={totalDuration}
              currentTime={currentTime}
              onSeek={handleSeek}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 可编辑字段：默认展示只读文本，hover 出现铅笔图标 → 点击进入编辑态
 * - 单行字段用 Input，多行用 Textarea
 * - 保存（Ctrl+Enter / blur / 点 ✓）：POST 飞书 + DB，成功后 toast 提示并刷新本地
 * - 取消（Esc / 点 ✗）：丢弃改动，恢复原值
 */
type ShotFieldKey = 'description' | 'scene' | 'objects' | 'action' | 'camera' | 'coreSellingPoint'

function EditableField({
  label,
  shot,
  fieldKey,
  highlight = false,
  multiline = false,
}: {
  label: string
  shot: VideoShot
  fieldKey: ShotFieldKey
  highlight?: boolean
  multiline?: boolean
}) {
  const original = (shot[fieldKey] as string | undefined) || ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(original)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false) // 已同步飞书的最近一次修改
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  // 当前 shot 切换时重置
  useEffect(() => {
    setEditing(false)
    setDraft(original)
    setSaved(false)
  }, [shot.shotId, original])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      // 全选
      const el = inputRef.current
      if ('select' in el && typeof el.select === 'function') {
        try { el.select() } catch {}
      }
    }
  }, [editing])

  const startEdit = () => {
    const id = shot.recordId || shot.shotId
    if (!id) {
      toast.error('该分镜未关联飞书 record_id，无法编辑')
      return
    }
    setDraft(original)
    setEditing(true)
    setSaved(false)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(original)
  }

  const saveEdit = async () => {
    const trimmed = draft.trim()
    if (trimmed === original.trim()) {
      setEditing(false)
      return
    }
    // PATCH 需要飞书 record_id（不是「分镜 ID」自定义字段）
    const id = shot.recordId || shot.shotId
    if (!id) {
      toast.error('缺少 recordId，无法保存')
      return
    }
    setSaving(true)
    try {
      const r = await updateShotInLibrary(id, { [fieldKey]: trimmed })
      const { feishuUpdated, feishuError } = r.data
      if (feishuUpdated) {
        // 直接更新原 shot 对象（双绑）
        ;(shot as any)[fieldKey] = trimmed
        setSaved(true)
        toast.success(`「${label}」已同步到飞书`, { duration: 1800 })
      } else {
        toast.warning(`本地已保存，飞书同步失败：${feishuError || '未知错误'}`, { duration: 3500 })
      }
      setEditing(false)
    } catch (e: any) {
      toast.error(`保存失败：${e?.message || '网络错误'}`, { duration: 3500 })
      setDraft(original)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    } else if (e.key === 'Enter') {
      // Ctrl+Enter / Cmd+Enter 多行保存；单行 Enter 直接保存
      if (multiline && !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      void saveEdit()
    }
  }

  // 空值占位
  if (!original && !editing) {
    return (
      <div className="group">
        <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center justify-between">
          <span>{label}</span>
          <button
            type="button"
            onClick={startEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
            title="添加"
          >
            <Pencil className="size-3" />
          </button>
        </div>
        <p
          className="text-xs italic text-muted-foreground/60 cursor-pointer hover:text-primary"
          onClick={startEdit}
        >
          （空，点击编辑）
        </p>
      </div>
    )
  }

  return (
    <div className="group">
      <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {label}
          {saved && <Check className="size-3 text-green-600" />}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
            title="编辑"
          >
            <Pencil className="size-3" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-1.5">
          {multiline ? (
            <Textarea
              ref={inputRef as any}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                // 延迟 blur，让 ✓/✗ 按钮的 onClick 先触发
                setTimeout(() => {
                  if (editing && !saving) saveEdit()
                }, 150)
              }}
              disabled={saving}
              rows={3}
              className="text-sm resize-y min-h-[60px]"
            />
          ) : (
            <Textarea
              ref={inputRef as any}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                setTimeout(() => {
                  if (editing && !saving) saveEdit()
                }, 150)
              }}
              disabled={saving}
              rows={1}
              className="text-sm min-h-[36px] resize-y"
            />
          )}
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-[10px] text-muted-foreground mr-auto">
              {multiline ? 'Ctrl+Enter 保存 · Esc 取消' : 'Enter 保存 · Esc 取消'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelEdit}
              disabled={saving}
              className="h-6 px-2 text-xs"
            >
              <X className="size-3 mr-1" /> 取消
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={saveEdit}
              disabled={saving}
              className="h-6 px-2 text-xs"
            >
              {saving ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <Check className="size-3 mr-1" />
              )}
              保存
            </Button>
          </div>
        </div>
      ) : (
        <p
          className={`text-sm whitespace-pre-wrap cursor-text rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 ${highlight ? 'text-primary font-medium' : ''}`}
          onClick={startEdit}
          title="点击编辑"
        >
          {original}
        </p>
      )}
    </div>
  )
}

/**
 * 可编辑时间字段：默认展示 "m:ss.cc → m:ss.cc"，hover 出现铅笔 → 点击进入编辑态
 * - 同时编辑 startTime / endTime（两个数字输入框并排）
 * - 校验：startTime < endTime、两者都在 [0, totalDuration] 内
 * - 保存：PATCH /api/library/shot/:shotId（已支持 startTime/endTime，后端同步飞书「开始时间 (s)」「结束时间 (s)」）
 * - 取消：Esc 或点 ✗，恢复原值
 */
function EditableTimeField({
  shot,
  totalDuration,
}: {
  shot: VideoShot
  totalDuration: number
}) {
  const originalStart = Number(shot.startTime) || 0
  const originalEnd = Number(shot.endTime) || 0
  const [editing, setEditing] = useState(false)
  const [startDraft, setStartDraft] = useState(String(originalStart))
  const [endDraft, setEndDraft] = useState(String(originalEnd))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const startInputRef = useRef<HTMLInputElement | null>(null)

  // 切换 shot 时重置
  useEffect(() => {
    setEditing(false)
    setStartDraft(String(originalStart))
    setEndDraft(String(originalEnd))
    setSaved(false)
  }, [shot.shotId, originalStart, originalEnd])

  useEffect(() => {
    if (editing && startInputRef.current) {
      startInputRef.current.focus()
      startInputRef.current.select()
    }
  }, [editing])

  const startEdit = () => {
    const id = shot.recordId || shot.shotId
    if (!id) {
      toast.error('该分镜未关联飞书 record_id，无法编辑')
      return
    }
    setStartDraft(String(originalStart))
    setEndDraft(String(originalEnd))
    setEditing(true)
    setSaved(false)
  }

  const cancelEdit = () => {
    setEditing(false)
    setStartDraft(String(originalStart))
    setEndDraft(String(originalEnd))
  }

  const saveEdit = async () => {
    const id = shot.recordId || shot.shotId
    if (!id) {
      toast.error('缺少 recordId，无法保存')
      return
    }
    const newStart = Number(startDraft)
    const newEnd = Number(endDraft)
    if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
      toast.error('时间必须是数字（秒）')
      return
    }
    if (newStart < 0 || newEnd < 0) {
      toast.error('时间不能为负数')
      return
    }
    if (totalDuration > 0 && (newStart > totalDuration || newEnd > totalDuration)) {
      toast.error(`时间不能超过视频总时长 ${fmt(totalDuration)}`)
      return
    }
    if (newEnd <= newStart) {
      toast.error('结束时间必须大于开始时间')
      return
    }
    if (newStart === originalStart && newEnd === originalEnd) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const r = await updateShotInLibrary(id, { startTime: newStart, endTime: newEnd })
      const { feishuUpdated, feishuError } = r.data
      if (feishuUpdated) {
        ;(shot as any).startTime = newStart
        ;(shot as any).endTime = newEnd
        setSaved(true)
        toast.success('时间戳已同步到飞书', { duration: 1800 })
        setEditing(false)
      } else {
        toast.warning(`本地已保存，飞书同步失败：${feishuError || '未知错误'}`, { duration: 3500 })
        setEditing(false)
      }
    } catch (e: any) {
      toast.error(`保存失败：${e?.message || '网络错误'}`, { duration: 3500 })
      setStartDraft(String(originalStart))
      setEndDraft(String(originalEnd))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void saveEdit()
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-mono">
        <Input
          ref={startInputRef}
          type="number"
          step="0.01"
          min="0"
          max={totalDuration || undefined}
          value={startDraft}
          onChange={(e) => setStartDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="h-6 w-20 text-xs font-mono px-1.5"
        />
        <span className="text-muted-foreground">→</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          max={totalDuration || undefined}
          value={endDraft}
          onChange={(e) => setEndDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="h-6 w-20 text-xs font-mono px-1.5"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancelEdit}
          disabled={saving}
          className="h-6 w-6 p-0"
          title="取消"
        >
          <X className="size-3" />
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={saveEdit}
          disabled={saving}
          className="h-6 w-6 p-0"
          title="保存"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        </Button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className="group flex items-center gap-1 text-xs text-muted-foreground font-mono hover:text-primary transition-colors"
      title="点击修改时间戳"
    >
      <span>
        {fmt(originalStart)} → {fmt(originalEnd)}
      </span>
      {saved ? (
        <Check className="size-3 text-green-600" />
      ) : (
        <Pencil className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  )
}

function ShotTimelineBar({
  shots,
  totalDuration,
  currentTime,
  onSeek,
}: {
  shots: VideoShot[]
  totalDuration: number
  currentTime: number
  onSeek: (t: number) => void
}) {
  const handleClickBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(totalDuration, ratio * totalDuration)))
  }
  return (
    <div className="space-y-2">
      <div
        className="relative h-10 bg-muted rounded-md overflow-hidden cursor-pointer border border-border"
        onClick={handleClickBar}
      >
        {/* 分镜色块 */}
        {shots.map((s, i) => {
          const left = totalDuration > 0 ? (s.startTime / totalDuration) * 100 : 0
          const width = totalDuration > 0 ? ((s.endTime - s.startTime) / totalDuration) * 100 : 0
          const active = currentTime >= s.startTime && currentTime < s.endTime
          return (
            <div
              key={s.shotId || i}
              className={`absolute top-0 bottom-0 ${active ? 'bg-primary/70 border-x-2 border-primary' : 'bg-primary/30 border-x border-primary/40'} transition-colors`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`分镜 ${i + 1}: ${s.description || ''}`}
            >
              <div className="h-full flex items-center justify-center text-[10px] font-semibold text-primary-foreground truncate px-1">
                {i + 1}
              </div>
            </div>
          )
        })}
        {/* 当前时间游标 */}
        {totalDuration > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
            style={{ left: `${(currentTime / totalDuration) * 100}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shots.map((s, i) => (
          <button
            key={s.shotId || i}
            type="button"
            onClick={() => onSeek(s.startTime + 0.01)}
            className="px-2 py-0.5 text-xs rounded bg-secondary hover:bg-secondary/70 text-secondary-foreground"
            title={s.description || `分镜 ${i + 1}`}
          >
            #{i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 彻底删除该分镜（同步删除飞书分镜表行 + 本地 DB 行）
 * - 走 DELETE /api/library/shot/:shotId（云端权威：飞书先删，DB 跟上）
 * - 主表「反向关联分镜」字段因双向关联自动剔除该 record_id
 * - 成功后从 material.shots 数组里删除该 shot（局部状态立即刷新）
 * - 用 AlertDialog 二次确认，避免误点
 */
function DeleteShotTagsButton({ shot, material, onDeleted }: {
  shot: VideoShot
  material: MaterialItem
  onDeleted: (shotId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const id = shot.recordId || shot.shotId
  const idx = material.shots?.findIndex((s) => (s.shotId || s.recordId) === (shot.shotId || shot.recordId)) ?? -1
  const totalShots = material.shots?.length ?? 0

  const handleConfirm = async () => {
    if (!id) {
      toast.error('缺少 recordId，无法删除')
      return
    }
    setBusy(true)
    try {
      const r = await deleteShotFromLibrary(id)
      const { feishuDeleted, dbDeleted } = r.data
      if (!feishuDeleted) {
        toast.error('飞书分镜表删除失败，请重试', { duration: 3500 })
        return
      }
      onDeleted(id)
      if (dbDeleted) {
        toast.success(`分镜 ${idx + 1}/${totalShots} 已删除（飞书 + DB 同步）`, { duration: 2000 })
      } else {
        // 飞书行已删；DB 该行原本就不存在（云端素材 / DB 早期未写入）— 不算失败
        toast.success(`分镜 ${idx + 1}/${totalShots} 已删除（飞书行已剔除）`, { duration: 2000 })
      }
      setOpen(false)
    } catch (e: any) {
      toast.error(`删除失败：${e?.message || '网络错误'}`, { duration: 3500 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        disabled={!id}
        onClick={() => setOpen(true)}
        title={
          !id
            ? '该分镜未关联飞书 record_id，无法删除'
            : `删除分镜 ${idx + 1}/${totalShots}（同步删除飞书分镜表行 + DB 行）`
        }
        className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        data-testid="delete-shot-btn"
      >
        <Trash2 className="size-3.5" />
      </button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除分镜 {idx + 1}/{totalShots}？</AlertDialogTitle>
          <AlertDialogDescription>
            将彻底删除「分镜 {idx + 1}」的行，并同步到飞书分镜表与本地 DB。
            <br />
            <span className="text-destructive">该分镜所在行将从飞书分镜表消失，主表「反向关联分镜」也会自动剔除。</span>
            <br />
            此操作可在飞书后台「回收站」中恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Trash2 className="size-4 mr-1" />}
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}