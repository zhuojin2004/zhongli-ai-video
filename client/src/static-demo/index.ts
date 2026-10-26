/**
 * 静态演示版 Mock 层
 *
 * 在 VITE_STATIC_DEMO=true 构建时，给 axios 实例注入自定义 adapter，
 * 所有 /api 请求直接由导出的真实数据（OSS 直链）响应，无需后端：
 *   - 可浏览产品/员工分组、下钻、查看分镜
 *   - 视频走 OSS 公共直链，可真实播放
 *   - 写操作（上传/删除/改名/同步）返回成功但不落库，仅用于界面演示
 */
import type {
  AxiosInstance,
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import products from './data/products.json'
import employees from './data/employees.json'
import productDetails from './data/productDetails.json'
import employeeDetails from './data/employeeDetails.json'
import videoDetails from './data/videoDetails.json'

/** 演示模式过滤的测试脏数据（产品型号） */
const DIRTY_MODELS = new Set<string>([
  '邀约测试-中文',
  'upload_1791642037688',
  'upload_1788329355709',
  'upload_1788327937279',
  '邀约-4',
])

/** 演示登录用户：admin，可看到完整双素材库（不被业务员视角限制） */
const demoUser = {
  id: 'static-demo-admin',
  username: 'demo',
  name: '演示管理员',
  role: 'admin' as const,
  createdAt: '2026-10-01T00:00:00.000Z',
}

function parseUrl(url: string): { pathname: string; query: URLSearchParams } {
  const qIdx = url.indexOf('?')
  const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url
  const qs = qIdx >= 0 ? url.slice(qIdx + 1) : ''
  return { pathname, query: new URLSearchParams(qs) }
}

/** 对导出的完整明细做内存分页（导出时已聚合全部视频） */
function paginateDetail(
  detail: Record<string, unknown> | null,
  listKey: string,
  query: URLSearchParams,
): Record<string, unknown> | null {
  if (!detail) return null
  const page = Math.max(1, Number(query.get('page') || 1))
  const pageSize = Math.max(1, Number(query.get('pageSize') || 12))
  const all = (detail[listKey] as unknown[]) || []
  const start = (page - 1) * pageSize
  const slice = all.slice(start, start + pageSize)
  return {
    ...detail,
    [listKey]: slice,
    total: all.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
  }
}

function route(config: InternalAxiosRequestConfig): AxiosResponse {
  const method = (config.method || 'get').toLowerCase()
  const { pathname, query } = parseUrl(config.url || '')
  let body: unknown = null

  // ── 认证 ─────────────────────────────────────────────────────────────
  if (pathname === '/api/auth/login' && method === 'post') {
    body = { data: { token: 'static-demo-token', user: demoUser } }
  } else if (pathname === '/api/auth/me') {
    body = { data: { user: demoUser } }
  } else if (pathname === '/api/auth/logout') {
    body = { ok: true }
  } else if (pathname === '/api/auth/users') {
    // 用户管理类接口：返回安全空集合
    body = { users: [], data: { users: [] } }
  } else if (pathname === '/api/library/products') {
    // ── 产品分组（过滤脏数据） ──
    body = {
      data: (products as Array<{ productModel: string }>).filter(
        (p) => !DIRTY_MODELS.has(p.productModel),
      ),
    }
  } else if (pathname === '/api/library/employees') {
    body = { data: employees }
  } else {
    // ── 产品型号下钻 ──
    let m = pathname.match(/^\/api\/library\/product\/(.+)$/)
    if (m) {
      const model = decodeURIComponent(m[1])
      body = {
        data: paginateDetail(
          (productDetails as Record<string, Record<string, unknown>>)[model] || null,
          'videos',
          query,
        ),
      }
    } else {
      // ── 员工下钻 ──
      m = pathname.match(/^\/api\/library\/employee\/(.+)$/)
      if (m) {
        const name = decodeURIComponent(m[1])
        body = {
          data: paginateDetail(
            (employeeDetails as Record<string, Record<string, unknown>>)[name] || null,
            'videos',
            query,
          ),
        }
      } else {
        // ── 视频详情 / 删除 / 改名 ──
        m = pathname.match(/^\/api\/library\/video\/(.+)$/)
        if (m) {
          const id = decodeURIComponent(m[1])
          if (method === 'get') {
            body = {
              data: (videoDetails as Record<string, unknown>)[id] || null,
            }
          } else {
            // DELETE / PATCH：演示模式返回成功（不落库）
            body = { data: { ok: true, materialId: id, demo: true } }
          }
        } else if (pathname.match(/^\/api\/library\/shot\//)) {
          // 分镜修改/删除：演示模式返回成功
          body = {
            data: {
              ok: true,
              feishuUpdated: false,
              dbUpdated: false,
              feishuError: 'static-demo',
            },
          }
        } else if (pathname === '/api/library/search') {
          // 关键词搜索：在全部视频里做标题匹配
          const q = (query.get('q') || '').toLowerCase()
          const limit = Number(query.get('limit') || 50)
          const all = Object.values(videoDetails as Record<string, any>)
          const items = q
            ? all.filter((v) =>
                [v.productName, v.productModel, v.fileName, v.personName]
                  .filter(Boolean)
                  .some((s) => String(s).toLowerCase().includes(q)),
              )
            : all
          body = { data: { query: q, total: items.length, items: items.slice(0, limit) } }
        } else {
          // 其余接口（含上传、同步、dashboard 等）：安全空响应
          body = { data: {} }
        }
      }
    }
  }

  return {
    data: body,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }
}

const staticAdapter: AxiosAdapter = (config) =>
  new Promise((resolve) => {
    // 微小延迟，让骨架屏/加载态逻辑正常工作
    setTimeout(() => resolve(route(config)), 60)
  })

/** 给一个 axios 实例安装静态演示 adapter */
export function installStaticDemo(instance: AxiosInstance): void {
  instance.defaults.adapter = staticAdapter
}
