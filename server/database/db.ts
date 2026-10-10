/**
 * 数据库连接模块 (PGlite + Drizzle ORM)
 *
 * - 使用 PGlite 嵌入式 PostgreSQL（零依赖，WASM 版 PG）
 * - 数据持久化到 ./data/pglite/ 目录，重启不丢
 * - 切换到真 PG：改 DATABASE_URL=pglite→postgresql://...，把 driver 换成 pg 即可
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

// ─── 解析 DATABASE_URL ────────────────────────────────────────────────────
function resolveDbPath(): string {
  const url = process.env.DATABASE_URL || 'pglite://./data/pglite';
  const match = url.match(/^pglite:\/\/(.+)$/);
  const dbPath = match ? match[1] : './data/pglite';
  const abs = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

const DB_PATH = resolveDbPath();
console.log(`[db] PGlite 嵌入式 PostgreSQL: ${DB_PATH}`);

// ─── 单例 PGlite 实例 ────────────────────────────────────────────────────
// 全局缓存防止热重载时重复打开
declare global {
  // eslint-disable-next-line no-var
  var __pglite: PGlite | undefined;
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

const pglite = global.__pglite ?? new PGlite(DB_PATH);
if (process.env.NODE_ENV !== 'production') global.__pglite = pglite;

export const db = global.__db ?? drizzle(pglite, { schema });
if (process.env.NODE_ENV !== 'production') global.__db = db;

// 关闭时清理
export async function closeDb(): Promise<void> {
  await pglite.close();
}

export { schema };
export type DB = typeof db;