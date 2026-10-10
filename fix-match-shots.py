#!/usr/bin/env python3
"""
直接修改源码（不再走 bash heredoc 避免转义问题）。
跑法：python3 fix-match-shots.py
"""
import os
import sys
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(ROOT, "client")

MOCK = os.path.join(CLIENT, "vite", "mockApiServer.js")
WB = os.path.join(CLIENT, "src", "pages", "ClipWorkbenchPage", "ClipWorkbenchPage.tsx")
AX = os.path.join(CLIENT, "src", "utils", "localAxios.ts")


def patch(path, old, new, label):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    if old not in src:
        print(f"[✗] {label} 失败：原代码块未找到（可能已改过）")
        return False
    if new in src:
        print(f"[=] {label} 跳过：目标代码已存在")
        return True
    src = src.replace(old, new, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[✓] {label}")
    return True


# ===== 1. 模型名 M2.5 → M3 + 25s → 50s + max_tokens 2000 → 1500 =====
patch(MOCK,
    """    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 25000) // 25s 上限（百条全表比 top15 重，需要更多推理时间）
    const res = await fetch(`${CFG.minimaxBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.minimaxKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        messages: [
          { role: 'system', content: '你是视频素材匹配专家。严格只输出 JSON，无任何额外内容。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2000, // 全表推理需要更长思考 + 输出
        temperature: 0.1,
      }),
    })""",
    """    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 50000) // 50s 上限：粗筛后 prompt 短，M3 推理快
    const res = await fetch(`${CFG.minimaxBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.minimaxKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'MiniMax-M3',
        messages: [
          { role: 'system', content: '你是视频素材匹配专家。严格只输出 JSON，无任何额外内容。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1500, // 粗筛后候选 ≤ 30，输出长度可控
        temperature: 0.1,
      }),
    })""",
    "改动 A: 模型 M2.5 → M3, timeout 25s → 50s, max_tokens 2000 → 1500")


# ===== 2. match-shots handler 接 prefilterByProductName =====
patch(MOCK,
    """      const segments = await Promise.all((dto.scriptSegments || []).map(async (seg, segIdx) => {
        // 云端优先：把飞书·分镜任务库全表（≈100-200 条）一次性喂给 MiniMax-M2.5
        // LLM 自由审视全表，按语义相关性选 top3，不被关键词预筛限制
        let ranked = await matchSegmentWithLLM(seg.text, allCandidates)

        // LLM 失败/超时/无 key → 回退到关键词打分
        if (ranked.length === 0) {
          ranked = allCandidates
            .map(c => ({ ...c, score: keywordScore(seg.text, c), reason: 'keyword-fallback' }))
            .sort((a, b) => b.score - a.score)
        }""",
    """      const segments = await Promise.all((dto.scriptSegments || []).map(async (seg, segIdx) => {
        // === 两阶段过滤：产品型号粗筛 → LLM 精排 ===
        const productName = dto.productName || dto.meta?.productName || ''
        const { matched: candidates, hint, fallback } = prefilterByProductName(allCandidates, productName)
        console.log(`[mock-api] Segment ${segIdx}: ${hint}`)

        // 把粗筛后的子集交给 LLM（带 hint 让 LLM 知道已经过滤过型号）
        let ranked = await matchSegmentWithLLM(seg.text, candidates, hint)

        // LLM 失败/超时/无 key → 在粗筛子集内回退到关键词打分（避免跨型号混淆）
        if (ranked.length === 0) {
          ranked = candidates
            .map(c => ({ ...c, score: keywordScore(seg.text, c), reason: 'keyword-fallback' }))
            .sort((a, b) => b.score - a.score)
        }""",
    "改动 B: match-shots handler 接 prefilterByProductName")


# ===== 3. handleMatchShots 加 productName =====
patch(WB,
    "data: { scriptSegments: segments, duration: targetDuration, segmentCount: segments.length },",
    "data: { scriptSegments: segments, duration: targetDuration, segmentCount: segments.length, productName },",
    "改动 C: 请求体加 productName")


# ===== 4. handleMatchShots 入口加 loading toast =====
patch(WB,
    """    setMatching(true)
    setMatchedShots([])
    setVideoUrl('')""",
    """    setMatching(true)
    setMatchedShots([])
    setVideoUrl('')
    // 提示用户：匹配通常 10-30s，避免以为没反应
    toast.loading('正在匹配分镜（10-30s）...', { id: 'match-progress', duration: Infinity })""",
    "改动 D: handleMatchShots 入口加 loading toast")


# ===== 5. 分镜匹配成功 toast 加上 id =====
# 用 raw string 避免反斜杠/模板字符串问题
old_e = "toast.success(`分镜匹配完成（${response.segments.length} 段 × LLM 全表分析）`)"
new_e = "toast.success(`分镜匹配完成（${response.segments.length} 段 × LLM 精排）`, { id: 'match-progress' })"
patch(WB, old_e, new_e, "改动 E: 分镜匹配成功 toast 加 id")


# ===== 6. 分镜匹配 catch toast 加上 id =====
patch(WB,
    """    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '分镜匹配失败'
      logger.error('分镜匹配失败:', message)
      toast.error(message)""",
    """    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '分镜匹配失败'
      logger.error('分镜匹配失败:', message)
      toast.error(message, { id: 'match-progress', duration: 8000 })""",
    "改动 F: 分镜匹配 catch toast 加 id")


# ===== 7. localAxios timeout 60s → 5min =====
for old, new in [("timeout: 60_000", "timeout: 300_000"), ("timeout: 60000", "timeout: 300000")]:
    with open(AX, "r", encoding="utf-8") as f:
        src = f.read()
    if old in src:
        src = src.replace(old, new, 1)
        with open(AX, "w", encoding="utf-8") as f:
            f.write(src)
        print(f"[✓] 改动 G: localAxios timeout {old} → {new}")
        break
else:
    print("[=] 改动 G: localAxios timeout 已修改或不存在，跳过")

print()
print("=" * 60)
print("✅ 全部修改完成。重启 Vite 即可生效：")
print("   Ctrl+C 停掉 npm run dev，然后重新 npm run dev")
print("=" * 60)
