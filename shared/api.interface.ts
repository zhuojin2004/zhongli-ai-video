export interface ProductionTask {
  id: string
  productName: string
  script: string
  status: '待脚本' | '待审核' | '已审核' | '已打标' | '已混剪' | '已发布' | '迭代中'
  assignee: string
  assigneeAvatar: string
  tags: string[]
  videoUrl: string
  keyframes: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateProductionTaskDto {
  title: string
  assignee: string
  assigneeType: string
  productName: string
}

/* ── 用户与登录 ─────────────────────────────────────────────────────── */

export type UserRole = 'operator' | 'user' | 'admin'
/** 中文标签：业务员 / 运营 / 管理员 */
export const USER_ROLE_LABEL: Record<UserRole, string> = {
  operator: '运营',
  user: '业务员',
  admin: '管理员',
}

export interface User {
  /** 飞书 record_id */
  id: string
  username: string
  /** 真实姓名（用于素材库「人物姓名」匹配） */
  name: string
  role: UserRole
  createdAt?: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  user: User
}

export interface CreateUserDto {
  username: string
  password: string
  name: string
  role: UserRole
}

export interface UpdateUserDto {
  password?: string
  name?: string
  role?: UserRole
}

export interface UpdateProductionTaskDto {
  status?: string
  title?: string
  scriptContent?: string
  videoUrl?: string
  publishAccount?: string
}

export interface ProductionTaskListQuery {
  status?: string
}

export interface WorkflowRun {
  id: string
  productName: string
  productDescription: string
  employeeName: string
  employeeId: string
  scriptContent: string
  keyframeUrls: string[]
  audioUrl: string
  videoUrl: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface CreateWorkflowRunDto {
  productName: string
  productDescription: string
  employeeName: string
  employeeId: string
  scriptContent: string
  keyframeUrls: string[]
  audioUrl: string
  videoUrl: string
  status: string
}

export interface AnalyzeVideoRequest {
  downloadUrl: string
  filePath?: string
  /** OSS 公开 URL（HTTPS）：给 MiniMax-M3 直接分析用，省去 Files API 上传 */
  ossUrl?: string
  /** 上传者角色：'user' (业务员) → 不用 AI 分析「人物姓名」；'operator'/'admin' → 让 AI 识别 */
  uploaderRole?: UserRole
  /** 上传者姓名（用于主表 人物标签 回填） */
  uploaderName?: string
}

export interface ShotAnalysisResult {
  startTime: number
  endTime: number
  description: string
  scene: string
  objects: string
  action: string
  camera: string
  coreSellingPoint: string
  narrationText: string
}

export interface AnalyzeVideoResponse {
  id: string
  productModel: string
  totalDuration: number
  shotCount: number
  shots: ShotAnalysisResult[]
  industry?: string
  clientName?: string
  department?: string
  categoryTags?: string[]
  quality?: string
  videoName?: string
  videoUrl?: string
  filePath?: string
  createdAt: string
  updatedAt: string
}

export interface VideoAnalysisRecord {
  id: string
  videoUrl: string
  videoName: string
  productModel: string
  totalDuration: number
  shotCount: number
  industry: string
  clientName: string
  department: string
  categoryTags: string[]
  quality: string
  filePath?: string
  createdAt: string
  updatedAt: string
}

export interface VideoShot {
  id: string
  /** 飞书 record_id（双向关联用） */
  shotId?: string
  /** 飞书 record_id（用于 PATCH/同步到飞书表的唯一 key） */
  recordId?: string
  analysisId: string
  startTime: number
  endTime: number
  description: string
  scene: string
  objects: string
  action: string
  camera: string
  coreSellingPoint: string
  narrationText: string
  /** 产品型号（来自飞书·分镜任务库·产品型号字段，UI 第一眼可见） */
  productModel?: string
  /** 人物姓名（来自飞书·分镜任务库·人物姓名（如果有）字段，仅在该字段有数据时使用） */
  personName?: string
  createdAt: string
  updatedAt: string
}

export interface CreateVideoShotDto {
  analysisId: string
  startTime: number
  endTime: number
  description?: string
  scene?: string
  objects?: string
  action?: string
  camera?: string
  coreSellingPoint?: string
  narrationText?: string
}

export interface UpdateVideoShotDto {
  startTime?: number
  endTime?: number
  description?: string
  scene?: string
  objects?: string
  action?: string
  camera?: string
  coreSellingPoint?: string
  narrationText?: string
}

export interface UpdateWorkflowRunDto {
  scriptContent?: string
  videoUrl?: string
  status?: string
  keyframeUrls?: string[]
  audioUrl?: string
}

export interface DashboardKpi {
  id: string
  label: string
  value: number
  unit: string
  trend: 'up' | 'down' | 'warning'
  highlight: boolean
}

export interface PipelineStage {
  id: string
  name: string
  count: number
  status: 'normal' | 'warning' | 'overdue'
}

export interface RecentContent {
  id: string
  accountName: string
  accountType: string
  contentTitle: string
  publishTime: string
  views: number
  likes: number
  comments: number
}

export interface DailyPublishStats {
  totalInternal: number
  todayInternal: number
  totalDealer: number
  todayDealer: number
}

export interface SalesTrendPoint {
  date: string
  target: number
  actual: number
}

export interface VideoKpi {
  id: string
  label: string
  value: number
  unit: string
  trend: 'up' | 'down' | 'warning'
  highlight: boolean
}

export interface VideoTrendPoint {
  date: string
  views: number
  likes: number
}

export interface DashboardData {
  kpis: DashboardKpi[]
  pipelineStages: PipelineStage[]
  recentContents: RecentContent[]
  dailyPublish: DailyPublishStats
  salesTrend: SalesTrendPoint[]
  videoKpis: VideoKpi[]
  videoTrend: VideoTrendPoint[]
}

export interface IterationItem {
  id: string
  type: 'hot_tag' | 'competitor' | 'dealer_case' | 'suggestion'
  title: string
  description: string
  meta: Record<string, unknown>
  priority: string
  source: string
  relatedTag: string
  createdAt: string
}

export interface IterationData {
  hotTags: { id: string; name: string; count: number }[]
  competitors: {
    id: string
    title: string
    competitorName: string
    views: number
    likes: number
    takeaway: string
    videoUrl: string
  }[]
  dealerCases: {
    id: string
    dealerName: string
    region: string
    title: string
    views: number
    likes: number
    shares: number
    reusablePattern: string
    videoUrl: string
  }[]
  suggestions: {
    id: string
    title: string
    description: string
    priority: 'high' | 'medium' | 'low'
    source: 'hot-tag' | 'competitor' | 'dealer' | 'ai'
    relatedTag: string
  }[]
}

export interface AuthorizationRecord {
  id: string
  name: string
  type: 'employee' | 'dealer'
  status: 'authorized' | 'pending' | 'expired'
  method: 'free' | 'paid'
  amount: number
  authorizedDate: string
  expiryDate: string
  contact: string
  createdAt: string
}

export interface CreateAuthorizationDto {
  name: string
  type: 'employee' | 'dealer'
  method: 'free' | 'paid'
  amount: number
  contact: string
}

export interface UpdateAuthorizationDto {
  status?: 'authorized' | 'pending' | 'expired'
  amount?: number
  authorizedDate?: string
  expiryDate?: string
}

export interface MaterialItem {
  id: string
  /** UUID 主键（来自 DB） */
  dbId?: string
  type: 'employee' | 'product'
  videoUrl: string
  videoName: string
  productModel: string
  productName?: string
  totalDuration: number
  shotCount: number
  sceneVideoCount?: number
  industry: string
  clientName: string
  department: string
  /** 卖点标签（来自飞书 / DB） */
  sellingPointTags?: string[]
  categoryTags: string[]
  quality: string
  /** 品牌 */
  brand?: string
  /** 文件名（原始） */
  fileName?: string
  /** 本地路径 */
  filePath?: string
  /** 可播放 URL（http://localhost:9099/api/video/file/xxx） */
  playableUrl?: string
  /** 缩略图 URL */
  thumbnailUrl?: string
  /** 来源：upload / feishu / relink */
  source?: string
  /** 飞书 record_id（用于双向同步） */
  feishuRecordId?: string
  /** SHA-256 全文哈希（用于飞书去重匹配，避免重复 AI 分析） */
  fileHash?: string
  /** 描述 */
  description?: string
  /** 使用次数 */
  usageCount?: number
  /** 消费次数 */
  consumptionCount?: number
  /** 分析状态 */
  analysisStatus?: string
  /** 员工/人物姓名（来自飞书分镜表的「人物姓名（如果有）」列） */
  personName?: string
  /** 该素材下的分镜列表（视频详情接口返回） */
  shots?: VideoShot[]
  createdAt: string
  updatedAt?: string
}

export interface CreateMaterialDto {
  type: 'employee' | 'product'
  videoUrl: string
  videoName?: string
  productModel?: string
  productName?: string
  totalDuration?: number
  shotCount?: number
  industry?: string
  clientName?: string
  department?: string
  categoryTags?: string[]
  sellingPointTags?: string[]
  quality?: string
  brand?: string
  description?: string
  filePath?: string
}

export interface UpdateMaterialDto {
  categoryTags?: string[]
  quality?: string
}

export interface BatchAnalyzeRequest {
  downloadUrls: string[]
}

export interface BatchAnalyzeItem {
  downloadUrl: string
  success: boolean
  result?: AnalyzeVideoResponse
  error?: string
}

export interface BatchAnalyzeResponse {
  results: BatchAnalyzeItem[]
}

export interface ImportShotDto {
  startTime: number
  endTime: number
  description?: string
  scene?: string
  objects?: string
  action?: string
  camera?: string
  coreSellingPoint?: string
  narrationText?: string
}

export interface ImportMaterialDto {
  type?: 'employee' | 'product'
  videoName: string
  videoUrl?: string
  productModel?: string
  totalDuration?: number
  shotCount?: number
  industry?: string
  clientName?: string
  department?: string
  categoryTags?: string[]
  quality?: string
  shots: ImportShotDto[]
}

export interface ImportMaterialRequest {
  materials: ImportMaterialDto[]
}

export interface MatchShotsRequest {
  scriptSegments: { text: string }[]
  duration: number
  segmentCount: number
}

export interface ShotCandidate {
  shot: VideoShot
  score: number
  shotDuration: number
}

export interface MatchShotsResponse {
  segments: {
    text: string
    candidates: ShotCandidate[]
  }[]
  /** LLM 精排命中的段数 */
  llmMatchedCount?: number
  /** 因 LLM 失败/超时降级为关键词打分的段数 */
  degradedCount?: number
  /** 参与匹配的飞书分镜总数（用于进度展示） */
  candidatePoolSize?: number
}

/**
 * SSE 流式事件：start —— 后端已接收请求，开始预处理
 */
export interface MatchShotsStartEvent {
  total: number
  productName: string
}

/**
 * SSE 流式事件：progress —— 中间进度（feishu 加载 / 候选池就绪 / 每段开始）
 */
export interface MatchShotsProgressEvent {
  stage: 'feishu_loaded' | 'candidates_ready' | 'segment_start'
  loaded?: number
  totalCandidates?: number
  idx?: number
  hint?: string
  candidatesCount?: number
}

/**
 * SSE 流式事件：segment —— 某一段分镜匹配完成
 */
export interface MatchShotsSegmentEvent {
  idx: number
  text: string
  candidates: ShotCandidate[]
  llmMatched: boolean
  degraded: boolean
  /** LLM 给的最佳候选的理由（前端可展示给用户） */
  bestReason: string
}

/**
 * SSE 流式事件：done —— 全部完成汇总
 */
export interface MatchShotsDoneEvent {
  llmMatchedCount: number
  degradedCount: number
  candidatePoolSize: number
  total: number
}

export interface ClipHistoryItem {
  id: string
  title: string
  requirement: string
  duration: number
  scriptContent: string
  videoUrl: string
  shotIds: string[]
  category: string
  status: string
  employeeName?: string
  employeeId?: string
  createdAt: string
  updatedAt: string
}

export interface CreateClipHistoryDto {
  title: string
  requirement: string
  duration: number
  scriptContent: string
  videoUrl: string
  shotIds: string[]
  category: string
  employeeName?: string
  employeeId?: string
}

export interface ClipHistoryListQuery {
  category?: string
}

export interface ShotClipItem {
  shotId?: string
  url: string
  startTime: number
  endTime: number
  narrationText?: string
}

export interface ClipShotRequest {
  script?: string
  duration?: number
  shots: ShotClipItem[]
}