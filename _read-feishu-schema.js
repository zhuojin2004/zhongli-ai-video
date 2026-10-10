// 一次性脚本：拉取飞书主表 + 分镜表的字段结构，确认 AI 输出字段能匹配
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || '';
const APP = get('FEISHU_APP_ID');
const SECRET = get('FEISHU_APP_SECRET');
const APP_TOKEN = get('FEISHU_BITABLE_APP_TOKEN');
const SHOT_TABLE = get('FEISHU_TABLE_ID');
const MAIN_TABLE = get('FEISHU_MAIN_TABLE_ID');
const FEISHU_BASE = get('VITE_LARK_BASE') || 'https://open.feishu.cn';

(async () => {
  // 1. Get tenant_access_token
  const tkRes = await fetch(FEISHU_BASE + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP, app_secret: SECRET }),
  });
  const tkJ = await tkRes.json();
  if (tkJ.code !== 0) { console.error('Token error:', JSON.stringify(tkJ, null, 2)); process.exit(1); }
  const token = tkJ.tenant_access_token;
  console.log('Token obtained (expires in', tkJ.expire, 's)');

  const fetchFields = async (tableId, label) => {
    const r = await fetch(
      FEISHU_BASE + '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + tableId + '/fields?page_size=100',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const j = await r.json();
    if (j.code !== 0) { console.error(label, 'fields error:', JSON.stringify(j, null, 2)); return []; }
    console.log('\n=== ' + label + ' [' + tableId + '] ' + j.data.items.length + ' fields ===');
    for (const f of j.data.items) {
      console.log('  [' + f.type + ']\t' + f.field_name + '\t(field_id=' + f.field_id + ')');
    }
    return j.data.items;
  };

  const shotFields = await fetchFields(SHOT_TABLE, 'SHOT TABLE');
  const mainFields = await fetchFields(MAIN_TABLE, 'MAIN TABLE');

  fs.writeFileSync('feishu-schema.json', JSON.stringify({
    shotTable: { id: SHOT_TABLE, fields: shotFields },
    mainTable: { id: MAIN_TABLE, fields: mainFields },
  }, null, 2));
  console.log('\nSaved to feishu-schema.json');
})();
