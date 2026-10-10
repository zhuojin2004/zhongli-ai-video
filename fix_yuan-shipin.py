#!/usr/bin/env python3
"""Fix: feishuRecordToShots should read '原视频地址' field (user's new field) before '关键帧路径'"""
path = "/Users/jensen/Downloads/zhongli-src/client/vite/mockApiServer.js"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = """  // 源视频 URL 解析优先级：
  //   1) 飞书「关键帧路径」字段（用户已改为 OSS 视频 URL 时直接用）
  //   2) 飞书「关联的原视频」双向链接 → 主视频表的「OSS 云端地址」
  //   3) 兜底空字符串（前端/clip 会跳过没有源视频的分镜）
  let sourceVideoUrl = ''
  if (keyframePath && /^https?:\\/\\//i.test(keyframePath)) {
    sourceVideoUrl = keyframePath
  } else if (keyframePath && keyframePath.startsWith('file://')) {
    sourceVideoUrl = keyframePath
  } else {
    // 解析「关联的原视频」双向链接 → record_ids[0]
    const linkField = f['关联的原视频']
    const linkedRecordId = Array.isArray(linkField) && Array.isArray(linkField[0]?.record_ids)
      ? linkField[0].record_ids[0]
      : null
    if (linkedRecordId && mainUrlMap[linkedRecordId]) {
      sourceVideoUrl = mainUrlMap[linkedRecordId]
    }
  }"""

new = """  // 源视频 URL 解析优先级：
  //   0) 飞书「原视频地址」字段 —— 用户改字段后的首选（直接 OSS URL）
  //   1) 飞书「关键帧路径」字段（兼容旧数据，OSS URL 或 file://）
  //   2) 飞书「关联的原视频」双向链接 → 主视频表的「OSS 云端地址」
  //   3) 兜底空字符串（前端/clip 会跳过没有源视频的分镜）
  const originalVideoUrlField = f['原视频地址'] || ''
  let sourceVideoUrl = ''
  if (originalVideoUrlField && (/^https?:\\/\\//i.test(originalVideoUrlField) || originalVideoUrlField.startsWith('file://'))) {
    sourceVideoUrl = originalVideoUrlField
  } else if (keyframePath && /^https?:\\/\\//i.test(keyframePath)) {
    sourceVideoUrl = keyframePath
  } else if (keyframePath && keyframePath.startsWith('file://')) {
    sourceVideoUrl = keyframePath
  } else {
    // 解析「关联的原视频」双向链接 → record_ids[0]
    const linkField = f['关联的原视频']
    const linkedRecordId = Array.isArray(linkField) && Array.isArray(linkField[0]?.record_ids)
      ? linkField[0].record_ids[0]
      : null
    if (linkedRecordId && mainUrlMap[linkedRecordId]) {
      sourceVideoUrl = mainUrlMap[linkedRecordId]
    }
  }"""

assert old in src, "原代码块没找到（可能已改过）"
src = src.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("[done] feishuRecordToShots 加上「原视频地址」字段读取")
