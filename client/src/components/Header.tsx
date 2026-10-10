import { useNavigate } from 'react-router-dom'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, UserCircle2 } from 'lucide-react'
import { USER_ROLE_LABEL, type UserRole } from '@shared/api.interface'
import { toast } from 'sonner'

const ROLE_BADGE_VARIANT: Record<UserRole, 'default' | 'secondary' | 'outline'> = {
  admin: 'outline',
  operator: 'default',
  user: 'secondary',
}

export default function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const role: UserRole = (user?.role || 'user') as UserRole

  const handleLogout = async () => {
    await logout()
    toast.success('已退出登录')
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 z-40 w-full bg-background/80 backdrop-blur-md border-b border-border/30">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <SidebarTrigger className="md:hidden" />
          <span className="text-sm font-medium text-muted-foreground hidden md:inline">
            AI 批量营销内容生产系统
          </span>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted transition-colors">
                  <UserCircle2 className="size-5 text-muted-foreground" />
                  <div className="text-left leading-tight">
                    <div className="text-sm font-medium text-foreground">{user.name}</div>
                    <div className="text-[10px] text-muted-foreground">@{user.username}</div>
                  </div>
                  <Badge variant={ROLE_BADGE_VARIANT[role]} className="text-[10px] h-5 px-1.5">
                    {USER_ROLE_LABEL[role]}
                  </Badge>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    角色：{USER_ROLE_LABEL[role]}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <LogOut className="size-4 mr-2" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" onClick={() => navigate('/login')}>
              登录
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
