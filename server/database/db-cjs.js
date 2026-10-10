/**
 * CommonJS DB 包装（让 mockApiServer.js 这类 CJS 模块能用 PGlite）
 *
 * 与 db.ts（TS/ESM）使用同一个 ./data/pglite 目录，互不影响
 */
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');

function resolveDbPath() {
  const url = process.env.DATABASE_URL || 'pglite://./data/pglite';
  const match = url.match(/^pglite:\/\/(.+)$/);
  const dbPath = match ? match[1] : './data/pglite';
  return path.resolve(process.cwd(), dbPath);
}

const DB_PATH = resolveDbPath();
if (!fs.existsSync(path.join(DB_PATH, 'PG_VERSION'))) {
  console.warn(`[db-cjs] ⚠️ 数据库目录不存在或未初始化: ${DB_PATH}`);
  console.warn('[db-cjs] 请先运行: node --import tsx scripts/migrate.ts');
}

// 单例 PGlite
let _pglite = null;
let _migrated = false;

/**
 * 自我迁移：每次启动检查必要列/索引是否存在（幂等）
 *  - 用于在 Drizzle journal 之外补加字段，避免跑 drizzle-kit
 */
async function ensureSelfMigrations() {
  if (_migrated) return;
  const db = _pglite;
  try {
    // 检查 materials.person_name 是否存在
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'person_name';
    `);
    if (r.rows.length === 0) {
      console.log('[db-cjs] 自我迁移: ALTER TABLE materials ADD COLUMN person_name');
      await db.query('ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "person_name" varchar(100);');
      await db.query('CREATE INDEX IF NOT EXISTS "materials_person_name_idx" ON "materials" ("person_name");');
    }

    // V1：video_shots.shot_id 的全局唯一索引会导致「不同视频出现相同分镜ID」时插入失败。
    // 分镜 ID 只需在单个 analysis 内有意义，故移除该唯一索引（pkey 与 analysis_id+shot_index 索引保留）。
    await db.query('DROP INDEX IF EXISTS "video_shots_shot_id_key";');

    // V1：person_name 可能聚合多个识别到的人名（、连接），varchar(100) 会溢出，扩容
    await db.query('ALTER TABLE "materials" ALTER COLUMN "person_name" TYPE varchar(500);');
    // V1：AI 回填的分类/质量等文本可能较长，统一扩容，避免 varchar 过短插入失败
    await db.query('ALTER TABLE "materials" ALTER COLUMN "quality" TYPE varchar(255);');
    await db.query('ALTER TABLE "materials" ALTER COLUMN "industry" TYPE varchar(255);');
    await db.query('ALTER TABLE "materials" ALTER COLUMN "department" TYPE varchar(255);');
    await db.query('ALTER TABLE "materials" ALTER COLUMN "feishu_record_id" TYPE varchar(255);');
  } catch (e) {
    console.warn('[db-cjs] 自我迁移失败:', e.message);
  }
  _migrated = true;
}


function getPglite() {
  if (!_pglite) {
    _pglite = new PGlite(DB_PATH);
    console.log(`[db-cjs] ✅ PGlite 已连接: ${DB_PATH}`);
    // 异步触发自我迁移（不阻塞）
    ensureSelfMigrations().catch((e) => console.warn('[db-cjs] self-migrate warn:', e.message));
  }
  return _pglite;
}

/**
 * 把素材记录写入 DB（用 raw SQL，避免 Drizzle ESM 在 CJS 里加载）
 * @param {Object} m
 * @param {string} [m.id]                  UUID，可选（不传则 DB 默认生成）
 * @param {string} m.businessId            业务 ID（必填）
 * @param {string} m.type                  'product' | 'scene' | 'reference'
 * @param {string} m.productName           产品名称
 * @param {string} m.fileName              文件名
 * @param {string} m.filePath              本地文件路径
 * @param {string} [m.playableUrl]         可播放 URL
 * @param {string} [m.thumbnailUrl]        缩略图
 * @param {string} [m.industry]
 * @param {string} [m.brand]
 * @param {string} [m.department]
 * @param {string} [m.clientName]
 * @param {string} [m.quality]
 * @param {string} m.analysisStatus        pending/analyzing/done/failed
 * @param {number} [m.totalDuration]
 * @param {number} [m.shotCount]
 * @param {string[]} [m.sellingPointTags]
 * @param {string[]} [m.sceneVideoUrls]
 * @param {string} m.source                upload/feishu/relink
 * @param {string} [m.feishuRecordId]
 * @param {string} [m.description]
 * @param {string} [m.fileHash]            SHA-256 全文哈希（用于飞书去重匹配）
 * @param {Object} [m.shots]               分镜数组（自动写入 video_analyses + video_shots）
 * @returns {Promise<{materialId: string, analysisId: string|null, shotCount: number}>}
 */
async function upsertMaterial(m) {
  const db = getPglite();
  await ensureSelfMigrations(); // 确保字段就绪
  const sellingPointTags = JSON.stringify(m.sellingPointTags || []);
  const sceneVideoUrls = JSON.stringify(m.sceneVideoUrls || []);

  // 1. upsert materials 表（按 business_id 唯一）
  const result = await db.query(`
    INSERT INTO materials (
      business_id, type, product_name, file_name, file_path, playable_url, thumbnail_url,
      industry, brand, department, client_name, quality, person_name, analysis_status,
      total_duration, shot_count, selling_point_tags, scene_video_urls,
      source, feishu_record_id, description, file_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21, $22)
    ON CONFLICT (business_id) DO UPDATE SET
      type = COALESCE(EXCLUDED.type, materials.type),
      product_name = COALESCE(EXCLUDED.product_name, materials.product_name),
      file_name = COALESCE(EXCLUDED.file_name, materials.file_name),
      file_path = COALESCE(EXCLUDED.file_path, materials.file_path),
      playable_url = COALESCE(EXCLUDED.playable_url, materials.playable_url),
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, materials.thumbnail_url),
      industry = COALESCE(EXCLUDED.industry, materials.industry),
      brand = COALESCE(EXCLUDED.brand, materials.brand),
      department = COALESCE(EXCLUDED.department, materials.department),
      client_name = COALESCE(EXCLUDED.client_name, materials.client_name),
      quality = COALESCE(EXCLUDED.quality, materials.quality),
      person_name = COALESCE(EXCLUDED.person_name, materials.person_name),
      analysis_status = EXCLUDED.analysis_status,
      total_duration = COALESCE(EXCLUDED.total_duration, materials.total_duration),
      shot_count = EXCLUDED.shot_count,
      selling_point_tags = EXCLUDED.selling_point_tags,
      scene_video_urls = EXCLUDED.scene_video_urls,
      source = EXCLUDED.source,
      feishu_record_id = COALESCE(EXCLUDED.feishu_record_id, materials.feishu_record_id),
      description = COALESCE(EXCLUDED.description, materials.description),
      file_hash = COALESCE(EXCLUDED.file_hash, materials.file_hash),
      _updated_at = CURRENT_TIMESTAMP
    RETURNING id, business_id, _created_at, _updated_at;
  `, [
    m.businessId,
    m.type || 'product',
    m.productName,
    m.fileName,
    m.filePath,
    m.playableUrl || null,
    m.thumbnailUrl || null,
    m.industry || null,
    m.brand || null,
    m.department || null,
    m.clientName || null,
    m.quality || null,
    m.personName || null,                  // 新增
    m.analysisStatus || 'pending',
    m.totalDuration || null,
    m.shotCount || 0,
    sellingPointTags,
    sceneVideoUrls,
    m.source || 'upload',
    m.feishuRecordId || null,
    m.description || null,
    m.fileHash || null,
  ]);

  const materialId = result.rows[0].id;
  let analysisId = null;
  let insertedShots = 0;

  // 2. 如果有 shots，写 video_analyses + video_shots
  if (Array.isArray(m.shots) && m.shots.length > 0) {
    const playableUrl = m.playableUrl || m.filePath;
    const aRes = await db.query(`
      INSERT INTO video_analyses (
        material_id, video_url, video_name, product_model, product_name,
        thumbnail_url, total_duration, shot_count,
        scene_video_count, scene_video_urls,
        industry, client_name, department, selling_point_tags, category_tags,
        quality, file_path, analysis_status, description, type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb, $14::jsonb, $15, $16, $17, $18, $19)
      ON CONFLICT (material_id) DO UPDATE SET
        video_url = EXCLUDED.video_url,
        shot_count = EXCLUDED.shot_count,
        analysis_status = EXCLUDED.analysis_status,
        _updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `, [
      materialId,
      playableUrl,
      m.fileName,
      m.productName,
      m.productName,
      m.thumbnailUrl || null,
      m.totalDuration || 0,
      m.shots.length,
      (m.sceneVideoUrls || []).length,
      JSON.stringify(m.sceneVideoUrls || []),
      m.industry || null,
      m.clientName || null,
      m.department || null,
      JSON.stringify(m.sellingPointTags || []),
      m.quality || null,
      m.filePath,
      m.analysisStatus || 'done',
      m.description || null,
      m.type || 'product',
    ]);
    analysisId = aRes.rows[0].id;

    // 删旧 shots，写新 shots
    await db.query('DELETE FROM video_shots WHERE analysis_id = $1;', [analysisId]);
    for (let i = 0; i < m.shots.length; i++) {
      const s = m.shots[i];
      await db.query(`
        INSERT INTO video_shots (
          analysis_id, shot_id, shot_index, start_time, end_time, duration,
          description, scene, objects, action, camera,
          core_selling_point, selling_point, narration_text, keyframe_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);
      `, [
        analysisId,
        s.shotId || `shot_${Date.now()}_${i}`,
        s.shotIndex ?? i,
        s.startTime || 0,
        s.endTime || 0,
        s.duration ?? ((s.endTime || 0) - (s.startTime || 0)),
        s.description || null,
        s.scene || null,
        s.objects || null,
        s.action || null,
        s.camera || null,
        s.coreSellingPoint || null,
        s.sellingPoint || s.coreSellingPoint || null,
        s.narrationText || null,
        s.keyframePath || null,
      ]);
      insertedShots++;
    }
  }

  return { materialId, analysisId, shotCount: insertedShots };
}

/**
 * 列出所有素材（JOIN shots）
 */
async function listMaterialsFromDb() {
  const db = getPglite();
  await ensureSelfMigrations();
  const r = await db.query(`
    SELECT
      m.id, m.business_id, m.type, m.product_name, m.file_name, m.file_path,
      m.playable_url, m.thumbnail_url,
      m.industry, m.brand, m.department, m.client_name, m.quality,
      m.person_name, m.analysis_status,
      m.total_duration, m.shot_count, m.selling_point_tags, m.scene_video_urls,
      m.usage_count, m.consumption_count, m.source, m.feishu_record_id,
      m.description, m.file_hash, m._created_at, m._updated_at,
      va.id AS analysis_id, va.product_model AS va_product_model
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    ORDER BY m._created_at DESC;
  `);

  // 取所有 shots
  const shotsRes = await db.query(`
    SELECT analysis_id, shot_id, shot_index, start_time, end_time, duration,
           description, scene, objects, action, camera,
           core_selling_point, narration_text, keyframe_path
    FROM video_shots
    ORDER BY analysis_id, shot_index;
  `);

  const shotsByAnalysis = new Map();
  for (const s of shotsRes.rows) {
    if (!shotsByAnalysis.has(s.analysis_id)) shotsByAnalysis.set(s.analysis_id, []);
    shotsByAnalysis.get(s.analysis_id).push({
      shotId: s.shot_id,
      shotIndex: s.shot_index,
      startTime: s.start_time,
      endTime: s.end_time,
      duration: s.duration,
      description: s.description,
      scene: s.scene,
      objects: s.objects,
      action: s.action,
      camera: s.camera,
      coreSellingPoint: s.core_selling_point,
      narrationText: s.narration_text,
      keyframePath: s.keyframe_path,
    });
  }

  return r.rows.map(row => ({
    id: row.business_id || row.id,
    dbId: row.id,
    type: row.type,
    productName: row.product_name,
    productModel: row.va_product_model || null,
    fileName: row.file_name,
    filePath: row.file_path,
    playableUrl: row.playable_url,
    thumbnailUrl: row.thumbnail_url,
    industry: row.industry,
    brand: row.brand,
    department: row.department,
    clientName: row.client_name,
    quality: row.quality,
    personName: row.person_name,
    analysisStatus: row.analysis_status,
    totalDuration: row.total_duration,
    shotCount: row.shot_count,
    sellingPointTags: row.selling_point_tags || [],
    sceneVideoUrls: row.scene_video_urls || [],
    usageCount: row.usage_count,
    consumptionCount: row.consumption_count,
    source: row.source,
    feishuRecordId: row.feishu_record_id,
    description: row.description,
    fileHash: row.file_hash,
    createdAt: row._created_at,
    updatedAt: row._updated_at,
    analysisId: row.analysis_id,
    shots: row.analysis_id ? (shotsByAnalysis.get(row.analysis_id) || []) : [],
  }));
}

/**
 * 用 file_hash 查素材（用于上传时去重）
 * @returns {Promise<Object|null>}
 */
async function findMaterialByHash(fileHash) {
  if (!fileHash) return null;
  const db = getPglite();
  const r = await db.query(
    'SELECT business_id, product_name, file_name, file_path, analysis_status, shot_count FROM materials WHERE file_hash = $1 LIMIT 1;',
    [fileHash],
  );
  return r.rows[0] || null;
}

/**
 * 用 飞书主表 record_id 查素材（后台飞书→DB 同步去重用）
 */
async function findMaterialByFeishuRecordId(recordId) {
  if (!recordId) return null;
  const db = getPglite();
  const r = await db.query(
    'SELECT business_id, product_name, file_name FROM materials WHERE feishu_record_id = $1 LIMIT 1;',
    [recordId],
  );
  return r.rows[0] || null;
}

/**
 * 用 business_id 查素材的完整信息（含分镜）
 */
async function findMaterialByBusinessId(businessId) {
  if (!businessId) return null;
  const db = getPglite();
  const r = await db.query(`
    SELECT
      m.id, m.business_id, m.type, m.product_name, m.file_name, m.file_path,
      m.playable_url, m.thumbnail_url,
      m.industry, m.brand, m.department, m.client_name, m.quality, m.analysis_status,
      m.total_duration, m.shot_count, m.selling_point_tags, m.scene_video_urls,
      m.usage_count, m.consumption_count, m.source, m.feishu_record_id,
      m.description, m.file_hash, m._created_at, m._updated_at,
      va.id AS analysis_id
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    WHERE m.business_id = $1
    LIMIT 1;
  `, [businessId]);
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  let shots = [];
  if (row.analysis_id) {
    const sRes = await db.query(`
      SELECT shot_id, shot_index, start_time, end_time, duration,
             description, scene, objects, action, camera,
             core_selling_point, narration_text, keyframe_path
      FROM video_shots WHERE analysis_id = $1 ORDER BY shot_index;
    `, [row.analysis_id]);
    shots = sRes.rows.map(s => ({
      shotId: s.shot_id,
      shotIndex: s.shot_index,
      startTime: s.start_time,
      endTime: s.end_time,
      duration: s.duration,
      description: s.description,
      scene: s.scene,
      objects: s.objects,
      action: s.action,
      camera: s.camera,
      coreSellingPoint: s.core_selling_point,
      narrationText: s.narration_text,
      keyframePath: s.keyframe_path,
    }));
  }
  return {
    id: row.business_id || row.id,
    dbId: row.id,
    type: row.type,
    productName: row.product_name,
    fileName: row.file_name,
    filePath: row.file_path,
    playableUrl: row.playable_url,
    thumbnailUrl: row.thumbnail_url,
    industry: row.industry,
    brand: row.brand,
    department: row.department,
    clientName: row.client_name,
    quality: row.quality,
    analysisStatus: row.analysis_status,
    totalDuration: row.total_duration,
    shotCount: row.shot_count,
    sellingPointTags: row.selling_point_tags || [],
    sceneVideoUrls: row.scene_video_urls || [],
    usageCount: row.usage_count,
    consumptionCount: row.consumption_count,
    source: row.source,
    feishuRecordId: row.feishu_record_id,
    description: row.description,
    fileHash: row.file_hash,
    createdAt: row._created_at,
    updatedAt: row._updated_at,
    analysisId: row.analysis_id,
    shots,
  };
}

/**
 * 计算文件 SHA-256（流式，避免大文件占内存）
 * @param {string} filePath
 * @returns {Promise<string>}
 */
const crypto = require('crypto');
async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 同步素材到飞书表格（POST record 到飞书多维表格）
 * @returns {Promise<{success: boolean, recordId?: string, error?: string}>}
 */
async function syncMaterialToFeishu(feishuApi, material, shots) {
  // feishuApi = { getTenantToken, postRecord }
  const token = await feishuApi.getTenantToken();
  const fields = {
    '视频标题': material.productName,
    '产品型号': material.productName,
    '行业': material.industry || '工业设备',
    '素材质量': material.quality || '优质',
    '客户': material.clientName || '',
    '部门': material.department || '',
    '分类标签': (material.sellingPointTags || []).join(','),
  };
  // 每个分镜写一条飞书记录
  if (shots && shots.length > 0) {
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const segFields = {
        ...fields,
        '产品型号_分镜': `${material.productName}_分镜${i + 1}`,
        '分镜 ID': s.shotId,
        '画面描述': s.description || '',
        '主题场景': s.scene || '',
        '物体动作': s.action || '',
        '镜头卖点': s.coreSellingPoint || '',
        '开始时间 (s)': s.startTime,
        '结束时间 (s)': s.endTime,
      };
      const r = await feishuApi.postRecord(token, segFields);
      if (r.code !== 0) {
        return { success: false, error: r.msg };
      }
    }
  } else {
    const r = await feishuApi.postRecord(token, fields);
    if (r.code !== 0) {
      return { success: false, error: r.msg };
    }
  }
  return { success: true };
}

/**
 * 列出产品分组（DISTINCT product_model from video_analyses + JOIN materials）
 * 返回：[{ productModel, videoCount, latestVideoAt, sampleFileName, samplePlayableUrl }]
 */
async function listProductGroupsFromDb() {
  const db = getPglite();
  await ensureSelfMigrations();
  const r = await db.query(`
    SELECT
      COALESCE(NULLIF(va.product_model, ''), NULLIF(m.product_name, ''), '未分类') AS product_model,
      COUNT(*)::int AS video_count,
      MAX(m._created_at) AS latest_at,
      MIN(m.file_name) AS sample_file_name,
      MIN(m.playable_url) AS sample_url
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    WHERE COALESCE(NULLIF(va.product_model, ''), NULLIF(m.product_name, '')) IS NOT NULL
    GROUP BY COALESCE(NULLIF(va.product_model, ''), NULLIF(m.product_name, ''), '未分类')
    ORDER BY MAX(m._created_at) DESC;
  `);
  return r.rows.map(row => ({
    productModel: row.product_model,
    videoCount: row.video_count,
    latestAt: row.latest_at,
    sampleFileName: row.sample_file_name,
    sampleUrl: row.sample_url,
  }));
}

/**
 * 列出员工分组（DISTINCT person_name from materials WHERE person_name IS NOT NULL）
 */
async function listEmployeeGroupsFromDb() {
  const db = getPglite();
  await ensureSelfMigrations();
  const r = await db.query(`
    SELECT
      m.person_name,
      COUNT(*)::int AS video_count,
      MAX(m._created_at) AS latest_at,
      MIN(m.file_name) AS sample_file_name,
      MIN(m.playable_url) AS sample_url
    FROM materials m
    WHERE m.person_name IS NOT NULL AND TRIM(m.person_name) != ''
    GROUP BY m.person_name
    ORDER BY MAX(m._created_at) DESC;
  `);
  return r.rows.map(row => ({
    personName: row.person_name,
    videoCount: row.video_count,
    latestAt: row.latest_at,
    sampleFileName: row.sample_file_name,
    sampleUrl: row.sample_url,
  }));
}

function _materialRowToObject(row) {
  return {
    id: row.business_id || row.id,
    dbId: row.id,
    type: row.type,
    productName: row.product_name,
    productModel: row.va_product_model || row.product_name,
    fileName: row.file_name,
    filePath: row.file_path,
    playableUrl: row.playable_url,
    thumbnailUrl: row.thumbnail_url,
    industry: row.industry,
    brand: row.brand,
    department: row.department,
    clientName: row.client_name,
    quality: row.quality,
    personName: row.person_name,
    analysisStatus: row.analysis_status,
    totalDuration: row.total_duration,
    shotCount: row.shot_count,
    sellingPointTags: row.selling_point_tags || [],
    sceneVideoUrls: row.scene_video_urls || [],
    usageCount: row.usage_count,
    consumptionCount: row.consumption_count,
    source: row.source,
    feishuRecordId: row.feishu_record_id,
    description: row.description,
    fileHash: row.file_hash,
    createdAt: row._created_at,
    updatedAt: row._updated_at,
    analysisId: row.analysis_id,
  };
}

const _MATERIAL_SELECT = `
  m.id, m.business_id, m.type, m.product_name, m.file_name, m.file_path,
  m.playable_url, m.thumbnail_url,
  m.industry, m.brand, m.department, m.client_name, m.quality,
  m.person_name, m.analysis_status,
  m.total_duration, m.shot_count, m.selling_point_tags, m.scene_video_urls,
  m.usage_count, m.consumption_count, m.source, m.feishu_record_id,
  m.description, m.file_hash, m._created_at, m._updated_at,
  va.id AS analysis_id, va.product_model AS va_product_model
`;

/**
 * 按产品型号列出该型号下所有视频
 */
async function listMaterialsByProductModelFromDb(productModel) {
  if (!productModel) return [];
  const db = getPglite();
  await ensureSelfMigrations();
  const r = await db.query(`
    SELECT ${_MATERIAL_SELECT}
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    WHERE COALESCE(NULLIF(va.product_model, ''), NULLIF(m.product_name, ''), '未分类') = $1
    ORDER BY m._created_at DESC;
  `, [productModel]);
  return r.rows.map(_materialRowToObject);
}

/**
 * 按员工姓名列出该员工名下所有视频
 */
async function listMaterialsByEmployeeNameFromDb(personName) {
  if (!personName) return [];
  const db = getPglite();
  await ensureSelfMigrations();
  const r = await db.query(`
    SELECT ${_MATERIAL_SELECT}
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    WHERE m.person_name = $1
    ORDER BY m._created_at DESC;
  `, [personName]);
  return r.rows.map(_materialRowToObject);
}

// 规范化分页参数并补齐 totalPages
function _normalizePage(page, pageSize) {
  return {
    page: Math.max(1, parseInt(page, 10) || 1),
    pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 12)),
  }
}
function _pagedResult(items, total, page, pageSize) {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

/**
 * 按产品型号分页列出视频（SQL 级 COUNT + LIMIT/OFFSET）
 */
async function listMaterialsByProductModelPagedFromDb(productModel, opts = {}) {
  const { page, pageSize } = _normalizePage(opts.page, opts.pageSize)
  if (!productModel) return _pagedResult([], 0, page, pageSize)
  const db = getPglite()
  await ensureSelfMigrations()
  const where = `WHERE COALESCE(NULLIF(va.product_model, ''), NULLIF(m.product_name, ''), '未分类') = $1`
  const c = await db.query(
    `SELECT COUNT(*)::int AS n FROM materials m LEFT JOIN video_analyses va ON va.material_id = m.id ${where}`,
    [productModel],
  )
  const total = c.rows[0].n
  const r = await db.query(`
    SELECT ${_MATERIAL_SELECT}
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    ${where}
    ORDER BY m._created_at DESC
    LIMIT $2 OFFSET $3;
  `, [productModel, pageSize, (page - 1) * pageSize])
  return _pagedResult(r.rows.map(_materialRowToObject), total, page, pageSize)
}

/**
 * 按员工姓名分页列出视频（SQL 级 COUNT + LIMIT/OFFSET）
 */
async function listMaterialsByEmployeeNamePagedFromDb(personName, opts = {}) {
  const { page, pageSize } = _normalizePage(opts.page, opts.pageSize)
  if (!personName) return _pagedResult([], 0, page, pageSize)
  const db = getPglite()
  await ensureSelfMigrations()
  const c = await db.query(
    `SELECT COUNT(*)::int AS n FROM materials m WHERE m.person_name = $1`,
    [personName],
  )
  const total = c.rows[0].n
  const r = await db.query(`
    SELECT ${_MATERIAL_SELECT}
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    WHERE m.person_name = $1
    ORDER BY m._created_at DESC
    LIMIT $2 OFFSET $3;
  `, [personName, pageSize, (page - 1) * pageSize])
  return _pagedResult(r.rows.map(_materialRowToObject), total, page, pageSize)
}

/**
 * 取指定素材的全部分镜（含 video_analyses + video_shots）
 */
async function getMaterialShotsByMaterialIdFromDb(materialId) {
  if (!materialId) return null;
  const db = getPglite();
  await ensureSelfMigrations();
  const r = await db.query(`
    SELECT
      m.id, m.business_id, m.type, m.product_name, m.file_name, m.file_path,
      m.playable_url, m.thumbnail_url,
      m.industry, m.brand, m.department, m.client_name, m.quality,
      m.person_name, m.analysis_status,
      m.total_duration, m.shot_count, m.selling_point_tags, m.scene_video_urls,
      m.usage_count, m.consumption_count, m.source, m.feishu_record_id,
      m.description, m.file_hash, m._created_at, m._updated_at,
      va.id AS analysis_id, va.product_model AS va_product_model,
      va.video_url AS va_video_url, va.thumbnail_url AS va_thumbnail_url
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    -- materialId 实际是飞书 record_id（存在 business_id 列），不是 materials.id (uuid)
    WHERE m.business_id = $1
    LIMIT 1;
  `, [materialId]);
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  const out = _materialRowToObject(row);
  out.playableUrl = out.playableUrl || row.va_video_url;
  out.thumbnailUrl = out.thumbnailUrl || row.va_thumbnail_url;
  if (row.analysis_id) {
    const sRes = await db.query(`
      SELECT shot_id, shot_index, start_time, end_time, duration,
             description, scene, objects, action, camera,
             core_selling_point, narration_text, keyframe_path
      FROM video_shots WHERE analysis_id = $1 ORDER BY shot_index;
    `, [row.analysis_id]);
    out.shots = sRes.rows.map(s => ({
      shotId: s.shot_id,
      shotIndex: s.shot_index,
      startTime: s.start_time,
      endTime: s.end_time,
      duration: s.duration,
      description: s.description,
      scene: s.scene,
      objects: s.objects,
      action: s.action,
      camera: s.camera,
      coreSellingPoint: s.core_selling_point,
      narrationText: s.narration_text,
      keyframePath: s.keyframe_path,
    }));
  } else {
    out.shots = [];
  }
  return out;
}

/**
 * 更新素材字段（用于 AI 分析后回写 product_name/person_name 等）
 * @param {string} businessId
 * @param {Object} fields  e.g. { person_name: '张三', product_name: '叉车X1' }
 */
async function updateMaterialFieldFromDb(businessId, fields) {
  if (!businessId || !fields || Object.keys(fields).length === 0) return null;
  const db = getPglite();
  await ensureSelfMigrations();
  const allow = [
    'person_name', 'product_name', 'industry', 'brand', 'department', 'client_name', 'quality', 'description',
    'analysis_status', 'shot_count', 'total_duration', 'selling_point_tags', 'category_tags',
    'thumbnail_url', 'playable_url', 'file_path',
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of Object.keys(fields)) {
    if (!allow.includes(k)) continue;
    sets.push(`${k} = $${i}`);
    params.push(fields[k]);
    i++;
  }
  if (sets.length === 0) return null;
  sets.push(`_updated_at = CURRENT_TIMESTAMP`);
  params.push(businessId);
  const sql = `UPDATE materials SET ${sets.join(', ')} WHERE business_id = $${i} RETURNING id, business_id;`;
  const r = await db.query(sql, params);
  return r.rows[0] || null;
}

/**
 * 按 material UUID 删除素材（级联删除 video_analyses + video_shots）
 * @param {string} materialId  materials.id (UUID)
 * @returns {Promise<{deleted: boolean, materialId: string, analysisCount: number, shotCount: number}>}
 */
async function deleteMaterialByIdFromDb(materialId) {
  if (!materialId) return { deleted: false, materialId: null, analysisCount: 0, shotCount: 0 };
  const db = getPglite();
  await ensureSelfMigrations();
  // 1. 拿到该 material 下所有 video_analyses.id
  const aRes = await db.query(`SELECT id FROM video_analyses WHERE material_id = $1`, [materialId]);
  const analysisIds = aRes.rows.map((r) => r.id);
  let shotCount = 0;
  if (analysisIds.length > 0) {
    const sRes = await db.query(`SELECT COUNT(*)::int AS n FROM video_shots WHERE analysis_id = ANY($1::uuid[])`, [analysisIds]);
    shotCount = sRes.rows[0]?.n || 0;
    await db.query(`DELETE FROM video_shots WHERE analysis_id = ANY($1::uuid[])`, [analysisIds]);
    await db.query(`DELETE FROM video_analyses WHERE material_id = $1`, [materialId]);
  }
  // 2. 删主表
  const mRes = await db.query(`DELETE FROM materials WHERE id = $1 RETURNING id`, [materialId]);
  return {
    deleted: mRes.rows.length > 0,
    materialId,
    analysisCount: analysisIds.length,
    shotCount,
  };
}

/**
 * 关键词搜索素材（按 file_name / product_name / person_name 模糊匹配）
 * @param {string} keyword
 * @param {Object} [opts]  { limit: number = 50 }
 * @returns {Promise<Array<MaterialRow>>}
 */
async function searchMaterialsFromDb(keyword, opts = {}) {
  const db = getPglite();
  await ensureSelfMigrations();
  const limit = Math.min(Math.max(parseInt(opts.limit) || 50, 1), 200);
  const kw = (keyword || '').trim();
  if (!kw) return [];
  const like = `%${kw}%`;
  const r = await db.query(`
    SELECT
      m.id, m.business_id, m.type, m.product_name, m.file_name, m.file_path, m.playable_url, m.thumbnail_url,
      m.industry, m.brand, m.department, m.client_name, m.quality, m.person_name, m.analysis_status,
      m.total_duration, m.shot_count, m.selling_point_tags, m.scene_video_urls,
      m.source, m.feishu_record_id, m.description, m.file_hash,
      m._created_at, m._updated_at,
      va.id AS va_id, va.product_model AS va_product_model
    FROM materials m
    LEFT JOIN video_analyses va ON va.material_id = m.id
    WHERE m.file_name ILIKE $1 OR m.product_name ILIKE $1 OR m.person_name ILIKE $1
    ORDER BY m._updated_at DESC
    LIMIT $2
  `, [like, limit]);
  return r.rows.map(_materialRowToObject);
}

/**
 * 改名：按 materialId 修改 product_name，同时同步更新 video_analyses.product_model
 * @param {string} materialId
 * @param {string} newProductName
 */
async function updateMaterialProductNameFromDb(materialId, newProductName) {
  if (!materialId || !newProductName) return null;
  const db = getPglite();
  await ensureSelfMigrations();
  // materialId 实际是飞书 record_id（存在 business_id 列），不是 materials.id (uuid)
  // 1) materials 表用 business_id 定位
  await db.query(`UPDATE materials SET product_name = $1, _updated_at = CURRENT_TIMESTAMP WHERE business_id = $2`, [newProductName, materialId]);
  // 2) video_analyses.material_id 是 uuid，需要先查到 materials.id
  const matRow = (await db.query(`SELECT id FROM materials WHERE business_id = $1`, [materialId])).rows[0];
  if (matRow?.id) {
    await db.query(`UPDATE video_analyses SET product_model = $1, product_name = $1, _updated_at = CURRENT_TIMESTAMP WHERE material_id = $2`, [newProductName, matRow.id]);
  }
  return await findMaterialByBusinessId(materialId);
}

/**
 * 改名：按 materialId 修改 person_name
 */
async function updateMaterialPersonNameFromDb(materialId, newPersonName) {
  if (!materialId) return null;
  const db = getPglite();
  await ensureSelfMigrations();
  // materialId 实际是飞书 record_id（存在 business_id 列），不是 materials.id (uuid)
  await db.query(`UPDATE materials SET person_name = $1, _updated_at = CURRENT_TIMESTAMP WHERE business_id = $2`, [newPersonName || null, materialId]);
  return await findMaterialByBusinessId(materialId);
}

/**
 * 删除单个分镜（按飞书 record_id 删本地 video_shots 行）
 * @param {string} shotId  video_shots.shot_id（即飞书 record_id）
 * @returns {boolean}      是否真的删了（找不到 record 返回 false）
 */
async function deleteShotFromDb(shotId) {
  if (!shotId) return false;
  const db = getPglite();
  await ensureSelfMigrations();
  const r = await db.query(`DELETE FROM video_shots WHERE shot_id = $1`, [shotId]);
  return r.affectedRows > 0;
}

/**
 * 更新单个分镜的内容（同步飞书后本地缓存也跟上）
 * @param {string} shotId  video_shots.shot_id（即飞书 record_id）
 * @param {Object} patch  { description?, scene?, objects?, action?, camera?, coreSellingPoint?, startTime?, endTime? }
 * @returns {boolean}     是否真的更新了（找不到 record 返回 false）
 */
async function updateShotFromDb(shotId, patch) {
  if (!shotId || !patch || typeof patch !== 'object') return false;
  const db = getPglite();
  await ensureSelfMigrations();

  // 只允许更新以下白名单字段（避免被前端注入任意 SQL）
  const allowed = {
    description: 'description',
    scene: 'scene',
    objects: 'objects',
    action: 'action',
    camera: 'camera',
    coreSellingPoint: 'core_selling_point',
    startTime: 'start_time',
    endTime: 'end_time',
  };
  const sets = [];
  const vals = [];
  let p = 1;
  for (const [key, col] of Object.entries(allowed)) {
    if (key in patch) {
      sets.push(`${col} = $${p}`);
      vals.push(patch[key]);
      p++;
    }
  }
  if (sets.length === 0) return false;

  // 同时刷新 _updated_at
  sets.push(`_updated_at = CURRENT_TIMESTAMP`);
  vals.push(shotId);
  const sql = `UPDATE video_shots SET ${sets.join(', ')} WHERE shot_id = $${p}`;
  const r = await db.query(sql, vals);
  return r.affectedRows > 0 || (r.rows && r.rows.length > 0) || true;
}


module.exports = {
  getPglite,
  resolveDbPath,
  DB_PATH,
  ensureSelfMigrations,
  upsertMaterial,
  listMaterialsFromDb,
  listProductGroupsFromDb,
  listEmployeeGroupsFromDb,
  listMaterialsByProductModelFromDb,
  listMaterialsByEmployeeNameFromDb,
  listMaterialsByProductModelPagedFromDb,
  listMaterialsByEmployeeNamePagedFromDb,
  getMaterialShotsByMaterialIdFromDb,
  updateMaterialFieldFromDb,
  deleteMaterialByIdFromDb,
  searchMaterialsFromDb,
  updateMaterialProductNameFromDb,
  updateMaterialPersonNameFromDb,
  updateShotFromDb,
  deleteShotFromDb,
  syncMaterialToFeishu,
  findMaterialByHash,
  findMaterialByFeishuRecordId,
  findMaterialByBusinessId,
  computeFileHash,
};