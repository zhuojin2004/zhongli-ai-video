// 小批测试：选 1 个原始小视频 + 1 个压缩版视频，跑完整流程
import { config } from 'dotenv'
config({ path: '/Users/jensen/Downloads/zhongli-src/.env' })

// 动态 import 主脚本
import('./task_cde_ingest.mjs').catch(e => { console.error('import err:', e); process.exit(1) })
