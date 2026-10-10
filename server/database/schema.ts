/* eslint-disable */
/** zhongli-src database schema (PostgreSQL + Drizzle ORM)
 *
 * 12 张业务表 + 2 张参考表，覆盖全部 10 个模块：
 *   - subsidiaries                子公司/部门（生产任务授权时用）
 *   - employees                   员工（authorizations / production_tasks 关联）
 *   - materials                   主素材表（upload/feishu/relink 三来源）
 *   - materials_scenes            素材的多版本场景视频（1对多）
 *   - video_analyses              视频分析结果（与 materials 1对1）
 *   - video_shots                 分镜（与 video_analyses 1对多）
 *   - workflow_runs               工作流运行
 *   - workflow_steps              工作流步骤（与 workflow_runs 1对多）
 *   - clip_history                剪辑历史
 *   - clip_history_shots          剪辑使用的分镜（多对多关联 + in/out_point）
 *   - production_tasks            生产任务
 *   - authorizations              授权记录
 *   - iteration_items             迭代项
 *   - dashboard_kpis              仪表板 KPI 缓存
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
  customType,
} from 'drizzle-orm/pg-core';

// ──────────────────────────────────────────────────────────────────
// 自定义类型（PostgreSQL）
// ──────────────────────────────────────────────────────────────────

/** 带精度的时间戳（毫秒精度） */
export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (value === 'string') return value as any;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

/** 用户标识（来自 session/header 的 user_id） */
export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

/** 文件附件（bucket + path，飞书/云存储场景） */
export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

// 审计字段公共部分（所有业务表都带 _created_at/_created_by/_updated_at/_updated_by）
// 注意：为了 PGlite 兼容（无需注册自定义类型），_created_by/_updated_by 用 text 而非 user_profile
const auditFields = {
  createdAt: customTimestamptz('_created_at', { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: text('_created_by'),
  updatedAt: customTimestamptz('_updated_at', { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text('_updated_by'),
};

// ──────────────────────────────────────────────────────────────────
// 0. 参考表
// ──────────────────────────────────────────────────────────────────

/** 子公司/部门（生产任务、授权会用到） */
export const subsidiaries = pgTable('subsidiaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description'),
  contact: varchar('contact', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  ...auditFields,
});

/** 员工（生产任务 assignee、授权 name） */
export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 飞书 open_id / user_id */
  externalId: varchar('external_id', { length: 255 }).unique(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  subsidiaryId: uuid('subsidiary_id'),
  department: varchar('department', { length: 100 }),
  position: varchar('position', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.subsidiaryId],
    foreignColumns: [subsidiaries.id],
    name: 'employees_subsidiary_id_fkey',
  }).onDelete('set null'),
  index('employees_name_idx').on(table.name),
]);

// ──────────────────────────────────────────────────────────────────
// 1. materials - 主素材表（核心新增）
// ──────────────────────────────────────────────────────────────────

