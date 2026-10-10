import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import type { Connect } from 'connect'
import path from 'path'
import fs from 'fs'
import {
  MOCK_DASHBOARD,
  type IDashboardData,
} from '../src/data/dashboard'
import {
  getMaterialsSnapshot,
  deleteMaterial as deleteMaterialFn,
  copyMaterial,
  createPendingMaterial,
  updateMaterialTags,
  type IMaterial,
  type UploadHistoryRecord,
  addUploadHistory,
  getUploadHistory,
  removeUploadHistory,
} from '../src/data/materials'
import {
  MOCK_HOT_TAGS,
  MOCK_COMPETITORS,
  MOCK_DEALER_CASES,
  MOCK_ITERATION_SUGGESTIONS,
} from '../src/data/iteration'
import { MOCK_AUTHORIZATION_RECORDS, type IAuthorizationRecord } from '../src/data/authorization'
import { MOCK_VIDEO_TAGS, type VideoTagData } from '../src/data/video-tags'
import {
  generateMockShotTags,
  MOCK_PRODUCTION_TASKS,
  type IProductionTask,
} from '../src/data/production'

// In-memory task store (mutable)
let tasks: IProductionTask[] = [...MOCK_PRODUCTION_TASKS]

// Authorization in-memory store
let authRecords: IAuthorizationRecord[] = [...MOCK_AUTHORIZATION_RECORDS]

// ─── Helpers ───────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data }))
}

function sendError(res: ServerResponse, message: string, status = 500): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ message }))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

// Normalize URL: strip query string and trailing slash
function normalizeUrl(rawUrl: string): string {
  const q = rawUrl.indexOf('?')
  const base = q >= 0 ? rawUrl.substring(0, q) : rawUrl
  return base.replace(/\/$/, '') || '/'
}

// ─── API Handler ───────────────────────────────────────────────────────────

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = normalizeUrl(req.url ?? '')
  const method = (req.method ?? 'GET').toUpperCase()

  // ─── Dashboard ─────────────────────────────────────────────────────────
  if (url === '/api/dashboard' && method === 'GET') {
    sendJson(res, MOCK_DASHBOARD as IDashboardData)
    return
  }

  // ─── Iteration ──────────────────────────────────────────────────────────
  if (url === '/api/iteration' && method === 'GET') {
    sendJson(res, {
      hotTags: MOCK_HOT_TAGS,
      competitors: MOCK_COMPETITORS,
      dealerCases: MOCK_DEALER_CASES,
      suggestions: MOCK_ITERATION_SUGGESTIONS,
    })
    return
  }

  // ─── Authorization ──────────────────────────────────────────────────────
  if (url === '/api/authorization') {
    if (method === 'GET') {
      sendJson(res, authRecords)
      return
    }
    if (method === 'POST') {
      const body = await readBody(req)
      try {
        const dto = JSON.parse(body)
        const newRecord: IAuthorizationRecord = {
          id: `auth_${Date.now()}`,
          name: dto.name ?? '',
          type: dto.type ?? 'employee',
          status: dto.status ?? 'pending',
          method: dto.method ?? 'paid',
          amount: dto.amount ?? 2999,
          authorizedDate: dto.authorizedDate ?? new Date().toISOString().split('T')[0],
          expiryDate: dto.expiryDate ?? '',
          contact: dto.contact ?? '',
        }
        authRecords.push(newRecord)
        sendJson(res, newRecord)
      } catch {
        sendError(res, 'Invalid body', 400)
      }
      return
    }
  }

  if (url.startsWith('/api/authorization/')) {
    const id = url.split('/')[3]
    const idx = authRecords.findIndex((r) => r.id === id)
    if (idx === -1) { sendError(res, 'Not found', 404); return }
    if (method === 'PATCH') {
      const body = await readBody(req)
      try {
        const updates = JSON.parse(body)
        authRecords[idx] = { ...authRecords[idx], ...updates }
        sendJson(res, authRecords[idx])
      } catch {
        sendError(res, 'Invalid body', 400)
      }
      return
    }
  }

  // ─── Materials ──────────────────────────────────────────────────────────
  if (url === '/api/materials') {
    if (method === 'GET') {
      sendJson(res, getMaterialsSnapshot())
      return
    }
    if (method === 'POST') {
      const body = await readBody(req)
      try {
        const dto = JSON.parse(body)
        if (dto.fileName && dto.downloadUrl) {
          const id = createPendingMaterial(dto.fileName, dto.downloadUrl)
          const mat = getMaterialsSnapshot().find((m) => m.id === id)
          sendJson(res, mat)
        } else {
          sendError(res, 'fileName and downloadUrl required', 400)
        }
      } catch {
        sendError(res, 'Invalid body', 400)
      }
      return
    }
  }

  if (url === '/api/materials/import' && method === 'POST') {
    sendJson(res, { count: 0 })
    return
  }

  const matParts = url.split('/')
  if (matParts[1] === 'api' && matParts[2] === 'materials' && matParts.length === 4) {
    const id = matParts[3]
    if (method === 'DELETE') {
      deleteMaterialFn(id)
      sendJson(res, undefined)
      return
    }
    if (method === 'PATCH') {
      const body = await readBody(req)
      try {
        const updates = JSON.parse(body)
        updateMaterialTags(id, updates)
        const mat = getMaterialsSnapshot().find((m) => m.id === id)
        sendJson(res, mat)
      } catch {
        sendError(res, 'Invalid body', 400)
      }
      return
    }
  }

  // ─── Video Tags / Shots ─────────────────────────────────────────────────
  if ((url === '/api/video/shots' || url === '/api/video') && method === 'GET') {
    sendJson(res, MOCK_VIDEO_TAGS)
    return
  }

  if (url === '/api/video/analyze' && method === 'POST') {
    const body = await readBody(req)
    try {
      const dto = JSON.parse(body)
      const result = generateMockShotTags(dto.productName ?? '产品', dto.script ?? '默认脚本')
      sendJson(res, result)
    } catch {
      sendError(res, 'Invalid body', 400)
    }
    return
  }

  // ─── Production Tasks ───────────────────────────────────────────────────
  if (url === '/api/production/tasks') {
    if (method === 'GET') {
      sendJson(res, tasks)
      return
    }
    if (method === 'POST') {
      const body = await readBody(req)
      try {
        const dto = JSON.parse(body)
        const newTask: IProductionTask = {
          id: `task_${Date.now()}`,
          productName: dto.productName ?? '新产品',
          script: dto.script ?? '',
          status: '待脚本',
          assignee: dto.assignee ?? '',
          assigneeAvatar: '',
          tags: dto.tags ?? [],
          videoUrl: '',
          keyframes: [],
        }
        tasks.push(newTask)
        sendJson(res, newTask)
      } catch {
        sendError(res, 'Invalid body', 400)
      }
      return
    }
  }

  const taskParts = url.split('/')
  if (taskParts[1] === 'api' && taskParts[2] === 'production' && taskParts[3] === 'tasks' && taskParts.length === 5) {
    const id = taskParts[4]
    const idx = tasks.findIndex((t) => t.id === id)
    if (idx === -1) { sendError(res, 'Not found', 404); return }
    if (method === 'PATCH') {
      const body = await readBody(req)
      try {
        const updates = JSON.parse(body)
        tasks[idx] = { ...tasks[idx], ...updates }
        sendJson(res, tasks[idx])
      } catch {
        sendError(res, 'Invalid body', 400)
      }
      return
    }
    if (method === 'DELETE') {
      tasks.splice(idx, 1)
      sendJson(res, undefined)
      return
    }
  }

  // ─── Video Editing / Clip ───────────────────────────────────────────────
  if (url === '/api/video-editing/clip' && method === 'POST') {
    sendJson(res, { taskId: `clip_${Date.now()}`, status: 'pending' })
    return
  }

  // ─── Workflow ───────────────────────────────────────────────────────────
  if (url === '/api/workflow/runs') {
    if (method === 'GET') { sendJson(res, []); return }
    if (method === 'POST') { sendJson(res, { runId: `run_${Date.now()}`, status: 'running' }); return }
  }

  // ─── Clip History ───────────────────────────────────────────────────────
  if (url === '/api/clip-history' && method === 'GET') {
    sendJson(res, [])
    return
  }

  // Unknown API — 404
  sendError(res, `Not found: ${method} ${url}`, 404)
}

