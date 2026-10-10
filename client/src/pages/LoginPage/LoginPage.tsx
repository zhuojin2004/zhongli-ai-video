import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2, Eye, EyeOff, Lock, User as UserIcon, ArrowRight, Sparkles, FolderOpen, BarChart3, ShieldCheck, Briefcase, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { USER_ROLE_LABEL, type UserRole } from '@shared/api.interface'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/* ────────────────────────────────────────────────────────────────
   左侧品牌区子组件
   ──────────────────────────────────────────────────────────────── */

function BrandLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative size-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30">
        <span className="text-white font-black text-lg italic">A</span>
        <span className="absolute -bottom-0.5 -right-0.5 text-cyan-300 text-xs font-bold">i</span>
      </div>
      <div className="leading-tight">
        <div className="text-white font-bold text-base">中力 AI</div>
        <div className="text-[11px] text-slate-400">AI短视频运营系统</div>
      </div>
    </div>
  )
}

function HeroCopy() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-black text-white leading-tight tracking-tight">
        AI 赋能短视频运营
      </h1>
      <div className="text-base sm:text-lg text-slate-300">
        让创作
        <span className="text-cyan-400 font-bold mx-1">更简单</span>
        <span className="text-slate-500 mx-0.5">·</span>
        运营
        <span className="text-cyan-400 font-bold mx-1">更高效</span>
      </div>
      <div className="text-sm text-slate-400 leading-relaxed">
        从素材管理、AI创作到数据分析<br />
        打造短视频运营的全流程解决方案
      </div>
    </div>
  )
}

type Feature = { icon: typeof Sparkles; title: string; desc: string }
const FEATURES: Feature[] = [
  {
    icon: Sparkles,
    title: 'AI 智能创作',
    desc: 'AI 脚本生成 · 智能剪辑\n批量创作优质视频',
  },
  {
    icon: FolderOpen,
    title: '素材统一管理',
    desc: '视频 · 图片 · 文案\n集中管理 · 高效取用',
  },
  {
    icon: BarChart3,
    title: '数据分析洞察',
    desc: '多维度数据分析\n优化内容策略',
  },
]

