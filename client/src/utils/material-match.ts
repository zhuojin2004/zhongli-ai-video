import type { VideoShot } from '@shared/api.interface'

export interface ScriptSegment {
  text: string
}

export interface MatchedShot {
  scriptSegment: string
  scriptIndex: number
  candidates: Array<{
    shot: VideoShot
    score: number
    matchReasons: string[]
  }>
}

function tokenize(text: string): string[] {
  return text
    .replace(/[，。！？、；：""''（）【】《》\s\n]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter((t) => t.length > 1)
}

function keywordScore(scriptTokens: string[], targetText: string): number {
  const targetTokens = new Set(tokenize(targetText))
  if (targetTokens.size === 0) return 0
  const hits = scriptTokens.filter((t) => targetTokens.has(t)).length
  return hits / Math.max(scriptTokens.length, 1)
}

function containsAny(scriptText: string, keywords: string[]): boolean {
  const lower = scriptText.toLowerCase()
  return keywords.some((kw) => lower.includes(kw.toLowerCase()))
}

function calculateMatchScore(
  scriptSegment: string,
  shot: VideoShot,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  const scriptTokens = tokenize(scriptSegment)

  const descScore = keywordScore(scriptTokens, shot.description)
  if (descScore > 0.1) {
    score += descScore * 3
    reasons.push('画面描述匹配')
  }

  const narrationScore = keywordScore(scriptTokens, shot.narrationText)
  if (narrationScore > 0.1) {
    score += narrationScore * 2
    reasons.push('旁白匹配')
  }

  if (shot.coreSellingPoint && containsAny(scriptSegment, [shot.coreSellingPoint])) {
    score += 5
    reasons.push(`核心卖点: ${shot.coreSellingPoint}`)
  }

  if (shot.scene && containsAny(scriptSegment, [shot.scene])) {
    score += 2
    reasons.push(`场景: ${shot.scene}`)
  }

  if (shot.action && containsAny(scriptSegment, [shot.action])) {
    score += 1.5
    reasons.push(`动作: ${shot.action}`)
  }

  return { score, reasons }
}

const DEFAULT_CANDIDATE_COUNT = 4

export function matchScriptToShots(
  scriptSegments: ScriptSegment[],
  shots: VideoShot[],
): MatchedShot[] {
  if (shots.length === 0 || scriptSegments.length === 0) return []

  return scriptSegments.map((seg, idx) => {
    const allCandidates: MatchedShot['candidates'] = []

    for (const shot of shots) {
      const { score, reasons } = calculateMatchScore(seg.text, shot)
      if (score > 0) {
        allCandidates.push({ shot, score, matchReasons: reasons })
      }
    }

    allCandidates.sort((a, b) => b.score - a.score)

    return {
      scriptSegment: seg.text,
      scriptIndex: idx,
      candidates: allCandidates.slice(0, DEFAULT_CANDIDATE_COUNT),
    }
  })
}