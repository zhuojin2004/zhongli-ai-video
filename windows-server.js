/**
 * Windows-only static + API proxy server for 中力视频生产平台
 * 用法: node windows-server.js
 *
 * 端口 8080 监听公网请求:
 *   - /api/*        反代到 127.0.0.1:9099 (mockApiServer)
 *   - 其他请求      从 dist/client 提供静态文件（SPA fallback 到 index.html）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.WEB_PORT || 8080);
const API_PORT = Number(process.env.API_PORT || 9099);
const DIST = path.resolve(__dirname, 'dist', 'client');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.map':   'application/json; charset=utf-8',
};

function proxyToApi(req, res) {
  const opts = {
    hostname: '127.0.0.1',
    port: API_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
  };
  const upstream = http.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`[zhongli-web] API server (127.0.0.1:${API_PORT}) unavailable: ${e.message}`);
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  // 解码 URL，去掉 query string
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const fullPath = path.join(DIST, urlPath);

  // 防 path traversal
  if (!fullPath.startsWith(DIST)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  let target = fullPath;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // SPA fallback
    target = path.join(DIST, 'index.html');
  }

  const ext = path.extname(target).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600');
  fs.createReadStream(target).pipe(res);
}

if (!fs.existsSync(DIST)) {
  console.error(`[zhongli-web] 静态目录不存在: ${DIST}`);
  console.error(`[zhongli-web] 请先运行 npm run build:client`);
  process.exit(1);
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') {
    return proxyToApi(req, res);
  }
  serveStatic(req, res);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[zhongli-web] listening on http://0.0.0.0:${PORT}`);
  console.log(`[zhongli-web]   static: ${DIST}`);
  console.log(`[zhongli-web]   proxy:  /api/* -> 127.0.0.1:${API_PORT}`);
});