export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** business id（兼容 mock 中 "RPG202素材1-1788339076933" 这种 id） */
  businessId: varchar('business_id', { length: 255 }).unique(),
  /** 内容指纹（SHA-256 全文哈希）。用于飞书去重匹配，避免重复 AI 分析 */
  fileHash: varchar('file_hash', { length: 64 }),
  /** product | scene | reference */
  type: varchar('type', { length: 20 }).notNull().default('product'),
  productName: varchar('product_name', { length: 255 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  /** 本地路径 /tmp/zhongli-videos/upload_xxx.mp4 */
  filePath: varchar('file_path', { length: 500 }).notNull(),
  /** 可直接播放的 URL（file:// 转 http 后的） */
  playableUrl: varchar('playable_url', { length: 500 }),
  thumbnailUrl: varchar('thumbnail_url', { length: 500 }),
  industry: varchar('industry', { length: 100 }),
  brand: varchar('brand', { length: 255 }),
  department: varchar('department', { length: 100 }),
  clientName: varchar('client_name', { length: 255 }),
  /** 优质 | 首发 | 普通 */
  quality: varchar('quality', { length: 50 }),
  /** 员工姓名（来自飞书分镜表的「人物姓名（如果有）」列，AI 识别人物后回填） */
  personName: varchar('person_name', { length: 100 }),
  /** pending | analyzing | done | failed */
  analysisStatus: varchar('analysis_status', { length: 50 }).notNull().default('pending'),
  totalDuration: doublePrecision('total_duration'),
  shotCount: integer('shot_count').notNull().default(0),
  /** 卖点标签数组 */
  sellingPointTags: jsonb('selling_point_tags').notNull().default(sql`'[]'::jsonb`),
  sceneVideoCount: integer('scene_video_count').notNull().default(0),
  /** 多版本场景视频 URL 数组 */
  sceneVideoUrls: jsonb('scene_video_urls').notNull().default(sql`'[]'::jsonb`),
  usageCount: integer('usage_count').notNull().default(0),
  consumptionCount: integer('consumption_count').notNull().default(0),
  /** upload | feishu | relink */
  source: varchar('source', { length: 50 }).notNull().default('upload'),
  /** 飞书表格 record_id（用于双向同步） */
  feishuRecordId: varchar('feishu_record_id', { length: 100 }),
  description: text('description'),
  ...auditFields,
}, (table) => [
  index('materials_product_name_idx').on(table.productName),
  index('materials_industry_idx').on(table.industry),
  index('materials_analysis_status_idx').on(table.analysisStatus),
  index('materials_source_idx').on(table.source),
  index('materials_created_at_idx').on(table.createdAt),
  index('materials_person_name_idx').on(table.personName),
]);

/** 素材的多版本场景视频（1对多） */
export const materialsScenes = pgTable('materials_scenes', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id').notNull(),
  sceneIndex: integer('scene_index').notNull(),
  videoUrl: varchar('video_url', { length: 500 }).notNull(),
  filePath: varchar('file_path', { length: 500 }),
  duration: doublePrecision('duration'),
  isPrimary: boolean('is_primary').notNull().default(false),
  description: text('description'),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [materials.id],
    name: 'materials_scenes_material_id_fkey',
  }).onDelete('cascade'),
  uniqueIndex('materials_scenes_material_id_scene_index_key').on(table.materialId, table.sceneIndex),
]);

// ──────────────────────────────────────────────────────────────────
// 2. video_analyses - 视频分析（与 materials 1对1）
// ──────────────────────────────────────────────────────────────────

export const videoAnalyses = pgTable('video_analyses', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 关联到 materials.id（核心关联，1对1） */
  materialId: uuid('material_id'),
  videoUrl: varchar('video_url', { length: 500 }).notNull(),
  videoName: varchar('video_name', { length: 255 }),
  productModel: varchar('product_model', { length: 255 }),
  productName: varchar('product_name', { length: 255 }),
  thumbnailUrl: varchar('thumbnail_url', { length: 500 }),
  totalDuration: doublePrecision('total_duration'),
  shotCount: integer('shot_count'),
  sceneVideoCount: integer('scene_video_count').notNull().default(0),
  sceneVideoUrls: jsonb('scene_video_urls').notNull().default(sql`'[]'::jsonb`),
  industry: varchar('industry', { length: 100 }),
  clientName: varchar('client_name', { length: 255 }),
  department: varchar('department', { length: 100 }),
  sellingPointTags: jsonb('selling_point_tags').notNull().default(sql`'[]'::jsonb`),
  /** @type { tags: string[] } */
  categoryTags: jsonb('category_tags').notNull().default(sql`'[]'::jsonb`),
  quality: varchar('quality', { length: 50 }),
  filePath: varchar('file_path', { length: 500 }),
  /** pending | analyzing | done | failed */
  analysisStatus: varchar('analysis_status', { length: 50 }).notNull().default('pending'),
  description: text('description'),
  type: varchar('type', { length: 20 }).notNull().default('product'),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [materials.id],
    name: 'video_analyses_material_id_fkey',
  }).onDelete('set null'),
  uniqueIndex('video_analyses_material_id_key').on(table.materialId),
  index('video_analyses_product_model_idx').on(table.productModel),
  index('video_analyses_industry_idx').on(table.industry),
]);

