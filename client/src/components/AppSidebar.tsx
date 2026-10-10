import { NavLink, useLocation } from 'react-router-dom'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  FolderOpen,
} from 'lucide-react'
import { useRole, type Role } from '@/contexts/RoleContext'

interface NavItem {
  path: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const ROLE_NAV_ITEMS: Record<Role, NavItem[]> = {
  // 运营视角：与管理员素材库权限对齐（都能看产品素材库 + 员工素材库）
  operator: [
    { path: '/materials', label: '素材库', icon: FolderOpen },
  ],
  // 业务员视角：只保留「我的素材库」一个入口。点进去自动跳转自己姓名下的视频列表，
  // 里面的上传 / 修改 / 查找 / 删除 都直接调云端飞书接口。
  user: [
    { path: '/materials', label: '我的素材库', icon: FolderOpen },
  ],
  // 系统管理员：按用户要求也只保留素材库入口，先隐藏「总览驾驶舱」与「后台管理」。
  admin: [
    { path: '/materials', label: '素材库', icon: FolderOpen },
  ],
}

export default function AppSidebar() {
  const { pathname } = useLocation()
  const { role } = useRole()
  const navItems: NavItem[] = ROLE_NAV_ITEMS[role]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3 group-data-[state=collapsed]:px-0 group-data-[state=collapsed]:justify-center">
          <div className="size-8 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
            AI
          </div>
          <div className="flex-1 min-w-0 group-data-[state=collapsed]:hidden">
            <div className="text-sm font-semibold truncate">内容生产平台</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-2">
          <SidebarMenu>
            {navItems.map((item: NavItem) => {
              const Icon = item.icon
              const isActive =
                item.path === '/'
                  ? pathname === '/'
                  : pathname === item.path || pathname.startsWith(`${item.path}/`)
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild tooltip={item.label} isActive={isActive}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className="flex items-center gap-2"
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="group-data-[state=collapsed]:hidden">{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      {/* 用户要求去掉左下角硬编码的用户信息卡片（卓锦华 / 飞行社） */}
    </Sidebar>
  )
}