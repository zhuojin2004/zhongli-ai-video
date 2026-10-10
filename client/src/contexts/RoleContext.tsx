import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'

/**
 * RoleContext 现在不再维护独立状态，而是直接从 AuthContext 派生。
 * 保留导出 `Role` 类型和 `useRole` hook，避免既有页面改动太大。
 */
export type Role = 'admin' | 'operator' | 'user'

interface RoleContextValue {
  role: Role
  /** 兼容历史调用：保留 setRole 但改为 no-op，提示用 login() 切换身份 */
  setRole: (role: Role) => void
}

const roleContextDefaultValue: RoleContextValue = {
  role: 'user',
  setRole: () => {
    console.warn('[RoleContext] setRole 已废弃，请改用 AuthContext.login()/logout()')
  },
}

const RoleContext = createContext<RoleContextValue>(roleContextDefaultValue)

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const role: Role = (user?.role || 'user') as Role

  return (
    <RoleContext.Provider
      value={{
        role,
        setRole: () => {
          console.warn('[RoleContext] setRole 已废弃，请改用 AuthContext.login()/logout() 切换身份')
        },
      }}
    >
      {children}
    </RoleContext.Provider>
  )
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext)
}
