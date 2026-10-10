import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { AxiosProgressEvent } from 'axios'
import { toast } from 'sonner'
import { Upload, FileVideo, Loader2, AlertTriangle, RefreshCw, CheckCircle2, X, ChevronDown, Trash2, Eye, Clock, Plus, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { localAxios } from '@/utils/localAxios'
import { localLogger as logger } from '@/utils/localLogger'
import { analyzeVideo } from '@/api/video-analysis'
import { createMaterial } from '@/api/materials'
import { useAuth } from '@/contexts/AuthContext'
import type { AnalyzeVideoResponse } from '@shared/api.interface'
import { useNavigate } from 'react-router-dom';

type UploadStep = 1 | 2 | 3 | 4 | 5
type UploadTaskStatus = 'waiting' | 'uploading' | 'analyzing' | 'done' | 'error'
type StatusFilter = 'all' | 'waiting' | 'uploading' | 'done' | 'error'

const STEPS = [
  { step: 1 as UploadStep, label: '素材预处理' },
  { step: 2 as UploadStep, label: '上传素材' },
  { step: 3 as UploadStep, label: '素材分镜' },
  { step: 4 as UploadStep, label: '素材打标签' },
  { step: 5 as UploadStep, label: '素材落库' },
]

interface UploadTask {
  id: string
  file: File
  fileName: string
  fileSize: string
  status: UploadTaskStatus
  progress: number
  shotCount: number | null
  tags: string[]
  customTags: string[]
  errorMsg: string
  downloadUrl: string
}

interface BatchProgress {
  total: number
  uploading: number
  done: number
  failed: number
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function classifyError(err: Error): string {
  const msg = err.message.toLowerCase()
  if (msg.includes('upload') || msg.includes('format')) return '视频格式不支持或上传失败'
  if (msg.includes('timeout') || msg.includes('超时')) return 'AI 分析超时，请重试'
  if (msg.includes('parse') || msg.includes('json') || msg.includes('empty')) return 'AI 分析结果异常'
  if (msg.includes('401') || msg.includes('authentication')) return 'API 密钥无效'
  return err.message || '分析失败，请重试'
}

const MaterialUploadPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState<UploadStep>(1)
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isUploading, setIsUploading] = useState(false)
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [successDialogOpen, setSuccessDialogOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [tagInputTaskId, setTagInputTaskId] = useState<string | null>(null)
  const [tagInputValue, setTagInputValue] = useState('')
  const progressTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  // ⚠️ 必须在 handlePickerClick 之前定义，否则 useCallback 闭包内引用时会 TDZ 报错
  //   "Cannot access 'handleFileSelect' before initialization"
  const handleFileSelect = useCallback(
    (files: FileList | null): void => {
      if (!files || files.length === 0) return
      const newTasks: UploadTask[] = Array.from(files).map((file) => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        fileName: file.name,
        fileSize: formatFileSize(file.size),
        status: 'waiting' as UploadTaskStatus,
        progress: 0,
        shotCount: null,
        tags: [],
        customTags: [],
        errorMsg: '',
        downloadUrl: '',
      }))
      setTasks((prev) => [...prev, ...newTasks])
      setCurrentStep(2)
    },
    [],
  )

  /**
   * 动态创建一个全新的 <input type="file">，立即 click，用完即销毁
   *
   * 这是修复 macOS 系统选择器「上传」按钮灰色问题的核心方案：
   * 之前用 ref + 同一个 input 元素反复 click，macOS 系统会把上一次的状态残留下来
   * （尤其是 rejectFile / cancel 之后），导致下一次选文件时按钮始终是灰色的。
   * 每次都创建全新 DOM 节点 + 立即 click，绕过这个 macOS bug。
   */
  const handlePickerClick = useCallback((): void => {
    if (isUploading) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo'
    input.style.display = 'none'
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      try { input.remove() } catch {}
    }
    input.addEventListener('change', () => {
      handleFileSelect(input.files)
      cleanup()
    })
    // 用户取消 picker（macOS 按取消、Esc、或直接关闭）也要清理节点
    input.addEventListener('cancel', cleanup, { once: true })
    window.addEventListener('focus', cleanup, { once: true })
    document.body.appendChild(input)
    input.click()
  }, [isUploading, handleFileSelect])

  // ⚠️ P0 修复：组件卸载时必须清掉所有 setInterval，避免对已卸载组件持续 setState
  // （会在 React 18 严格模式下触发警告，并在边缘场景下引发重渲染 → 用户感知为「页面刷新」）
  useEffect(() => {
    return () => {
      progressTimersRef.current.forEach((timer) => clearInterval(timer))
      progressTimersRef.current.clear()
    }
  }, [])

  const startProgressAnimation = useCallback((taskId: string): void => {
    const timer = setInterval(() => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId || t.status !== 'uploading') return t
          const next = Math.min(t.progress + Math.random() * 8 + 3, 90)
          return { ...t, progress: Math.round(next) }
        }),
      )
    }, 300)
    progressTimersRef.current.set(taskId, timer)
  }, [])

  const stopProgressAnimation = useCallback((taskId: string): void => {
    const timer = progressTimersRef.current.get(taskId)
    if (timer) {
      clearInterval(timer)
      progressTimersRef.current.delete(taskId)
    }
  }, [])

  const processFile = useCallback(
    async (task: UploadTask): Promise<{ success: boolean; shotCount: number | null }> => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'uploading', progress: 0 } : t)))
      startProgressAnimation(task.id)

      try {
        // 直接用 axios 上传到本地 mock server（绕过 getDataloom）
        const formData = new FormData()
        formData.append('file', task.file)

        // 把当前登录用户的姓名 + 角色传给后端
        //   姓名 → 写入飞书主表「人物标签」字段
        //   角色 → 决定 AI 是否分析「人物姓名（如果有）」分镜字段
        //     - 业务员 (user)     → 不用 AI，所有分镜「人物姓名」直接是上传者本人
        //     - 运营/管理员       → 让 AI 识别画面里出现的人物姓名
        // ⚠️ P2 修复：始终发送 header（即使为空），不要 if 判断。
        //   之前 user.name 为空时整段被跳过 → mock server 收到的 header 为 undefined
        //   → 主表「人物标签」写入空值 → 字段显示为 ()  ← 这就是上次的回归 bug
        const uploadHeaders: Record<string, string> = {
          'x-uploader-name': user?.name || '',
          'x-uploader-role': user?.role || 'user',
        }

        const uploadRes = await localAxios.post('/api/upload', formData, {
          headers: uploadHeaders,
          // 真实上传进度（axios 在浏览器用 XHR 的 progress 事件；走 Vite proxy 也透传）
          onUploadProgress: (e: AxiosProgressEvent) => {
            if (!e.total) return
            const pct = Math.min(99, Math.round((e.loaded / e.total) * 100))
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id && pct > t.progress ? { ...t, progress: pct } : t,
              ),
            )
            // 拿到真实进度后，停止假进度动画，避免数字来回跳
            stopProgressAnimation(task.id)
          },
        })
        const uploadData = uploadRes.data

        stopProgressAnimation(task.id)
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: 'analyzing', progress: 100, downloadUrl: uploadData.download_url } : t,
          ),
        )

        setCurrentStep(3)

        const { data: result } = await analyzeVideo({
          downloadUrl: uploadData.download_url,
          filePath: uploadData.file_path,
          fileName: task.fileName, // ⚠️ 传原始文件名（如 RPG-凯顺.mp4），避免写分镜表时 fallback 到 savedName（upload_xxx.mp4）
          ossUrl: uploadData.oss?.publicUrl, // ⚠️ 给 MiniMax-M3 用 HTTPS OSS URL（HTTP 端口在本机被屏蔽）
          mainRecordId: uploadData.main_feishu_record_id, // ⚠️ 告诉 /api/video/analyze 跳过重复的 SHOT 写入（/api/upload 已异步触发 analyzeAndSyncToShotTable）
          uploaderRole: user?.role,
          uploaderName: user?.name,
        })

        const sellingPoints: string[] = []
        for (const shot of result.shots) {
          if (shot.coreSellingPoint && !sellingPoints.includes(shot.coreSellingPoint)) {
            sellingPoints.push(shot.coreSellingPoint)
            if (sellingPoints.length >= 5) break
          }
        }

        setCurrentStep(4)
        setCurrentStep(5)
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, status: 'done', shotCount: result.shotCount, tags: sellingPoints }
              : t,
          ),
        )

        // 上传+分析成功后，注册到素材库（runtimeMaterials + DB）
        try {
          const res = await createMaterial({
            fileName: task.fileName,
            downloadUrl: uploadData.download_url,
            productName: result.productModel || task.fileName.replace(/\.[^/.]+$/, ''),
            industry: result.industry || '',
            clientName: result.clientName || '',
            department: result.department || '',
            categoryTags: result.categoryTags || [],
            sellingPointTags: sellingPoints,
            quality: result.quality || '优质',
            shotCount: result.shotCount || 0,
            totalDuration: result.totalDuration || 0,
            shots: result.shots || [],
          } as any)
          const material = res.data
          logger.info(
            `Material registered: ${material.id} (dbId=${material.dbId?.slice(0, 8) || 'n/a'}, shots=${material.shotCount})`,
          )

          toast.success(`${task.fileName} 已同步`, {
            description: `已入库 ${result.shotCount} 条分镜 · DB ID: ${material.dbId?.slice(0, 8) || '—'}`,
          })
        } catch (regErr) {
          logger.warn(`Material registration failed: ${(regErr as Error).message}`)
          toast.warning(`${task.fileName} 素材库注册失败`, {
            description: '分析已完成，但未写入素材库。请在素材库页面手动重试',
          })
        }

        const hidden = localStorage.getItem('upload_success_tip_hidden')
        if (!hidden) {
          setSuccessDialogOpen(true)
        }
        return { success: true, shotCount: result.shotCount }
      } catch (err) {
        stopProgressAnimation(task.id)
        const error = err instanceof Error ? err : new Error('分析失败')
        const classifiedMsg = classifyError(error)
        logger.error(`Upload failed: ${error.message}`)

        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: 'error', errorMsg: classifiedMsg } : t,
          ),
        )
        toast.error('处理失败', { description: classifiedMsg })
        return { success: false, shotCount: null }
      }
    },
    // ⚠️ P1 修复：必须把 user 加进依赖数组。闭包内大量使用 user.name / user.role
    // 写入 x-uploader-* header，如果不订阅 user，会用过期值（管理员改角色后业务员仍按老角色分析）
    [startProgressAnimation, stopProgressAnimation, user],
  )

  // ⚠️ handleFileSelect 已在组件顶部定义（必须在 handlePickerClick 之前，避免 TDZ）

  const handleUpload = useCallback(async (): Promise<void> => {
    const waitingTasks = tasks.filter((t: UploadTask) => t.status === 'waiting')
    if (waitingTasks.length === 0) {
      toast.error('没有待上传的素材')
      return
    }
    const total = waitingTasks.length
    setIsUploading(true)
    setBatchProgress({ total, uploading: 0, done: 0, failed: 0 })

    let doneCount = 0
    let failCount = 0
    for (let i = 0; i < total; i++) {
      setBatchProgress((prev: BatchProgress | null) =>
        prev ? { ...prev, uploading: i + 1 } : null,
      )
      const result = await processFile(waitingTasks[i])
      if (result.success) {
        doneCount += 1
        setBatchProgress((prev: BatchProgress | null) =>
          prev ? { ...prev, done: doneCount } : null,
        )
      } else {
        failCount += 1
        setBatchProgress((prev: BatchProgress | null) =>
          prev ? { ...prev, failed: failCount } : null,
        )
      }
    }
    setIsUploading(false)
    setBatchProgress(null)
    if (failCount > 0) {
      toast('批量上传完成', {
        description: `成功 ${doneCount} 个，失败 ${failCount} 个`,
      })
    } else {
      toast.success(`全部 ${doneCount} 个素材上传分析完成`)
    }
  }, [tasks, processFile])

  const handleRetry = useCallback(
    async (taskId: string): Promise<void> => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'waiting', errorMsg: '', progress: 0 } : t)))
      await processFile({ ...task, status: 'waiting', progress: 0, errorMsg: '' })
    },
    [tasks, processFile],
  )

  const handleSelectAll = useCallback((): void => {
    const filtered = filteredTasks.map((t) => t.id)
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered))
    }
  }, [selectedIds, tasks, statusFilter])

  const handleToggleSelect = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleDeleteSelected = useCallback((): void => {
    const ids = Array.from(selectedIds)
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)))
    setSelectedIds(new Set())
  }, [selectedIds])

  const handleRemoveTask = useCallback((taskId: string): void => {
    stopProgressAnimation(taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }, [stopProgressAnimation])

  const handleAddTag = useCallback((taskId: string): void => {
    const tag = tagInputValue.trim()
    if (!tag) return
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, customTags: [...t.customTags, tag] }
          : t,
      ),
    )
    setTagInputValue('')
  }, [tagInputValue])

  const handleRemoveTag = useCallback((taskId: string, tag: string): void => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, customTags: t.customTags.filter((ct) => ct !== tag) }
          : t,
      ),
    )
  }, [])

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent, taskId: string): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAddTag(taskId)
      }
      if (e.key === 'Escape') {
        setTagInputTaskId(null)
        setTagInputValue('')
      }
    },
    [handleAddTag],
  )

  const handleSuccessDialogClose = useCallback((): void => {
    if (dontShowAgain) {
      localStorage.setItem('upload_success_tip_hidden', '1')
    }
    setSuccessDialogOpen(false)
    setDontShowAgain(false)
  }, [dontShowAgain])

  const filteredTasks = tasks.filter((t) => {
    if (statusFilter === 'all') return true
    return t.status === statusFilter
  })

  const statusCounts = {
    all: tasks.length,
    waiting: tasks.filter((t) => t.status === 'waiting').length,
    uploading: tasks.filter((t) => t.status === 'uploading' || t.status === 'analyzing').length,
    done: tasks.filter((t) => t.status === 'done').length,
    error: tasks.filter((t) => t.status === 'error').length,
  }

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'waiting', label: '待上传' },
    { key: 'uploading', label: '上传中' },
    { key: 'done', label: '已完成' },
    { key: 'error', label: '上传失败' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[92vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden mx-2 md:mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">上传素材</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              默认项目
              {tasks.length > 0 && (
                <span className="text-primary ml-1">/ {tasks.filter((t) => t.status === 'done').length} 已完成</span>
              )}
            </p>
          </div>
          <button
            onClick={() => window.history.back()}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Steps */}
        <div className="px-6 py-4 border-b border-border/50">
          <div className="flex items-center justify-center">
            {STEPS.map((s, i) => {
              const isActive = currentStep === s.step
              const isDone = currentStep > s.step
              return (
                <div key={s.step} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`size-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(56_182_255_0.3)]'
                          : isDone
                            ? 'bg-primary/80 text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {isDone ? <CheckCircle2 className="size-4" /> : s.step}
                    </div>
                    <span
                      className={`text-xs mt-1.5 whitespace-nowrap ${
                        isActive ? 'text-primary font-medium' : isDone ? 'text-foreground/70' : 'text-muted-foreground'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`w-16 md:w-24 h-0.5 mx-1 mt-[-1rem] ${
                        currentStep > s.step ? 'bg-primary/60' : 'bg-border'
                      }`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Upload Area */}
        <div className="px-6 py-5 border-b border-border/50">
          <button
            type="button"
            onClick={handlePickerClick}
            onDragOver={(e) => {
              // 拖拽支持：避免 macOS 系统选择器「上传」按钮变灰的 bug
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.classList.add('border-primary', 'bg-primary/5')
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.classList.remove('border-primary', 'bg-primary/5')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.classList.remove('border-primary', 'bg-primary/5')
              const files = e.dataTransfer?.files
              if (files && files.length > 0) {
                // 过滤非视频文件（避免 mp4 之外奇怪格式污染队列）
                const videoFiles = Array.from(files).filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|avi)$/i.test(f.name))
                if (videoFiles.length === 0) {
                  toast.error('请拖入视频文件（MP4 / MOV / AVI）')
                  return
                }
                handleFileSelect(videoFiles as unknown as FileList)
              }
            }}
            disabled={isUploading}
            className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-card/50 hover:bg-accent/30 transition-all disabled:opacity-50 disabled:pointer-events-none group w-full"
          >
            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
              <Upload className="size-5 text-primary" />
            </div>
            <div className="text-left min-w-0">
              <p className="text-sm font-medium text-foreground">上传素材</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                点击选择 或 <span className="text-primary font-medium">拖拽文件到此处</span>（推荐，避免 macOS 选择器按钮灰色问题）
              </p>
            </div>
          </button>

          <p className="text-xs text-muted-foreground text-center mt-3 leading-relaxed">
            视频格式：当前仅支持上传 MP4、MOV、AVI 格式，大小 &lt;500MB；时长 &lt;5 分钟
          </p>
        </div>

        {/* Batch Progress */}
        {batchProgress && (
          <div className="px-6 py-3 border-b border-border/50 bg-accent/10">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 text-primary animate-spin shrink-0" />
              <span className="text-sm text-foreground">
                正在处理 {batchProgress.uploading}/{batchProgress.total}
              </span>
              <Progress
                value={
                  batchProgress.total > 0
                    ? (batchProgress.uploading / batchProgress.total) * 100
                    : 0
                }
                className="h-1.5 flex-1 max-w-[200px]"
              />
              <span className="text-xs text-muted-foreground shrink-0">
                <span className="text-success">成功 {batchProgress.done}</span>
                {batchProgress.failed > 0 && (
                  <span className="text-destructive ml-2">
                    失败 {batchProgress.failed}
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Status Tabs */}
        <div className="px-4 md:px-6 py-3 border-b border-border/50">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0">
            <div className="flex items-center gap-1 -mx-2 px-2 md:mx-0 md:px-0 overflow-x-auto custom-scrollbar whitespace-nowrap">
              <span className="text-sm font-medium text-foreground mr-2 shrink-0">上传状态</span>
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`shrink-0 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    statusFilter === tab.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {tab.label}
                  {statusCounts[tab.key] > 0 && (
                    <span className="ml-1 opacity-70">{statusCounts[tab.key]}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="hidden md:flex items-center gap-2">
              <button
                type="button"
                className="flex items-center gap-1 px-3 py-1 rounded-md bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                添加标签
                <ChevronDown className="size-3" />
              </button>
              <button
                type="button"
                className="flex items-center gap-1 px-3 py-1 rounded-md bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                素材旋转
                <ChevronDown className="size-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar min-h-[200px]">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="size-16 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                <FileVideo className="size-8 opacity-30" />
              </div>
              <p className="text-sm">暂无数据</p>
              <p className="text-xs mt-1">点击上方上传区域选择文件</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    task.status === 'error'
                      ? 'bg-destructive/5 border border-destructive/20'
                      : task.status === 'done'
                        ? 'bg-success/5 border border-success/20'
                        : 'bg-card border border-border/40 hover:bg-accent/20'
                  }`}
                >
                  <Checkbox
                    checked={selectedIds.has(task.id)}
                    onCheckedChange={() => handleToggleSelect(task.id)}
                  />

                  <div className="size-9 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    <FileVideo className="size-4 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground truncate">{task.fileName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{task.fileSize}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {task.status === 'uploading' && (
                        <div className="flex items-center gap-2 flex-1">
                          <Progress value={task.progress} className="h-1.5 flex-1 max-w-[120px]" />
                          <span className="text-xs text-primary">{task.progress}%</span>
                        </div>
                      )}
                      {task.status === 'analyzing' && (
                        <div className="flex items-center gap-1.5 text-xs text-primary">
                          <Loader2 className="size-3 animate-spin" />
                          <span>AI 分析中...</span>
                        </div>
                      )}
                      {task.status === 'done' && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs bg-success/10 text-success border-success/20">
                            <CheckCircle2 className="size-3 mr-1" />
                            完成
                          </Badge>
                          <span className="text-xs text-muted-foreground">{task.shotCount} 分镜</span>
                          <div className="flex gap-1">
                            {task.tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {task.status === 'waiting' && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="size-3" />
                          待上传
                        </span>
                      )}
                      {task.status === 'error' && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="size-3" />
                          {task.errorMsg}
                        </span>
                      )}
                    </div>
                    {(task.customTags.length > 0 || task.status === 'waiting' || task.status === 'done') && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {task.customTags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-xs cursor-pointer hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                            onClick={() => handleRemoveTag(task.id, tag)}
                          >
                            {tag}
                            <X className="size-3 ml-1" />
                          </Badge>
                        ))}
                        {tagInputTaskId === task.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={tagInputValue}
                              onChange={(e) => setTagInputValue(e.target.value)}
                              onKeyDown={(e) => handleTagKeyDown(e, task.id)}
                              onBlur={() => {
                                if (!tagInputValue.trim()) {
                                  setTagInputTaskId(null)
                                }
                              }}
                              placeholder="输入标签"
                              className="h-6 w-20 text-xs"
                              autoFocus
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleAddTag(task.id)}
                            >
                              <Plus className="size-3" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
                            onClick={() => {
                              setTagInputTaskId(task.id)
                              setTagInputValue('')
                            }}
                          >
                            <Plus className="size-3" />
                            添加标签
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {task.status === 'error' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleRetry(task.id)}
                      >
                        <RefreshCw className="size-3 mr-1" />
                        重试
                      </Button>
                    )}
                    {task.status === 'done' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          navigate('/materials')
                        }}
                      >
                        <Eye className="size-3 mr-1" />
                        查看
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveTask(task.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Bar - sticky so 确认上传 stays visible on mobile */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between px-4 md:px-6 py-3 border-t border-border bg-card/95 backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3 min-w-0">
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <Checkbox
                checked={filteredTasks.length > 0 && selectedIds.size === filteredTasks.length}
                onCheckedChange={handleSelectAll}
              />
              <span className="text-sm text-muted-foreground hidden sm:inline">
                全选/已选 {selectedIds.size} 个
              </span>
              <span className="text-sm text-muted-foreground sm:hidden">
                {selectedIds.size}/{filteredTasks.length}
              </span>
            </label>
            {selectedIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive hidden sm:inline-flex"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="size-3 mr-1" />
                删除选中
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.history.back()}
              className="hidden sm:inline-flex"
            >
              关闭
            </Button>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={isUploading || tasks.filter((t) => t.status === 'waiting').length === 0}
            >
              {isUploading ? (
                <>
                  <Loader2 className="size-4 mr-1 animate-spin" />
                  上传中...
                </>
              ) : (
                '确认上传'
              )}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Info className="size-5 text-primary" />
              温馨提示
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-relaxed pt-1">
              素材已上传成功，该素材正在进行打标签（或分镜）处理，请稍等约30-40分钟，处理完成后即可在素材中心查看。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={dontShowAgain}
                onCheckedChange={(v) => setDontShowAgain(!!v)}
              />
              <span className="text-xs text-muted-foreground">不再提醒</span>
            </label>
            <Button onClick={handleSuccessDialogClose}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default MaterialUploadPage