// ──────────────────────────────────────────────────────────────────
// 3. video_shots - 分镜（与 video_analyses 1对多）
// ──────────────────────────────────────────────────────────────────

export const videoShots = pgTable('video_shots', {
  id: uuid('id').primaryKey().defaultRandom(),
  analysisId: uuid('analysis_id').notNull(),
  /** 业务 ID（兼容 mock 中 "shot_1788330089328_0"） */
  shotId: varchar('shot_id', { length: 100 }),
  /** 分镜序号（同一 analysisId 内唯一） */
  shotIndex: integer('shot_index').notNull(),
  startTime: doublePrecision('start_time').notNull(),
  endTime: doublePrecision('end_time').notNull(),
  duration: doublePrecision('duration'),
  description: text('description'),
  scene: varchar('scene', { length: 100 }),
  objects: varchar('objects', { length: 255 }),
  action: text('action'),
  camera: varchar('camera', { length: 100 }),
  coreSellingPoint: varchar('core_selling_point', { length: 255 }),
  sellingPoint: varchar('selling_point', { length: 255 }),
  narrationText: text('narration_text'),
  keyframePath: varchar('keyframe_path', { length: 500 }),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.analysisId],
    foreignColumns: [videoAnalyses.id],
    name: 'video_shots_analysis_id_fkey',
  }).onDelete('cascade'),
  uniqueIndex('video_shots_analysis_id_shot_index_key').on(table.analysisId, table.shotIndex),
  uniqueIndex('video_shots_shot_id_key').on(table.shotId),
]);

// ──────────────────────────────────────────────────────────────────
// 4. workflow_runs + workflow_steps - 工作流运行 + 步骤
// ──────────────────────────────────────────────────────────────────

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: varchar('run_id', { length: 100 }).unique(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  productDescription: text('product_description').notNull(),
  employeeName: varchar('employee_name', { length: 100 }).notNull(),
  employeeId: varchar('employee_id', { length: 100 }).notNull(),
  scriptContent: text('script_content'),
  keyframeUrls: jsonb('keyframe_urls').notNull().default(sql`'[]'::jsonb`),
  audioUrl: varchar('audio_url', { length: 500 }),
  /** running | completed | failed */
  status: varchar('status', { length: 50 }).notNull().default('completed'),
  videoUrl: varchar('video_url', { length: 500 }),
  errorMessage: text('error_message'),
  startedAt: customTimestamptz('started_at', { precision: 3 }),
  finishedAt: customTimestamptz('finished_at', { precision: 3 }),
  ...auditFields,
}, (table) => [
  index('workflow_runs_status_idx').on(table.status),
  index('workflow_runs_employee_idx').on(table.employeeName),
  index('workflow_runs_created_at_idx').on(table.createdAt),
]);

/** 工作流步骤（与 workflow_runs 1对多，支持步骤级重试/追踪） */
export const workflowSteps = pgTable('workflow_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull(),
  stepIndex: integer('step_index').notNull(),
  /** script | analyze | match-shots | tts | clip | concat | upload */
  stepName: varchar('step_name', { length: 50 }).notNull(),
  /** pending | running | done | failed | skipped */
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  inputJson: jsonb('input_json').notNull().default(sql`'{}'::jsonb`),
  outputJson: jsonb('output_json').notNull().default(sql`'{}'::jsonb`),
  errorMessage: text('error_message'),
  startedAt: customTimestamptz('started_at', { precision: 3 }),
  finishedAt: customTimestamptz('finished_at', { precision: 3 }),
  durationMs: integer('duration_ms'),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.runId],
    foreignColumns: [workflowRuns.id],
    name: 'workflow_steps_run_id_fkey',
  }).onDelete('cascade'),
  uniqueIndex('workflow_steps_run_id_step_index_key').on(table.runId, table.stepIndex),
  index('workflow_steps_status_idx').on(table.status),
]);

