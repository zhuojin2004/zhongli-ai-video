# 推送项目到 GitHub 方案

## 1. 目标与成功标准

- 当前妙搭工作区的 `sprint/default` 分支历史（3 个提交，含 ffmpeg 真实视频混剪、Minimax 视频打标、分镜标签视频黑屏修复）成功落到一个新创建的 GitHub 仓库
- 妙搭内部 `origin`（miaoda-git）保持不动，妙搭侧后续提交流程不受影响
- 你本地 `git push` 一次成功，GitHub 端能看到完整提交历史与全量文件

## 2. 关键事实（已确认）

- 当前分支：`sprint/default`，与 `origin/sprint/default` 一致
- `origin` URL：`https://7664530520713202977:AgFqloOYapbm...@miaoda-git.feishu.cn/apaas4.0/-/t_nJF9Mi3F/code_HEg5P6GogoOM.git`
- 最近 3 个提交：`65e868c` 引入 ffmpeg 真实视频混剪、`96dab96` 切换视频打标从 Kimi 到 MiniMax、`2b33d7a` 修复分镜标签查看器视频黑屏
- 工作区干净（`git status` 无未提交改动）
- 我不能直接调 `git push`、不能调 GitHub API，也不能替你新建 GitHub repo

## 3. 实现方案

### 阶段 A — 你在 GitHub 上做的事（需要你操作）

1. 登录 GitHub → New repository
   - Repo 名：建议与妙搭应用同义（例如 `app_17d60we6454` 或你想要的名字）
   - 可见性：Public / Private 自选
   - **不要**勾选 "Add a README / .gitignore / license"（本地已有历史，避免冲突）
2. 复制仓库 URL，**两种协议任选**：
   - HTTPS：`https://github.com/<your-username>/<repo>.git`（配 GitHub PAT 推送）
   - SSH：`git@github.com:<your-username>/<repo>.git`（需本机已配 SSH key）

### 阶段 B — 我能帮你准备的产物

> 这部分我会**生成一份脚本放到 `tmp/push-to-github.sh`**，你下载到本地后执行一次即可。妙搭沙箱不联网推 GitHub，但脚本本身可以预先写好并校验语法。

脚本会做四件事：

1. `git remote add github <你提供的 URL>` — 把 GitHub 加成新 remote，**不动 `origin`**，妙搭内部推送链路保留
2. `git remote -v` 校验 — 确认 origin 和 github 并存
3. `git push -u github sprint/default` — 把当前分支及其全部历史推上去
4. 推送完成后打印 GitHub 仓库链接

可选（如果你想让 GitHub 默认显示 `main`）：

- 推送时再加一行：`git push -u github sprint/default:main`（远端新建 main 指向同一提交）
- 或者后续在 GitHub 端 Settings → Branches 改默认分支

### 阶段 C — 凭据处理

- **HTTPS**：第一次 push 会要求用户名 + Personal Access Token（不是密码）。GitHub 已在 2021 年 8 月停止支持账密推送
- **SSH**：确保本机 `~/.ssh/id_ed25519`（或 rsa）已添加到 GitHub SSH keys
- **不要**把含 token 的 URL 直接写进脚本或 commit — 推荐用 `git credential helper` 或 SSH

## 4. 具体步骤

### Step 1 — 你把 GitHub 仓库 URL 发给我
（粘到对话里即可，HTTPS 或 SSH 都行）

### Step 2 — 我生成推送脚本
写到 `tmp/push-to-github.sh`，内容大致是：

```bash
#!/usr/bin/env bash
set -euo pipefail

# === 由妙搭预填 ===
GITHUB_REMOTE_NAME="github"
GITHUB_URL="<你提供的 URL>"
BRANCH="sprint/default"
# ===================

# 1. 加 GitHub remote（已存在则跳过）
if git remote get-url "$GITHUB_REMOTE_NAME" >/dev/null 2>&1; then
  echo "[skip] remote '$GITHUB_REMOTE_NAME' 已存在"
else
  git remote add "$GITHUB_REMOTE_NAME" "$GITHUB_URL"
  echo "[ok]   added remote '$GITHUB_REMOTE_NAME' -> $GITHUB_URL"
fi

# 2. 校验
git remote -v

# 3. 推送
git push -u "$GITHUB_REMOTE_NAME" "$BRANCH"

echo "[done] GitHub: $GITHUB_URL"
```

### Step 3 — 你把脚本拉到本地 + 执行

```bash
# 把妙搭工作区 clone 到本地（如果还没有），或直接复制脚本
bash push-to-github.sh
```

## 5. 影响范围与风险

- **妙搭内部 `origin` 完全不动**：后续 `commit_task` 仍正常推送到妙搭内部 git
- **GitHub remote 名建议用 `github`**（不是 `origin`），避免命名冲突和误推
- **历史含妙搭内部 commit 邮件/作者信息**（如果有）会原样推到 GitHub — 这是公开仓库时需要注意的
- **妙搭沙箱里有 `node_modules/`、`.git/` 等**：妙搭默认 `.gitignore` 应该已经排除 `node_modules`，但建议推送前在 GitHub 上确认首屏没有把依赖库也传上去（仓库大小异常就排查）
- **不在本方案中做**：清理历史、改写作者信息、添加 LICENSE / README / .gitignore — 如果需要可另起一轮

## 6. 验收标准

- [ ] 你执行 `bash tmp/push-to-github.sh` 一次成功，无报错
- [ ] `git remote -v` 输出含 `origin`（妙搭）+ `github`（GitHub）两个 remote
- [ ] GitHub 仓库页能看到 `sprint/default` 分支，且至少有 3 个提交（含 `引入 ffmpeg 开源能力做真实视频混剪`）
- [ ] 妙搭内部 `commit_task` 流程仍可正常提交（`origin` 未变）
- [ ] 仓库首屏文件结构与你预期一致，没有意外的大文件 / 凭据 / 内部地址泄漏

## 7. 未决事项（需要你确认 1 项）

- **GitHub 仓库 URL**：等你粘给我，我再生成最终的 `tmp/push-to-github.sh`
- 凭据方式（HTTPS+PAT / SSH）由你本机环境决定，脚本里不写死
