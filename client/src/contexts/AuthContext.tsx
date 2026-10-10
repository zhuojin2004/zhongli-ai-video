import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@shared/api.interface'
import {
  fetchMe,
  getStoredToken,
  getStoredUser,
  installAuthInterceptor,
  login as apiLogin,
  logout as apiLogout,
  TOKEN_KEY,
  USER_KEY,
} from '@/api/auth'

interface AuthContextValue {
  user: User | null
  token: string
  loading: boolean
  /** 是否已登录（token + user 同时存在） */
  isAuthed: boolean
  login: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
  /** 用 /api/auth/me 重新拉一次 user（用于 header 显示更新） */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: '',
  loading: true,
  isAuthed: false,
  login: async () => { throw new Error('AuthProvider not mounted') },
  logout: async () => {},
  refresh: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser())
  const [token, setToken] = useState<string>(() => getStoredToken())
  const [loading, setLoading] = useState<boolean>(!!getStoredToken())

  /* 装上 axios 拦截器（全局一次） */
  useEffect(() => {
    installAuthInterceptor()
  }, [])

  /* 启动时如果有 token，就 /me 验证一下；失败就清空 */
  useEffect(() => {
    let alive = true
    const t = getStoredToken()
    if (!t) {
      setLoading(false)
      return
    }
    // ⚠️ P0 修复：只有「还没拿到过 user」时才在 fetchMe 失败时清登录态
    // 拿到过一次之后（无论启动验证还是后续轮询/聚焦），失败一律静默
    // 解决：
    //   1. 上传大视频 1-3 分钟，窗口失焦/聚焦时 fetchMe 失败被误踢回登录页
    //   2. 冷启动后端慢，初始 fetchMe 超时把有效用户踢回登录页
    let authEstablished = false
    const doFetchMe = (): void => {
      if (!alive) return
      fetchMe()
        .then((u) => {
          if (!alive) return
          setUser(u)
          setToken(t)
          authEstablished = true
        })
        .catch(() => {
          if (!alive) return
          if (!authEstablished) {
            // 只有从未成功拿到过 user 时才清（防止冷启动假阴性）
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem(USER_KEY)
            setUser(null)
            setToken('')
          }
          // else: 已建立过 user，失败就保留登录态，等下次成功再刷新
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }
    doFetchMe()

    // ⚠️ P2 修复：5 分钟轮询 + 窗口聚焦刷新，避免管理员调整某用户角色后该用户必须手动刷新浏览器
    const POLL_MS = 5 * 60 * 1000
    const timer = setInterval(doFetchMe, POLL_MS)
    const onFocus = (): void => { doFetchMe() }
    window.addEventListener('focus', onFocus)

    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const r = await apiLogin(username, password)
    setUser(r.user)
    setToken(r.token)
    return r.user
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
    setToken('')
  }, [])

  const refresh = useCallback(async () => {
    try {
      const u = await fetchMe()
      setUser(u)
    } catch {
      /* ignore */
    }
  }, [])

  const value: AuthContextValue = {
    user,
    token,
    loading,
    isAuthed: !!user && !!token,
    login,
    logout,
    refresh,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