// ──────────────────────────────────────────────────────────────────
// 5. clip_history + clip_history_shots - 剪辑历史 + 分镜关联
// ──────────────────────────────────────────────────────────────────

export const clipHistory = pgTable('clip_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  requirement: text('requirement'),
  duration: integer('duration'),
  scriptContent: text('script_content'),
  videoUrl: varchar('video_url', { length: 500 }),
  /** 成片最终地址（与 videoUrl 区分：videoUrl 是请求，outputVideoUrl 是结果） */
  outputVideoUrl: varchar('output_video_url', { length: 500 }),
  outputDuration: doublePrecision('output_duration'),
  /** 关联素材 */
  materialId: uuid('material_id'),
  /** 关联工作流 */
  workflowRunId: uuid('workflow_run_id'),
  shotIds: jsonb('shot_ids').notNull().default(sql`'[]'::jsonb`),
  category: varchar('category', { length: 100 }),
  /** running | completed | failed */
  status: varchar('status', { length: 50 }).notNull().default('completed'),
  employeeName: varchar('employee_name', { length: 100 }),
  employeeId: varchar('employee_id', { length: 100 }),
  errorMessage: text('error_message'),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [materials.id],
    name: 'clip_history_material_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.workflowRunId],
    foreignColumns: [workflowRuns.id],
    name: 'clip_history_workflow_run_id_fkey',
  }).onDelete('set null'),
  index('clip_history_status_idx').on(table.status),
  index('clip_history_category_idx').on(table.category),
  index('clip_history_employee_idx').on(table.employeeName),
]);

/** 剪辑使用的分镜（多对多 + 时间点） */
export const clipHistoryShots = pgTable('clip_history_shots', {
  id: uuid('id').primaryKey().defaultRandom(),
  clipHistoryId: uuid('clip_history_id').notNull(),
  shotId: uuid('shot_id').notNull(),
  shotIndex: integer('shot_index').notNull(),
  inPoint: doublePrecision('in_point'),
  outPoint: doublePrecision('out_point'),
  durationMs: integer('duration_ms'),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.clipHistoryId],
    foreignColumns: [clipHistory.id],
    name: 'clip_history_shots_clip_history_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.shotId],
    foreignColumns: [videoShots.id],
    name: 'clip_history_shots_shot_id_fkey',
  }).onDelete('cascade'),
  uniqueIndex('clip_history_shots_clip_id_shot_id_key').on(table.clipHistoryId, table.shotId),
]);

// ──────────────────────────────────────────────────────────────────
// 6. production_tasks - 生产任务
// ──────────────────────────────────────────────────────────────────

