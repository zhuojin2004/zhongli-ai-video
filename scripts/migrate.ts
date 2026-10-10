/**
 * 数据库迁移 runner
 *
 * 用法：
 *   node scripts/migrate.ts                  # 应用所有迁移
 *   node scripts/migrate.ts --reset          # 删除 ./data/pglite/ 重新建
 *   node scripts/migrate.ts --seed-materials # 迁移 + 把 /tmp/zhongli-videos 反向灌入 materials 表
 *   node scripts/migrate.ts --verify         # 只校验不迁移
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../server/database/schema';
import * as fs from 'fs';
import * as path from 'path';

// 解析 DATABASE_URL
function resolveDbPath(): string {
  const url = process.env.DATABASE_URL || 'pglite://./data/pglite';
  const match = url.match(/^pglite:\/\/(.+)$/);
  const dbPath = match ? match[1] : './data/pglite';
  return path.resolve(process.cwd(), dbPath);
}

const DB_PATH = resolveDbPath();
const args = process.argv.slice(2);
const RESET = args.includes('--reset');
const SEED = args.includes('--seed-materials');
const VERIFY = args.includes('--verify');

async function main() {
  if (RESET) {
    console.log(`[migrate] --reset: 删除 ${DB_PATH}`);
    if (fs.existsSync(DB_PATH)) {
      fs.rmSync(DB_PATH, { recursive: true, force: true });
      console.log('[migrate] 已删除旧数据库');
    }
  }

  fs.mkdirSync(DB_PATH, { recursive: true });

  const pglite = new PGlite(DB_PATH);
  const db = drizzle(pglite, { schema });

  console.log(`[migrate] 连接 PGlite: ${DB_PATH}`);
  console.log('[migrate] 正在应用迁移...');

  const start = Date.now();
  await migrate(db, { migrationsFolder: './server/database/migrations' });
  console.log(`[migrate] ✅ 迁移完成 (${Date.now() - start}ms)`);

  // 列出所有表
  const tablesResult = await pglite.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name;
  `);
  console.log(`[migrate] 已建表 ${tablesResult.rows.length} 张:`);
  for (const r of tablesResult.rows) {
    console.log(`   - ${r.table_name}`);
  }

  if (VERIFY) {
    console.log('[migrate] --verify: 只校验，退出');
    await pglite.close();
    return;
  }

  if (SEED) {
    console.log('\n[migrate] --seed-materials: 反向灌入素材数据...');
    const { seedMaterialsFromMock } = await import('./seed-materials');
    await seedMaterialsFromMock(db);
  }

  await pglite.close();
  console.log('\n[migrate] 数据库已就绪 ✅');
}

main().catch((e) => {
  console.error('[migrate] ❌ 失败:', e);
  process.exit(1);
});