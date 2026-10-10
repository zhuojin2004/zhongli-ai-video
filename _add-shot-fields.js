// 给飞书「分镜任务库」表（tblJEJtnvP4Rtlno）添加 2 个新字段：
//   - 时长标签 (SingleLineText, type=1)
//   - 封面图 (Attachment, type=17)
// 用途：mockApiServer.js 的 writeShotToFeishu() 要写这 2 个字段，但 schema 里目前没有。
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || '';
const APP = get('FEISHU_APP_ID');
const SECRET = get('FEISHU_APP_SECRET');
const APP_TOKEN = get('FEISHU_BITABLE_APP_TOKEN');
const SHOT_TABLE = get('FEISHU_TABLE_ID');
const FEISHU_BASE = get('VITE_LARK_BASE') || 'https://open.feishu.cn';

(async () => {
  const tkRes = await fetch(FEISHU_BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  });
  const tkJ = await tkRes.json();
  if (tkJ.code !== 0) { console.error('Token error:', JSON.stringify(tkJ, null, 2)); process.exit(1); }
  const token = tkJ.tenant_access_token;

  // 1) 先查一下当前表里到底有没有这 2 个字段（避免重复创建）
  const listRes = await fetch(
    FEISHU_BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/fields?page_size=100',
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const listJ = await listRes.json();
  if (listJ.code !== 0) { console.error('List fields error:', JSON.stringify(listJ, null, 2)); process.exit(1); }
  const existing = new Set(listJ.data.items.map(f => f.field_name));
  console.log('SHOT table 当前 ' + listJ.data.items.length + ' 个字段');
  console.log('已有：', [...existing].filter(n => /时长|封面/.test(n)));

  const toCreate = [
    { field_name: '时长标签', type: 1 },             // SingleLineText
    { field_name: '封面图', type: 17 },              // Attachment
  ];

  for (const f of toCreate) {
    if (existing.has(f.field_name)) {
      console.log('⏭  跳过（已存在）:', f.field_name);
      continue;
    }
    const r = await fetch(
      FEISHU_BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/fields',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(f),
      }
    );
    const j = await r.json();
    if (j.code !== 0) {
      console.error('创建字段失败 [' + f.field_name + ']:', JSON.stringify(j, null, 2));
    } else {
      console.log('✓ 创建字段:', f.field_name, 'field_id=' + j.data.field.field_id);
    }
  }

  // 验证
  const verifyRes = await fetch(
    FEISHU_BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + SHOT_TABLE + '/fields?page_size=100',
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const verifyJ = await verifyRes.json();
  const after = verifyJ.data.items.map(f => '[' + f.type + '] ' + f.field_name);
  console.log('\n创建后 SHOT 表字段数: ' + verifyJ.data.items.length);
  console.log('时长相关字段:', after.filter(n => /时长/.test(n)));
  console.log('封面相关字段:', after.filter(n => /封面/.test(n)));
})();