export const productionTasks = pgTable('production_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 业务 ID（兼容 mock 中 task_t_xxx） */
  taskId: varchar('task_id', { length: 100 }).unique(),
  title: varchar('title', { length: 255 }).notNull(),
  /** scripting | approved | producing | published | archived */
  status: varchar('status', { length: 50 }).notNull().default('scripting'),
  /** low | medium | high | urgent */
  priority: varchar('priority', { length: 20 }).notNull().default('medium'),
  assignee: varchar('assignee', { length: 100 }).notNull(),
  /** subsidiary | employee | external */
  assigneeType: varchar('assignee_type', { length: 50 }).notNull().default('subsidiary'),
  /** 关联到子公司/部门 */
  subsidiaryId: uuid('subsidiary_id'),
  /** 关联到员工 */
  assigneeEmployeeId: uuid('assignee_employee_id'),
  productName: varchar('product_name', { length: 255 }).notNull(),
  /** 关联素材 */
  materialId: uuid('material_id'),
  /** 关联剪辑产出 */
  clipHistoryId: uuid('clip_history_id'),
  /** 关联工作流 */
  workflowRunId: uuid('workflow_run_id'),
  scriptContent: text('script_content'),
  videoUrl: varchar('video_url', { length: 500 }),
  publishAccount: varchar('publish_account', { length: 255 }),
  dueDate: date('due_date'),
  description: text('description'),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.subsidiaryId],
    foreignColumns: [subsidiaries.id],
    name: 'production_tasks_subsidiary_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.assigneeEmployeeId],
    foreignColumns: [employees.id],
    name: 'production_tasks_assignee_employee_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [materials.id],
    name: 'production_tasks_material_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.clipHistoryId],
    foreignColumns: [clipHistory.id],
    name: 'production_tasks_clip_history_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.workflowRunId],
    foreignColumns: [workflowRuns.id],
    name: 'production_tasks_workflow_run_id_fkey',
  }).onDelete('set null'),
  index('production_tasks_status_idx').on(table.status),
  index('production_tasks_priority_idx').on(table.priority),
  index('production_tasks_assignee_idx').on(table.assignee),
  index('production_tasks_due_date_idx').on(table.dueDate),
]);

// ──────────────────────────────────────────────────────────────────
// 7. authorizations - 授权记录
// ──────────────────────────────────────────────────────────────────

export const authorizations = pgTable('authorizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  /** employee | subsidiary | external */
  type: varchar('type', { length: 50 }).notNull().default('employee'),
  /** pending | active | inactive | expired | revoked */
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  /** free | paid | trial | internal */
  method: varchar('method', { length: 50 }).notNull().default('free'),
  amount: integer('amount').notNull().default(0),
  authorizedDate: varchar('authorized_date', { length: 50 }),
  expiryDate: varchar('expiry_date', { length: 50 }),
  contact: varchar('contact', { length: 100 }),
  /** 谁授权的（员工名 / 系统） */
  authorizedBy: varchar('authorized_by', { length: 100 }),
  /** 关联员工 */
  employeeId: uuid('employee_id'),
  /** 关联子公司 */
  subsidiaryId: uuid('subsidiary_id'),
  /** 关联素材（可空：单独授权也可以） */
  materialId: uuid('material_id'),
  remarks: text('remarks'),
  /** 授权书扫描件 */
  documentUrl: varchar('document_url', { length: 500 }),
  ...auditFields,
}, (table) => [
  foreignKey({
    columns: [table.employeeId],
    foreignColumns: [employees.id],
    name: 'authorizations_employee_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.subsidiaryId],
    foreignColumns: [subsidiaries.id],
    name: 'authorizations_subsidiary_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [materials.id],
    name: 'authorizations_material_id_fkey',
  }).onDelete('set null'),
  index('authorizations_status_idx').on(table.status),
  index('authorizations_type_idx').on(table.type),
  index('authorizations_expiry_idx').on(table.expiryDate),
]);

// ──────────────────────────────────────────────────────────────────
// 8. iteration_items - 迭代项
// ──────────────────────────────────────────────────────────────────

export const iterationItems = pgTable('iteration_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** bug | feature | improvement | content */
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
  /** low | medium | high | urgent */
  priority: varchar('priority', { length: 20 }),
  source: varchar('source', { length: 50 }),
  relatedTag: varchar('related_tag', { length: 255 }),
  ...auditFields,
}, (table) => [
  index('iteration_items_type_idx').on(table.type),
  index('iteration_items_priority_idx').on(table.priority),
]);

// ──────────────────────────────────────────────────────────────────
// 9. dashboard_kpis - 仪表板 KPI 缓存
// ──────────────────────────────────────────────────────────────────

