# 上传后浏览器"刷新" / Network Error · 调查记录

**调查时间**：2026-09-07
**现象**：前端点「确认上传」后，用户感受到"整个浏览器刷新了一次"，「待上传」里的文件消失，
弹出红色 toast「处理失败 - Network Error」。

> ⚠️ 本文档第一版给出的根因（axios 5 分钟超时）**是错的**，已在下方「已排除」中说明。
> 目前**真实根因尚未定位**，不要把本文当结论用。

---

## 一、已确认修好的（真实修复）

### 飞书分镜表写入失败 → 已修复 ✅

飞书 SHOT 表缺 `时长标签` / `封面图` 字段，`writeShotToFeishu()` 报 `FieldNameNotFound`，
导致所有分镜写入失败。

修复前日志：
```
[mock-api] 分镜写入失败 #0: FieldNameNotFound
[mock-api] ✅ 分镜表写入: 0/4 条成功
```
补齐字段后：
```
[mock-api] ✅ 分镜表写入: 4/4 条成功
[mock-api] ✅ 主表回填: 状态=已分析, 关联 4 条分镜
```
另外用 `_backfill-shots.js` 回填了历史数据，飞书 SHOT 表现有 454 条记录。

**这个问题和"浏览器刷新"无关，是两件独立的事。**

---

## 二、已排除的错误假设（我先后判断错了两次）

### ❌ 假设 1：`localAxios` 5 分钟 timeout 太短

原以为 OSS 上传耗时 1-3 分钟导致 axios 超时。**实测推翻**：

| 测试 | 结果 |
|------|------|
| 直连 `localhost:9099` 上传 24MB | **HTTP 200，5.6s** |
| 经 Vite proxy `localhost:8080` 上传 24MB | **HTTP 200，7.8s** |
| 4 个并发上传 | **全部 200，12-13s** |

而浏览器的失败间隔只有 19-90 秒，远未到 5 分钟。

**决定性证据**：axios 超时抛的是 `ECONNABORTED`，message 为
`timeout of 600000ms exceeded`；而浏览器报的是 **`Network Error`**，
这是**连接被中断/重置**才会有的，不是超时。所以 timeout 根本不是原因。

> `client/src/utils/localAxios.ts` 的 timeout 已从 300000 改成 600000。
> 这个改动本身合理（与 `analyzeAxios` / `clipAxios` 一致，修掉一个一致性 bug），
> **但它治不了本文的 Network Error**。别以为改完就好了。

### ❌ 假设 2：Vite HMR 触发 page reload

看到日志里有一行 `page reload` 就以为是它。**推翻**：整个 Vite 日志里只有一行：
```
10:03:08 AM [vite] (client) page reload client/src/utils/localAxios.ts
```
这是**我自己改文件**触发的，只发生 1 次；而 Network Error 在 9:32-10:07 间发生了约 20 次。
时间上对不上。

同时排除了 preset 的两个嫌疑插件——服务浏览器的那个 Vite 进程日志里**没有**出现：
- `[miaoda-invalidate-on-outdated-dep] ... full-reload`（`node_modules/@lark-apaas/coding-preset-vite-react/lib/plugins/invalidate-on-outdated-dep.js:43`）
- `[Proxy] Service did not recover ...`（`lib/utils/proxy-error.js`）

（`[Proxy] ... 502` 那批日志来自 `npm run dev:local` 那个**已经死掉**的进程树，
它的 NestJS 因 3 个 TS 编译错误从未启动。当前 8080 由 PID 2693 独占，与那批日志无关。）

### ❌ 假设 3：前端代码里有 reload / 表单提交

搜过 `client/src/`：**没有** `location.reload` / `location.href =` / `location.replace`。
上传按钮不在 `<form>` 里，也不是 `type="submit"`。auth 拦截器在 401 时只清 localStorage，不跳转。

---

## 三、确实查出来的真问题（但不等于本文现象的根因）

### mockApiServer 事件循环被严重阻塞 🔴

实测：4 个并发上传时，一个**极简 GET** 也要排队很久：

```
GET /api/library/products : 22.7s
GET /api/library/products : 12.5s / 11.5s / 22.9s（并发上传期间）
```

正常应该是毫秒级（空闲时实测 0.007s）。原因是 `/api/upload` 之后后台并发跑
FFmpeg 抽帧 / hash / OSS 上传 / MiniMax，单线程 Node 被拖死。
历史上积压了 20+ 个后台分析任务，会把服务器压到更差的状态。

这解释了"页面卡住、什么都转不出来"，但**不解释 `Network Error`**——
curl 在同样的高负载下依然拿到 200，没有任何连接被断。

---

## 四、还没定位的部分（需要浏览器侧证据）

服务端 200、Vite 没刷页面、前端没有 reload 代码，但 Safari 报 `Network Error`。
缺的是**浏览器侧**的真相。

补充线索：用户控制台的 `[Error] Failed to parse __platform__` +
`SyntaxError: JSON Parse error: Expected '}'` 是 **Safari** 的报错措辞
（Chrome 会说 `Unexpected token`），所以现象出现在 Safari 上。
（这条 `__platform__` 报错本身无害，来自 `client/index.html:11` 的
`JSON.parse('{{{__platform__}}}')` 占位符，dev 模式下必然失败，与上传无关。）

### 下一步该抓什么

1. Safari →「开发」菜单 → 显示 Web 检查器 → **网络**标签，勾选「保留日志」，
   然后复现一次上传。看那条 `POST /api/upload`：
   - 状态列具体写什么（`(failed)` / `(canceled)` / 某个状态码）
   - 耗时多少秒挂的
   - 点进去看 Response / 有没有响应头
2. 同时看**控制台**：报错前有没有页面导航（控制台会打分隔线 / 条目被清空）
3. **换 Chrome 复现一次**。如果 Chrome 正常 → 基本锁定 Safari 侧行为
   （Safari 对慢响应、`[::1]` vs `127.0.0.1`、multipart 流有一些自己的处理）
4. 注意：Vite 只监听 `[::1]:8080`（IPv6 localhost），不是 `0.0.0.0`。
   如果浏览器把 `localhost` 解析到 `127.0.0.1`，行为可能和 curl 不同——值得验证：
   分别访问 `http://127.0.0.1:8080` 和 `http://[::1]:8080` 各试一次上传。

---

## 五、我在调查中制造的脏数据（需要清理）

为了实测，我通过 API 上传了 6 个探针文件，它们**会走完整链路**，
在 DB / 飞书主表 / 飞书分镜表里留下了垃圾记录：

- `PROBE-A.mp4`、`PROBE-B.mp4`
- `LOAD-1.mp4` ~ `LOAD-4.mp4`

另外 `RPG-凯顺.mp4` 因为反复重试，DB 和飞书主表里有 20+ 条重复记录。
这些都建议清理（按文件名删即可）。

---

## 六、相关文件

- `client/src/utils/localAxios.ts` — timeout 300000 → 600000（合理但非本问题解药）
- `client/vite/mockApiServer.js` — `/api/upload` handler（`sendJson` 在 OSS+飞书主表之后、AI 分析之前返回）
- `vite.config.ts` — proxy `/api` → `localhost:9099`，`timeout: 600000`
- `client/index.html:11` — `__platform__` 占位符报错来源（无害）
