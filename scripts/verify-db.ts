/**
 * 数据库验证脚本
 * 用法：node --import tsx scripts/verify-db.ts
 */
import { PGlite } from '@electric-sql/pglite';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = path.resolve(process.cwd(), './data/pglite');

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ 数据库不存在:', DB_PATH);
    process.exit(1);
  }
  const pglite = new PGlite(DB_PATH);

  console.log('══════════════════════════════════════════════════');
  console.log('  数据库验证');
  console.log('══════════════════════════════════════════════════');
  console.log(`  路径: ${DB_PATH}`);
  console.log(`  大小: ${(fs.statSync(DB_PATH).size / 1024).toFixed(2)} KB\n`);

  // 1. 列出所有表
  const tables = await pglite.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name;
  `);
  console.log(`📋 表清单 (${tables.rows.length} 张):`);
  for (const t of tables.rows) console.log(`   - ${t.table_name}`);

  console.log('\n📊 各表数据统计:');
  const tables2 = [
    'materials', 'video_analyses', 'video_shots', 'materials_scenes',
    'workflow_runs', 'workflow_steps', 'clip_history', 'clip_history_shots',
    'production_tasks', 'authorizations', 'subsidiaries', 'employees',
    'iteration_items', 'dashboard_kpis',
  ];
  for (const t of tables2) {
    const r = await pglite.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${t};`);
    const count = r.rows[0]?.c ?? 0;
    const icon = count > 0 ? '✅' : '· ';
    console.log(`   ${icon} ${t.padEnd(22)} ${count}`);
  }

  // 2. 校验 materials 数据样本
  console.log('\n📦 materials 表样本 (前 3 条):');
  const sample = await pglite.query<any>(`
    SELECT business_id, product_name, file_name, file_path, industry, quality, shot_count, source
    FROM materials ORDER BY _created_at LIMIT 3;
  `);
  for (const r of sample.rows) {
    console.log(`   - ${r.product_name} (${r.industry}, ${r.quality}, ${r.shot_count}分镜, ${r.source})`);
    console.log(`     路径: ${r.file_path.slice(0, 80)}`);
  }

  // 3. 校验关联：每个 analysis 都有对应的 material
  console.log('\n🔗 关联校验:');
  const join = await pglite.query<{ c: number }>(`
    SELECT COUNT(*)::int AS c FROM video_analyses va
    JOIN materials m ON m.id = va.material_id;
  `);
  const orphan = await pglite.query<{ c: number }>(`
    SELECT COUNT(*)::int AS c FROM video_analyses WHERE material_id IS NULL;
  `);
  console.log(`   ✅ video_analyses → materials 关联成功: ${join.rows[0].c}`);
  console.log(`   ${orphan.rows[0].c === 0 ? '✅' : '⚠️ '} 孤儿 analysis (无 material): ${orphan.rows[0].c}`);

  // 4. 每个 analysis 的 shots
  const shotsPerAnalysis = await pglite.query<{ analysis_id: string; c: number }>(`
    SELECT analysis_id, COUNT(*)::int AS c FROM video_shots GROUP BY analysis_id ORDER BY c DESC LIMIT 3;
  `);
  console.log('\n🎬 每个 analysis 的分镜数 (前 3):');
  for (const r of shotsPerAnalysis.rows) {
    console.log(`   - analysis=${r.analysis_id.slice(0, 8)}... → ${r.c} shots`);
  }

  await pglite.close();
  console.log('\n══════════════════════════════════════════════════');
  console.log('  验证完成 ✅');
  console.log('══════════════════════════════════════════════════');
}

main().catch(e => { console.error('❌', e); process.exit(1); });