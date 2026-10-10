#!/usr/bin/env node
// 独立测试：调 MiniMax-M3 分析一段现有视频（仅打印结果，不写 DB/飞书）
// 用法: node /tmp/_test_minimax_real.js

const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1] || '';
const MINIMAX_API_KEY = get('MINIMAX_API_KEY');
const MINIMAX_BASE = get('MINIMAX_BASE') || 'https://api.minimaxi.com/v1';

const VIDEO_URL = 'http://zhongli2026.oss-cn-hangzhou.aliyuncs.com/videos/upload_1788744740306.mp4';
const FILE_NAME = 'RPG-凯顺.mp4';
const DURATION = 87;

const MINIMAX_JSON_SCHEMA = {
  name: 'video_shot_analysis',
  schema: {
    type: 'object',
    properties: {
      productModel: { type: 'string' },
      industry: { type: 'string' },
      categoryTags: { type: 'array', items: { type: 'string' } },
      sellingPointTags: { type: 'array', items: { type: 'string' } },
      quality: { type: 'string' },
      shots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            startTime: { type: 'number' },
            endTime: { type: 'number' },
            description: { type: 'string' },
            scene: { type: 'string' },
            objects: { type: 'string' },
            action: { type: 'string' },
            camera: { type: 'string' },
            coreSellingPoint: { type: 'string' },
          },
          required: ['startTime', 'endTime', 'description'],
        },
      },
    },
    required: ['productModel', 'shots'],
  },
};

const systemPrompt = '你是一个专业的工业/营销视频内容分析专家，专门分析叉车、物流设备、家电、消费品等视频。返回纯JSON（不要markdown代码块包裹，不要<think>标签外的任何文字）。分镜的 startTime/endTime 必须基于视频真实时间戳，覆盖范围 [0, 视频总时长]。';
const userText = `请分析这段视频，按以下 JSON Schema 输出分镜打标结果：

{
  "productModel": "产品品牌型号（看图中的Logo/铭牌/外形特征）",
  "industry": "三级分类：一级 > 二级 > 三级",
  "categoryTags": ["【分类标签】6-10个，每个6-12字。覆盖：产品形态/核心功能/应用场景/目标客户。例：[\"无人驾驶堆高叉车\",\"激光SLAM自主导航\",\"高位货架智能存取\",\"汽车产线物料转运\"]"],
  "sellingPointTags": ["【核心卖点】4-6个，按重要性降序，每个8-14字。结构：差异化优势+客户价值。维度：核心技术/效率提升/安全可靠/柔性部署/经济回报。例：[\"激光雷达360度无死角扫描保障人车混行安全\",\"单台替代2-3名搬运工年省人力18万\",\"无需地面改造3天即可上线\",\"投资回收期短至14个月\"]"],
  "quality": "优质/良好/一般",
  "shots": [
    {
      "startTime": 0, "endTime": 0,
      "description": "≥60字画面描述",
      "scene": "场景",
      "objects": "物体",
      "action": "动作",
      "camera": "镜头",
      "coreSellingPoint": "核心卖点"
    }
  ]
}

这是 ${DURATION} 秒的整段视频，源 URL 已附上。请看完整个视频后按 JSON Schema 输出分镜打标结果。`;

(async () => {
  const t0 = Date.now();
  console.log(`📤 调用 MiniMax-M3: ${FILE_NAME} (${DURATION}s)`);
  console.log(`   URL: ${VIDEO_URL}`);
  console.log(`   Base: ${MINIMAX_BASE}`);
  console.log('');

  const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'video_url', video_url: { url: VIDEO_URL } },
          { type: 'text', text: userText },
        ]},
      ],
      response_format: { type: 'json_schema', json_schema: MINIMAX_JSON_SCHEMA },
      max_tokens: 32000,
    }),
  });

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✅ HTTP ${res.status} (${dt}s)\n`);

  const data = await res.json();
  const choice = data.choices?.[0];
  const usage = data.usage || {};

  console.log(`   finish_reason: ${choice?.finish_reason}`);
  console.log(`   prompt_tokens: ${usage.prompt_tokens}`);
  console.log(`   completion_tokens: ${usage.completion_tokens}`);
  console.log(`   reasoning_tokens: ${usage.completion_tokens_details?.reasoning_tokens || '?'}`);
  console.log(`   total_tokens: ${usage.total_tokens}`);
  console.log('');

  let raw = choice?.message?.content || '';
  console.log(`--- 原始输出（前 800 字）---`);
  console.log(raw.slice(0, 800));
  console.log('...');
  console.log('');

  // Strip think + fence
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();

  try {
    const result = JSON.parse(raw);
    console.log('=== 解析后的 JSON ===');
    console.log(`  productModel: ${result.productModel}`);
    console.log(`  industry: ${result.industry}`);
    console.log(`  categoryTags: ${(result.categoryTags||[]).join(' / ')}`);
    console.log(`  sellingPointTags: ${(result.sellingPointTags||[]).join(' / ')}`);
    console.log(`  quality: ${result.quality}`);
    console.log(`  shotCount: ${(result.shots||[]).length}`);
    console.log('');
    console.log('--- 分镜明细 ---');
    for (const [i, s] of (result.shots || []).entries()) {
      console.log(`  #${i} [${s.startTime}s → ${s.endTime}s] ${(s.endTime - s.startTime).toFixed(1)}s`);
      console.log(`     desc: ${(s.description||'').slice(0, 100)}...`);
      console.log(`     scene: ${s.scene}`);
      console.log(`     objects: ${(s.objects||'').slice(0, 60)}`);
      console.log(`     action: ${s.action}`);
      console.log(`     camera: ${s.camera}`);
      console.log(`     sellingPoint: ${s.coreSellingPoint}`);
    }
  } catch (e) {
    console.log('❌ JSON parse failed:', e.message);
    console.log('--- raw after strip ---');
    console.log(raw.slice(0, 2000));
  }
})().catch(e => console.error('ERR:', e.message));