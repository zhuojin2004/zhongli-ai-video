/**
 * 从视频文件名派生简短展示标题（只用于 UI 显示，不写回 DB / 飞书）
 *
 * 业务背景：AI 会从画面识别产品型号，结果常常很冗长
 *   例：自动搬运车/机械制造业/RPG-普洛斯.mp4  →  「中力 EP 系列无人搬运叉车 (AGV/AMR 堆垛/搬运机器人)」
 * 卡片里那行长型号噪音太大，用户希望卡片标题直接显示「普洛斯」。
 *
 * 派生规则（方案 X + 规则 a：智能剥离品牌前缀）：
 *   1. 取 basename（去路径 + 去扩展名）
 *   2. 按 `-` 切分
 *   3. 过滤掉纯数字段（避免 `叉车演示-01` 变成 `01`）
 *   4. 取最后一段
 *
 * 示例：
 *   自动搬运车/机械制造业/RPG-普洛斯.mp4  →  普洛斯
 *   RPG-凯顺.mp4                              →  凯顺
 *   叉车演示.mp4                              →  叉车演示
 *   产品-介绍-v2.mp4                          →  v2  （数字段也只过滤纯数字，v2 保留）
 *                                             ⚠️ 如要避免请改用更严格的规则
 */
export function deriveShortTitle(fileName: string | null | undefined): string {
  if (!fileName) return ''
  // 1. basename（兼容 / 和 \）
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '')
  if (!base) return ''
  // 2. 按 `-` 切，过滤空段和纯数字段
  const parts = base.split('-').filter(p => p && !/^\d+$/.test(p))
  if (parts.length === 0) return base
  return parts[parts.length - 1]
}