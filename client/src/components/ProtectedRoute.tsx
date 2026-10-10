import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2 } from 'lucide-react'

interface ProtectedRouteProps {
  children: ReactNode
  /**
   * 仅允许指定角色访问。留空 = 任何已登录用户都行。
   * 例如 allow={['admin']} 表示仅管理员可访问。
   */
  allow?: Array<'admin' | 'operator' | 'user'>
}

export default function ProtectedRoute({ children, allow }: ProtectedRouteProps) {
  const { isAuthed, user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (allow && user && !allow.includes(user.role)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
        <p className="text-4xl mb-2">🚫</p>
        <h2 className="text-lg font-semibold mb-1">无权访问此页面</h2>
        <p className="text-sm text-muted-foreground">
          当前身份为 <b>{user.name}</b>（角色：{user.role}），请用更高权限账号登录。
        </p>
      </div>
    )
  }

  return <>{children}</>
}
