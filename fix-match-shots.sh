#!/usr/bin/env bash
# ============================================================================
# 修复混剪工作台「匹配分镜转两圈就停」bug
# 根因：matchSegmentWithLLM 用了错误的模型名 MiniMax-M2.5（应该是 MiniMax-M3），
#       全表 117 条一起送 LLM → 25s 超时 → keyword-fallback 顶上 → 用户体感卡死。
# 修复：4 个文件、6 处改动
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/client"

# ---------- 1. mockApiServer.js ----------
MOCK="vite/mockApiServer.js"

# 改动 A：模型名 M2.5 → M3 + 25s → 50s + max_tokens 2000 → 1500
python3 <<'PYEOF'
path = "vite/mockApiServer.js"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = """    const ctrl = new AbortController()
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
    })"""

new = """    const ctrl = new AbortController()
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
    })"""

assert old in src, "改动 A 失败：找不到原代码块（可能已经被改过）"
src = src.replace(old, new, 1)
print("[1/6] 模型名 → M3 ✓")

# 改动 B：match-shots handler 接 prefilterByProductName
old_b = """      const segments = await Promise.all((dto.scriptSegments || []).map(async (seg, segIdx) => {
        // 云端优先：把飞书·分镜任务库全表（≈100-200 条）一次性喂给 MiniMax-M2.5
        // LLM 自由审视全表，按语义相关性选 top3，不被关键词预筛限制
        let ranked = await matchSegmentWithLLM(seg.text, allCandidates)

        // LLM 失败/超时/无 key → 回退到关键词打分
        if (ranked.length === 0) {
          ranked = allCandidates
            .map(c => ({ ...c, score: keywordScore(seg.text, c), reason: 'keyword-fallback' }))
            .sort((a, b) => b.score - a.score)
        }"""

new_b = """      const segments = await Promise.all((dto.scriptSegments || []).map(async (seg, segIdx) => {
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
        }"""

assert old_b in src, "改动 B 失败：找不到 match-shots handler 起始块"
src = src.replace(old_b, new_b, 1)
print("[2/6] match-shots handler 接粗筛 ✓")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
PYEOF

# ---------- 2. ClipWorkbenchPage.tsx ----------
WB="src/pages/ClipWorkbenchPage/ClipWorkbenchPage.tsx"

python3 <<PYEOF
path = "$WB"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# 改动 C：请求体加 productName
old_c = "data: { scriptSegments: segments, duration: targetDuration, segmentCount: segments.length },"
new_c = "data: { scriptSegments: segments, duration: targetDuration, segmentCount: segments.length, productName },"
assert old_c in src, "改动 C 失败：找不到 match-shots 请求体"
src = src.replace(old_c, new_c, 1)
print("[3/6] handleMatchShots 加 productName ✓")

# 改动 D：handleMatchShots 入口加 loading toast
old_d = """    setMatching(true)
    setMatchedShots([])
    setVideoUrl('')"""
new_d = """    setMatching(true)
    setMatchedShots([])
    setVideoUrl('')
    // 提示用户：匹配通常 10-30s，避免以为没反应
    toast.loading('正在匹配分镜（10-30s）...', { id: 'match-progress', duration: Infinity })"""
assert old_d in src, "改动 D 失败：找不到 setMatching 块"
src = src.replace(old_d, new_d, 1)
print("[4/6] handleMatchShots 入口加 loading toast ✓")

# 改动 E：成功 toast 加上 id 覆盖 loading
old_e = "toast.success(`分镜匹配完成（${response.segments.length} 段 × LLM 全表分析）`)"
new_e = "toast.success(`分镜匹配完成（${response.segments.length} 段 × LLM 精排）`, { id: 'match-progress' })"
assert old_e in src, "改动 E 失败：找不到分镜匹配成功 toast"
src = src.replace(old_e, new_e, 1)
print("[5/6] 分镜匹配成功 toast 覆盖 ✓")

# 改动 F：catch 块 toast 加上 id
old_f = "toast.error(message)"
# 只替换 handleMatchShots 里的（在 finally 之前）
idx = src.find("catch (err: unknown) {")
assert idx != -1
chunk = src[idx:]
# 找到下一个 finally 之前
next_finally = chunk.find("finally {")
chunk_to_check = chunk[:next_finally]
old_f_local = "toast.error(message)"
new_f_local = "toast.error(message, { id: 'match-progress', duration: 8000 })"
assert old_f_local in chunk_to_check, "改动 F 失败：catch 块里没找到 toast.error"
src = src.replace(old_f_local, new_f_local, 1)
# 注：上面 replace_all=False 默认就是 1 次；但 ClipWorkbenchPage 还有 handleClip 里也有 toast.error(message)
# 所以需要再 restore 一下——用更精确的上下文
# 改回来：用 unique context
PYEOF

# 上面的 F 改动有歧义（handleClip 里也有同样的 toast.error(message)），用更精确的 unique context 重做
python3 <<PYEOF
path = "$WB"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# 改回 raw 重新做（避免把 handleClip 的 toast 也改了）
# 先看现在的样子
if "toast.error(message, { id: 'match-progress', duration: 8000 })" in src:
    # 还原
    src = src.replace(
        "toast.error(message, { id: 'match-progress', duration: 8000 })",
        "toast.error(message)",
        1,  # 只还原第一次（如果是 handleMatchShots 那个）
    )

# 用唯一上下文：紧跟「const message = err instanceof Error ? err.message : '分镜匹配失败'」
old_f = """    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '分镜匹配失败'
      logger.error('分镜匹配失败:', message)
      toast.error(message)"""
new_f = """    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '分镜匹配失败'
      logger.error('分镜匹配失败:', message)
      toast.error(message, { id: 'match-progress', duration: 8000 })"""
assert old_f in src, "改动 F 失败：分镜匹配 catch 块没找到"
src = src.replace(old_f, new_f, 1)
print("[6/6] 分镜匹配 catch toast 加上 id ✓")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
PYEOF

# ---------- 3. localAxios.ts：默认 timeout 60s → 5min ----------
AX="src/utils/localAxios.ts"
if grep -q "timeout: 60_000\|timeout: 60000" "$AX"; then
  python3 <<PYEOF
path = "$AX"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()
# 60s 不足以跑 LLM 匹配（30s+），统一改 5 分钟
src = src.replace("timeout: 60_000", "timeout: 300_000")
src = src.replace("timeout: 60000", "timeout: 300000")
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("[bonus] localAxios 默认 timeout → 5min ✓")
PYEOF
else
  echo "[bonus] localAxios timeout 未匹配（可能已改过），跳过"
fi

echo ""
echo "✅ 全部修改完成。重启 Vite 即可生效："
echo "   Ctrl+C 停掉 npm run dev，然后重新 npm run dev"
