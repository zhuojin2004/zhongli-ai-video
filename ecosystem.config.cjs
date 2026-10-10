/**
 * pm2 进程配置 - Windows / Linux 通用
 *
 * 启动 2 个进程：
 *   1. zhongli-api  - mockApiServer.js (端口 9099，提供 API)
 *   2. zhongli-web  - windows-server.js (端口 8080，提供前端 + 反代 /api)
 *
 * Linux 下可以把 windows-server.js 换成 nginx 静态服务 + 反代（参考 deploy/deploy.sh）
 */
const path = require('path')

const cwd = path.resolve(__dirname).replace(/\\/g, '/')
const logs = path.join(cwd, 'logs').replace(/\\/g, '/')

module.exports = {
  apps: [
    {
      name: 'zhongli-api',
      script: 'client/vite/mockApiServer.js',
      cwd,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '9099',
      },
      out_file: path.join(logs, 'pm2-api.log').replace(/\\/g, '/'),
      error_file: path.join(logs, 'pm2-api-error.log').replace(/\\/g, '/'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '512M',
    },
    {
      name: 'zhongli-web',
      script: 'windows-server.js',
      cwd,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WEB_PORT: '8080',
        API_PORT: '9099',
      },
      out_file: path.join(logs, 'pm2-web.log').replace(/\\/g, '/'),
      error_file: path.join(logs, 'pm2-web-error.log').replace(/\\/g, '/'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '256M',
    },
  ],
}