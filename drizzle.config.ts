import { defineConfig, Config } from 'drizzle-kit';
require('dotenv').config();

const outputDir = process.env.__DRIZZLE_OUT_DIR__ || './tmp/.introspect';
const schemaPath = process.env.__DRIZZLE_SCHEMA_PATH__ || './server/database/schema.ts';

const parsedUrl = new URL(process.env.SUDA_DATABASE_URL || '');

const envSchemaFilter = process.env.DRIZZLE_SCHEMA_FILTER;
const urlSchemaFilter = parsedUrl.searchParams.get('schema');

const schemaFilter = (envSchemaFilter ?? urlSchemaFilter ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

parsedUrl.searchParams.delete('schema'); // 移除schema参数，避免 drizzle-kit 解析错误

// 默认排除的系统对象（PostgreSQL 扩展和系统视图）
// 这些对象在 drizzle-kit introspect 时可能导致无效的 JS 代码生成
const SYSTEM_OBJECTS_EXCLUSIONS = [
  '!spatial_ref_sys',       // PostGIS 空间参考系统表
  '!geography_columns',     // PostGIS 地理列视图
  '!geometry_columns',      // PostGIS 几何列视图
  '!raster_columns',        // PostGIS 栅格列视图
  '!raster_overviews',      // PostGIS 栅格概览视图
  '!pg_stat_statements',    // pg_stat_statements 扩展
  '!pg_stat_statements_info', // pg_stat_statements 扩展
  '!part_config',           // pg_partman 分区配置表
  '!part_config_sub',       // pg_partman 子分区配置表
  '!table_privs',           // 系统权限视图
];

const envTablesFilter = process.env.DRIZZLE_TABLES_FILTER;
const userTablesFilter = (envTablesFilter ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 合并用户过滤器和系统对象排除
// 用户可以通过设置 DRIZZLE_TABLES_FILTER 来覆盖（如果需要包含某些系统对象）
const tablesFilter = [...userTablesFilter, ...SYSTEM_OBJECTS_EXCLUSIONS];

const config:Config = {
  schema: schemaPath,
  out: outputDir,
  tablesFilter,
  schemaFilter,
  dialect: 'postgresql',
  dbCredentials: {
    url: parsedUrl.toString(),
  },
}

export default defineConfig(config);