// ─── Plugin ─────────────────────────────────────────────────────────────────
// The /api/* routes are handled by the Vite proxy → mock API server (port 9099).
// This plugin only:
//   1. Serves the transformed index.html at the root path (/) — this is done
//      by intercepting the httpServer 'request' event BEFORE the Express chain.
//   2. Provides a configureServer hook that adds nothing (proxy handles /api/*).
// We use httpServer.on('request') for HTML because the Express middleware chain
// can't intercept '/' (indexHtmlMiddleware returns index.html for any path).
export function mockApiPlugin(): Plugin {
  return {
    name: 'vite-plugin-mock-api',
    configureServer(server) {
      // Intercept ALL requests at the HTTP level — fires BEFORE Express middleware.
      // This is the ONLY way to serve index.html for '/' without triggering the
      // indexHtmlMiddleware → transformIndexHtml → (loop) → 500 error.
      server.httpServer?.on('request', (req, res) => {
        const url = (req as any).url ?? ''
        const normalized = url.split('?')[0].replace(/\/$/, '') || '/'

        if (normalized === '/' || normalized === '') {
          const htmlPath = path.resolve(process.cwd(), 'client/index.html')
          const rawHtml = fs.readFileSync(htmlPath, 'utf-8')
          // Use '/client/index.html' as the URL so relative paths in the HTML
          // (e.g. src="client/src/index.tsx") resolve correctly.
          server.transformIndexHtml('/client/index.html', rawHtml).then((html) => {
            res.writeHead(200, {
              'Content-Type': 'text/html',
              'Cache-Control': 'no-cache',
            })
            res.end(html)
          }).catch(() => {
            res.writeHead(500)
            res.end('Failed to transform HTML')
          })
        }
        // All other requests (/api/*, /@id/..., /src/..., etc.) are NOT handled
        // here — they fall through to Vite's built-in middleware (proxy for /api/*,
        // transform for /@id/..., static serving for /src/..., etc.).
      })
    },
  }
}
