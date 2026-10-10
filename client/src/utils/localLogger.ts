/**
 * 本地 logger，替代 @lark-apaas/client-toolkit/logger
 * 开发环境打印到控制台，生产环境上报可观测服务
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'

function formatPrefix(level: LogLevel): string[] {
  return [`[MiaoDa][${level.toUpperCase()}]`]
}

const localLogger = {
  debug(message: unknown, ...args: unknown[]): void {
    if (process.env.NODE_ENV === 'production') return
    console.log(...formatPrefix('debug'), message, ...args)
  },
  info(message: unknown, ...args: unknown[]): void {
    console.log(...formatPrefix('info'), message, ...args)
  },
  warn(message: unknown, ...args: unknown[]): void {
    console.warn(...formatPrefix('warn'), message, ...args)
  },
  error(message: unknown, ...args: unknown[]): void {
    console.error(...formatPrefix('error'), message, ...args)
  },
  success(message: unknown, ...args: unknown[]): void {
    console.log(...formatPrefix('success'), message, ...args)
  },
  log({ level, args }: { level: LogLevel; args: unknown[] }): void {
    if (level === 'debug' && process.env.NODE_ENV === 'production') return
    console.log(...formatPrefix(level), ...args)
  },
}

export { localLogger }