export const dashboardKpis = pgTable('dashboard_kpis', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 缓存日期（每天一条最新） */
  snapshotDate: date('snapshot_date').notNull().default(sql`CURRENT_DATE`),
  kpiData: jsonb('kpi_data').notNull().default(sql`'{}'::jsonb`),
  salesTrend: jsonb('sales_trend').notNull().default(sql`'[]'::jsonb`),
  videoKpis: jsonb('video_kpis').notNull().default(sql`'[]'::jsonb`),
  videoTrend: jsonb('video_trend').notNull().default(sql`'[]'::jsonb`),
  ...auditFields,
}, (table) => [
  uniqueIndex('dashboard_kpis_snapshot_date_key').on(table.snapshotDate),
]);

// ──────────────────────────────────────────────────────────────────
// 表别名导出（供 NestJS module 引用）
// ──────────────────────────────────────────────────────────────────

export const subsidiariesTable = subsidiaries;
export const employeesTable = employees;
export const materialsTable = materials;
export const materialsScenesTable = materialsScenes;
export const videoAnalysesTable = videoAnalyses;
export const videoShotsTable = videoShots;
export const workflowRunsTable = workflowRuns;
export const workflowStepsTable = workflowSteps;
export const clipHistoryTable = clipHistory;
export const clipHistoryShotsTable = clipHistoryShots;
export const productionTasksTable = productionTasks;
export const authorizationsTable = authorizations;
export const iterationItemsTable = iterationItems;
export const dashboardKpisTable = dashboardKpis;

// ──────────────────────────────────────────────────────────────────
// 10. monitored_authors - 监控作者（视频号/抖音等外部 KOL）
// ──────────────────────────────────────────────────────────────────

/**
 * 一条 = 一个外部作者主页。
 * MVP 仅支持 wechat_video（视频号），但 platform 字段预留扩展空间。
 */
export const monitoredAuthors = pgTable('monitored_authors', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** wechat_video | douyin | kuaishou | xiaohongshu */
  platform: varchar('platform', { length: 50 }).notNull().default('wechat_video'),
  /** 作者昵称（用户手动填或爬取得到） */
  authorName: varchar('author_name', { length: 255 }).notNull(),
  /** 作者主页链接 / 个人名片链接 */
  authorUrl: text('author_url'),
  /** 作者头像 URL */
  avatarUrl: text('avatar_url'),
  /** 平台内唯一 ID（视频号 finderUsername / 抖音 sec_uid 等） */
  platformAuthorId: varchar('platform_author_id', { length: 255 }),
  /** 最近一次抓取时的粉丝数 */
  followerCount: integer('follower_count').default(0),
  /** 最近一次抓取时的总视频数 */
  totalVideos: integer('total_videos').default(0),
  /** 最近一次抓取完成时间 */
  lastCrawlAt: customTimestamptz('last_crawl_at', { precision: 3 }),
  /** 最近一次抓取结果摘要 */
  lastCrawlStatus: varchar('last_crawl_status', { length: 50 }),
  lastCrawlMessage: text('last_crawl_message'),
  /** active | paused */
  status: varchar('status', { length: 20 }).notNull().default('active'),
  notes: text('notes'),
  ...auditFields,
}, (table) => [
  index('monitored_authors_platform_idx').on(table.platform),
  index('monitored_authors_status_idx').on(table.status),
]);

// ──────────────────────────────────────────────────────────────────
// 11. monitored_videos - 作者的监控视频
// ──────────────────────────────────────────────────────────────────

/**
 * 一条 = 一条已加入监控的外部视频（由用户粘贴链接 / 抓取器发现而来）。
 * 每次抓取会刷新 engagement stats；crawl_history 存时间序列用于趋势展示。
 */
