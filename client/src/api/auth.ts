import { localAxios } from '@/utils/localAxios'
import type {
  LoginRequest,
  LoginResponse,
  User,
  CreateUserDto,
  UpdateUserDto,
} from '@shared/api.interface'

const TOKEN_KEY = 'zl_auth_token'
const USER_KEY = 'zl_auth_user'

/* token 在 localStorage + axios header 全局生效 */
export function getStoredToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as User } catch { return null }
}

function persist(token: string, user: User) {
  if (typeof window === 'undefined') return
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

function clear() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/* 给 localAxios 装一个请求拦截器，自动带 Authorization */
let interceptorInstalled = false
export function installAuthInterceptor(): void {
  if (interceptorInstalled) return
  interceptorInstalled = true
  localAxios.interceptors.request.use((config) => {
    const t = getStoredToken()
    if (t) config.headers.Authorization = `Bearer ${t}`
    return config
  })
}

/* ─── API: /api/auth/* ─────────────────────────────────────────────────── */

export async function login(username: string, password: string): Promise<LoginResponse> {
  const data = await localAxios({
    url: '/api/auth/login',
    method: 'POST',
    data: { username, password } satisfies LoginRequest,
  })
  // mock server wraps everything in {data}; interceptor already unwrapped once.
  // Shape: {data: {token, user}}
  const payload = (data && (data as any).data) ? (data as any).data : data
  persist(payload.token, payload.user)
  return payload as LoginResponse
}

export async function logout(): Promise<void> {
  try {
    await localAxios({ url: '/api/auth/logout', method: 'POST' })
  } catch {
    /* 即使失败也要本地清空 */
  }
  clear()
}

export async function fetchMe(): Promise<User> {
  const data = await localAxios({ url: '/api/auth/me', method: 'GET' })
  const payload = (data && (data as any).user) ? (data as any) : data
  const user = (payload.data?.user || payload.user) as User
  // 同步刷新本地 user（防止 name/role 变化未生效）
  const token = getStoredToken()
  if (token && user) persist(token, user)
  return user
}

export async function listUsers(): Promise<User[]> {
  const data = await localAxios({ url: '/api/auth/users', method: 'GET' })
  const users = ((data as any).users || (data as any).data?.users || []) as User[]
  return users
}

export async function createUser(dto: CreateUserDto): Promise<{ ok: boolean; recordId?: string }> {
  const r = await localAxios({ url: '/api/auth/users', method: 'POST', data: dto })
  return (r as any).data ?? r
}

export async function updateUser(id: string, dto: UpdateUserDto): Promise<{ ok: boolean }> {
  const r = await localAxios({ url: `/api/auth/users/${id}`, method: 'PATCH', data: dto })
  return (r as any).data ?? r
}

export async function deleteUser(id: string): Promise<{ ok: boolean }> {
  const r = await localAxios({ url: `/api/auth/users/${id}`, method: 'DELETE' })
  return (r as any).data ?? r
}

export { TOKEN_KEY, USER_KEY }