function FeatureCards() {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
      {FEATURES.map((f) => {
        const Icon = f.icon
        return (
          <div
            key={f.title}
            className="rounded-xl bg-slate-900/60 border border-blue-500/15 backdrop-blur-sm p-3 sm:p-3.5 hover:border-blue-400/40 transition-colors"
          >
            <div className="size-8 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center mb-2">
              <Icon className="size-4" />
            </div>
            <div className="text-white text-xs sm:text-sm font-bold mb-0.5">{f.title}</div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 leading-snug whitespace-pre-line">
              {f.desc}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 左下角场记板装饰（与之前同款，但更紧凑，作为氛围元素）
 */
function ClapperboardDecor() {
  return (
    <svg
      viewBox="0 0 480 260"
      xmlns="http://www.w3.org/2000/svg"
      className="block w-full max-w-sm h-auto mx-auto sm:mx-0"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <radialGradient id="r1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0" />
          <stop offset="70%" stopColor="#3b82f6" stopOpacity="0.18" />
          <stop offset="92%" stopColor="#3b82f6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="b1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <pattern id="s1" patternUnits="userSpaceOnUse" width="18" height="28" patternTransform="skewX(-22)">
          <rect width="18" height="28" fill="#1d4ed8" />
          <rect width="9" height="28" fill="#93c5fd" opacity="0.85" />
        </pattern>
      </defs>

      {/* 光圈 */}
      <ellipse cx="240" cy="140" rx="220" ry="80" fill="url(#r1)" opacity="0.85" />
      <ellipse cx="240" cy="148" rx="180" ry="60" fill="none" stroke="#3b82f6" strokeWidth="1" opacity="0.5" />
      <ellipse cx="240" cy="148" rx="140" ry="44" fill="none" stroke="#60a5fa" strokeWidth="0.8" opacity="0.4" />
      <ellipse cx="240" cy="180" rx="220" ry="18" fill="#3b82f6" opacity="0.18" />

      {/* 场记板 */}
      <g transform="translate(110, 70)">
        {/* 顶条 */}
        <g transform="rotate(-12 50 25)">
          <rect x="-10" y="10" width="270" height="30" rx="4" fill="url(#b1)" />
          <rect x="-10" y="10" width="270" height="30" rx="4" fill="url(#s1)" />
          <circle cx="2" cy="25" r="4" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" />
          <circle cx="2" cy="25" r="1.5" fill="#60a5fa" />
        </g>
        {/* 主板 */}
        <rect x="0" y="48" width="260" height="130" rx="12" fill="url(#b1)" />
        <rect x="5" y="53" width="250" height="120" rx="9" fill="none" stroke="#1d4ed8" strokeWidth="1" opacity="0.6" />
        {/* 播放按钮 */}
        <g transform="translate(130, 113)">
          <circle r="40" fill="#0b1530" opacity="0.35" />
          <circle r="32" fill="none" stroke="#bfdbfe" strokeWidth="1.2" opacity="0.5" />
          <polygon points="-10,-14 -10,14 16,0" fill="#ffffff" />
        </g>
        <rect x="0" y="48" width="260" height="26" rx="12" fill="white" opacity="0.06" />
      </g>

      {/* 星点 */}
      <g fill="#60a5fa" opacity="0.5">
        <circle cx="40" cy="40" r="1" />
        <circle cx="440" cy="60" r="1" />
        <circle cx="60" cy="220" r="1" />
        <circle cx="430" cy="220" r="1" />
      </g>
    </svg>
  )
}

function BrandFooter() {
  return (
    <div className="text-[11px] text-slate-500 text-center sm:text-left">
      © 2024 中力 AI 短视频运营系统 <span className="mx-1">|</span> 让短视频运营更简单更高效
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
   右侧登录卡
   ──────────────────────────────────────────────────────────────── */

const ROLES: Array<{ role: UserRole; icon: typeof Users; desc: string }> = [
  { role: 'operator', icon: Users, desc: '内容创作、发布\n数据分析、运营管理' },
  { role: 'user', icon: Briefcase, desc: '素材浏览、需求提交\n内容查看、沟通协作' },
  { role: 'admin', icon: ShieldCheck, desc: '系统管理、权限设置\n团队管理、数据总览' },
]

function RoleCards() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ROLES.map(({ role, icon: Icon, desc }) => {
        const colors: Record<UserRole, string> = {
          operator: 'text-blue-400 bg-blue-500/15 border-blue-500/20',
          user: 'text-purple-400 bg-purple-500/15 border-purple-500/20',
          admin: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/20',
        }
        return (
          <div
            key={role}
            className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-2.5 sm:p-3 text-center"
          >
            <div className={`size-7 mx-auto rounded-lg flex items-center justify-center mb-1.5 border ${colors[role]}`}>
              <Icon className="size-3.5" />
            </div>
            <div className="text-white text-xs font-bold mb-0.5">{USER_ROLE_LABEL[role]}</div>
            <div className="text-[10px] text-slate-400 leading-snug whitespace-pre-line">{desc}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
   主页面
   ──────────────────────────────────────────────────────────────── */

export default function LoginPage() {
  const { login, isAuthed } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)

  /* 已登录就直接跳过 */
  if (isAuthed) {
    const target = (location.state as any)?.from || '/'
    navigate(target, { replace: true })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      toast.error('请填写账号和密码')
      return
    }
    setBusy(true)
    try {
      const u = await login(username.trim(), password)
      toast.success(`欢迎回来，${u.name}`, {
        description: `当前身份：${USER_ROLE_LABEL[u.role]}`,
      })
      const target = (location.state as any)?.from || '/'
      navigate(target, { replace: true })
    } catch (e) {
      toast.error('登录失败', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-[#020617] via-[#0a1628] to-[#020617] text-slate-100 overflow-x-hidden">
      <div className="min-h-screen w-full flex flex-col lg:flex-row">

        {/* ── 左侧品牌区（手机端在上、桌面端占 ~55%） ── */}
        <div className="relative w-full lg:w-[55%] lg:flex-shrink-0 flex flex-col px-5 sm:px-8 lg:px-12 py-6 sm:py-8 lg:py-10 gap-6 sm:gap-8">
          <BrandLogo />
          <div className="space-y-6 sm:space-y-8 lg:mt-4 lg:max-w-xl">
            <HeroCopy />
            <FeatureCards />
          </div>
          <div className="hidden sm:block lg:mt-auto">
            <ClapperboardDecor />
          </div>
          <div className="hidden sm:block">
            <BrandFooter />
          </div>
        </div>

        {/* ── 右侧登录卡（手机端在下） ── */}
        <div className="w-full lg:flex-1 flex items-center justify-center px-5 sm:px-8 py-8 sm:py-10 lg:py-0">
          <div className="w-full max-w-md">
            <form
              onSubmit={handleSubmit}
              className="space-y-4 sm:space-y-5 bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-5 sm:p-7 shadow-2xl shadow-black/40"
            >
              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  欢迎<span className="text-cyan-400">回来</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-400">
                  登录您的工作台，开启高效创作之旅
                </p>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-slate-300">账号</Label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                    <Input
                      id="username"
                      autoFocus
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入账号"
                      disabled={busy}
                      className="pl-9 bg-slate-950/60 border-slate-700/60 focus-visible:ring-cyan-500/50"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-slate-300">密码</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                    <Input
                      id="password"
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入密码"
                      disabled={busy}
                      className="pl-9 pr-10 bg-slate-950/60 border-slate-700/60 focus-visible:ring-cyan-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                      tabIndex={-1}
                      aria-label={showPwd ? '隐藏密码' : '显示密码'}
                    >
                      {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={busy}
                className="w-full h-11 sm:h-12 text-sm sm:text-base font-bold bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 shadow-lg shadow-blue-500/30 border-0"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    登录中...
                  </>
                ) : (
                  <>
                    进入工作台
                    <ArrowRight className="size-4 ml-2" />
                  </>
                )}
              </Button>

              <div className="relative my-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-700/60" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-slate-900/60 px-3 text-[11px] text-slate-500">支持多角色协作</span>
                </div>
              </div>

              <RoleCards />

              <p className="text-center text-[11px] text-slate-500 pt-1">
                初始账号 / 密码：
                <button
                  type="button"
                  onClick={() => { setUsername('admin'); setPassword('admin123') }}
                  className="underline text-cyan-400 hover:text-cyan-300 mx-1"
                >
                  admin / admin123
                </button>
                ，登录后请尽快修改
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
