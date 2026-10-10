import dbCjs from './server/database/db-cjs.js';
const list = await dbCjs.listMaterialsFromDb();
const feicang = list.filter(m => m.fileName && m.fileName.includes('飞仓'));
console.log('Before delete: ' + feicang.length + ' 飞仓 records');
for (const m of feicang) {
  console.log(`  → dbId=${m.dbId}`);
  try {
    const r = await dbCjs.deleteMaterialByIdFromDb(m.dbId);
    console.log(`    deleted=${r.deleted} analyses=${r.analysisCount} shots=${r.shotCount}`);
  } catch (e) {
    console.log(`    ERR: ${e.message}`);
  }
}
const list2 = await dbCjs.listMaterialsFromDb();
const feicang2 = list2.filter(m => m.fileName && m.fileName.includes('飞仓'));
console.log(`After delete: ${feicang2.length} 飞仓 records remaining`);
console.log(`Total materials: ${list2.length}`);
process.exit(0);