export const monitoredVideos = pgTable('monitored_videos', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull().references(() => monitoredAuthors.id, { onDelete: 'cascade' }),
  /** 平台内唯一视频 ID（如视频号 exportId） */
  platformVideoId: varchar('platform_video_id', { length: 255 }),
  title: text('title'),
  coverUrl: text('cover_url'),
  /** 视频可访问的 URL（视频号短链或解析后的真实 URL） */
  videoUrl: text('video_url').notNull(),
  /** 发布时间（毫秒时间戳） */
  publishTimeMs: integer('publish_time_ms'),
  /** 当前播放量 */
  playCount: integer('play_count').default(0),
  /** 当前点赞数 */
  likeCount: integer('like_count').default(0),
  /** 当前评论数 */
  commentCount: integer('comment_count').default(0),
  /** 当前分享数 */
  shareCount: integer('share_count').default(0),
  /** 抓取历史 [{at: ms, play, like, comment, share}] 用于画趋势图 */
  crawlHistory: jsonb('crawl_history').notNull().default(sql`'[]'::jsonb`),
  /** new | imported | ignored | failed */
  status: varchar('status', { length: 20 }).notNull().default('new'),
  /** 入库到主素材库后回填的 material_id（关联 materials.id） */
  importedMaterialId: uuid('imported_material_id'),
  /** 入库时间 */
  importedAt: customTimestamptz('imported_at', { precision: 3 }),
  /** 最后一次抓取时间 */
  lastCrawledAt: customTimestamptz('last_crawled_at', { precision: 3 }),
  ...auditFields,
}, (table) => [
  index('monitored_videos_author_idx').on(table.authorId),
  index('monitored_videos_status_idx').on(table.status),
  uniqueIndex('monitored_videos_author_url_key').on(table.authorId, table.videoUrl),
]);

// ──────────────────────────────────────────────────────────────────
// 12. monitor_jobs - 抓取调度
// ──────────────────────────────────────────────────────────────────

/**
 * 一条 = 一个作者的 cron 调度。
 * 一个作者可以多个 job（多 cron），但 MVP 默认 1 个。
 */
export const monitorJobs = pgTable('monitor_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull().references(() => monitoredAuthors.id, { onDelete: 'cascade' }),
  /** 标准 5 段 cron 表达式，如 '0 9 * * *' */
  cronExpression: varchar('cron_expression', { length: 100 }).notNull().default('0 9 * * *'),
  enabled: boolean('enabled').notNull().default(true),
  /** 调度器注册时返回的任务引用（重启后失效，重新注册即可） */
  runtimeTaskId: varchar('runtime_task_id', { length: 100 }),
  lastRunAt: customTimestamptz('last_run_at', { precision: 3 }),
  /** success | failed | running */
  lastRunStatus: varchar('last_run_status', { length: 20 }),
  lastRunMessage: text('last_run_message'),
  nextRunAt: customTimestamptz('next_run_at', { precision: 3 }),
  ...auditFields,
}, (table) => [
  index('monitor_jobs_author_idx').on(table.authorId),
  index('monitor_jobs_enabled_idx').on(table.enabled),
]);

// ──────────────────────────────────────────────────────────────────
// 13. notifications - 站内通知
// ──────────────────────────────────────────────────────────────────

/**
 * 通用通知表。当前用于：新视频被检测到 / 入库失败 / 抓取任务失败 等。
 * MVP 仅 admin 角色接收。可扩展 user_id 字段做定向通知。
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 接收方角色：admin | operator | user */
  recipientRole: varchar('recipient_role', { length: 50 }).notNull().default('admin'),
  /** new_video | crawl_failed | import_failed */
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  body: text('body'),
  /** 关联作者 */
  refAuthorId: uuid('ref_author_id').references(() => monitoredAuthors.id, { onDelete: 'set null' }),
  /** 关联监控视频 */
  refVideoId: uuid('ref_video_id').references(() => monitoredVideos.id, { onDelete: 'set null' }),
  readAt: customTimestamptz('read_at', { precision: 3 }),
  ...auditFields,
}, (table) => [
  index('notifications_recipient_idx').on(table.recipientRole, table.readAt),
  index('notifications_type_idx').on(table.type),
]);

export const monitoredAuthorsTable = monitoredAuthors;
export const monitoredVideosTable = monitoredVideos;
export const monitorJobsTable = monitorJobs;
export const notificationsTable = notifications;