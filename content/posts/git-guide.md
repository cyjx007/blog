---
title: "Git 语法手册：按「你要干什么」排，不按字母序"
date: 2026-11-16T15:10:33+08:00
draft: false
slug: "git-guide"
tags: ["git","版本控制","速查"]
categories: []
salutation: "见字如面，"
description: "Git 的命令上百个，每天真正用的不到 15 个。这份手册按场景组织：四区模型、status 与 diff 的四种组合、add 与 commit、按处境选撤销命令、reset 三种模式、merge 与 rebase 的取舍、远端与强推、标签、stash、忽略规则、用 log -S 和 bisect 定位 bug，最后是九个「不报错但结果不对」的坑和一张速查表。"
postscript: "同系列的还有《Markdown 语法手册》；这些坑为什么会静默失败，写在《不报错，但结果就是不对》里。"
---

## 写在前面

Git 的难点从来不是命令记不住，而是**退的时候退错了地方**：还没 add 用 `restore`，add 了用 `restore --staged`，commit 了没推用 `reset`，**推了就只能 `revert`**。走错一步，代码就没了。

这份手册把这条线放在最前面（第 4 节），其余按日常动作排。每节都标了危险度，照着抄之前先看一眼。


Git 的命令很多，但**真正每天用的不到 15 个**。剩下那些是「出事了才会去翻」的。


---

## 0. 心智模型：先记住这张图

所有 Git 操作，本质都是在四个地方之间搬东西：

```
工作区（你正在编辑的文件）
   │  git add
   ▼
暂存区（index，用 git add 挑出来的那部分）
   │  git commit
   ▼
本地仓库（.git，提交历史）
   │  git push
   ▼
远端（GitHub / Forgejo / 别人的机器）
```

**三句话记住它**：

- **`git add` 是「挑」**：从改动里挑出这次要提交的部分。
- **`git commit` 是「存」**：把那批改动存成一个快照，进历史。
- **`git push` 是「送」**：把历史同步到远端。

反方向也有三条：`git restore`（撤回改动）、`git reset`（撤回提交）、`git pull` / `fetch`（取远端）。

**关键认知：`add` 和 `commit` 完全不联网。** 没有远端，照样能完整工作。

### 文件在 Git 眼里的四种状态

| 状态 | 意思 | 怎么办 |
| --- | --- | --- |
| untracked | 新文件，Git 没见过 | `git add` 开始跟踪 |
| modified | 跟踪着，但改过了 | `git add` 进暂存区 |
| staged | 已经挑好，等着提交 | `git commit` |
| committed | 已经进历史了 | — |

`git status` 显示的就是这个流转过程。

---

## 1. 起步：初始化 / 克隆 / 配置

### 新建仓库

```bash
mkdir -p ~/proj && cd ~/proj
git init -b main
```

`-b main` 指定初始分支名（Git 2.28+）。不想每次写：

```bash
git config --global init.defaultBranch main
```

### 克隆已有仓库

```bash
git clone <地址>                  # 克隆到同名目录
git clone <地址> mydir            # 克隆到指定目录
git clone --depth 1 <地址>        # 只取最近一次提交（快，但没历史）
git clone -b 分支 <地址>          # 指定分支
```

### 配置：三级，越近的优先

| 级别 | 位置 | 影响范围 | 怎么写 |
| --- | --- | --- | --- |
| system | `/etc/gitconfig` | 全机器 | `git config --system` |
| global | `~/.config/git/config`（或 `~/.gitconfig`） | 当前用户 | `git config --global` |
| local | 仓库里的 `.git/config` | 只这个仓库 | `git config`（默认） |

```bash
git config --global user.name  "你的名字"
git config --global user.email "you@example.com"

git config user.email "另一个@邮箱"   # 只改这个仓库（不加 --global）

git config --list --show-origin      # ★ 查一个值到底从哪来的，非常有用
git config --get core.hooksPath      # 查单个值
```

**为什么要 `--show-origin`**：同一个配置可能在三个地方都写过，值不对的时候，先搞清楚哪一级在生效，比瞎改快得多。

### 帮助

```bash
git help commit        # 完整手册
git commit --help
git commit -h          # 简短用法（快）
```

---

## 2. 看状态：`status` 和 `diff` 的四种组合

### `git status`

```bash
git status           # 完整
git status -s        # 短格式（两列：暂存区状态 / 工作区状态）
git status -sb       # 短格式 + 分支和领先/落后几个提交
```

短格式第一个字母是**暂存区**、第二个是**工作区**：

```
 M file.txt     ← 工作区改了，没 add
M  file.txt     ← 已经 add，等 commit
MM file.txt     ← add 过之后又改了（两部分都在）
?? new.txt      ← 未跟踪
D  gone.txt     ← 已删除并 add
```

### `diff` 的四种，最容易混

| 命令 | 比较的是 | 看这个是为了…… |
| --- | --- | --- |
| `git diff` | 工作区 ↔ 暂存区 | 「我改了但还没 add 的」 |
| `git diff --staged` | 暂存区 ↔ 上次提交 | 「我 add 了准备提交的」（`--cached` 同义） |
| `git diff HEAD` | 工作区 ↔ 上次提交 | 「所有改动加起来」（不管 add 没 add） |
| `git diff 提交A 提交B` | 两次提交之间 | 「这次提交改了什么」 |

记忆法：**不加参数 = 还没挑的；加 `--staged` = 已经挑好的；加 `HEAD` = 全部。**

```bash
git diff                      # 还没 add 的
git diff --staged             # 已经 add 的
git diff --stat               # 只看每个文件改了几行
git diff 文件路径              # 只看某个文件
```

### 两个点 vs 三个点

```bash
git diff A..B     # A 和 B 的差异
git diff A...B    # 从「A 和 B 的共同祖先」到 B 的差异
```

看 PR/分支的时候用**三个点**，才是「这个分支自己改了什么」。

### 历史

```bash
git log --oneline                    # 一行一个
git log --oneline --graph --all      # 分支图（看合并结构）
git log -5                           # 最近 5 条
git log -p 文件                      # 这个文件每次改了什么
git log -- 路径                      # 只看某目录/文件的历史
git log --author="名字"
git log --grep="关键词"               # 搜提交信息
git log -S "某段代码"                 # ★ 搜「哪次提交增删了这段内容」
git show <提交>                       # 看某次提交的详情
git blame 文件                        # 每行是谁、哪次提交改的
```

`-S` 是找人肉排查的利器：你发现某行代码莫名消失了，`git log -S "那行内容"` 能直接定位到删它的那次提交。

---

## 3. 提交

### `add` 的三种写法，别搞混

| 命令 | 范围 | 包含删除 |
| --- | --- | --- |
| `git add 文件` | 指定文件 | 是（如果是删除） |
| `git add .` | **当前目录**及以下 | 是（Git 2.0 起） |
| `git add -A` / `--all` | **整个仓库** | 是 |
| `git add -u` / `--update` | 只限**已跟踪**的文件 | 是 |

**实用建议**：在仓库根目录用 `git add -A`；在子目录里要小心 `.` 只覆盖当前目录。

**挑着提交**（推荐，提交粒度更干净）：

```bash
git add -p            # 交互式，一块一块问你要不要
git add -p 文件        # 只看某个文件
```

### `commit`

```bash
git commit -m "一句话说明"
git commit -m "主题" -m "正文第一段"    # 多个 -m = 多段落
git commit                             # 打开编辑器写长信息
git commit -am "..."                   # ★ 已跟踪文件的改动：add + commit 合并
```

⚠️ `-a` **不会**包含新文件（未跟踪的），只对已跟踪的生效。

### 改上一条提交

```bash
git commit --amend              # 把当前暂存区的内容塞进上一条提交
git commit --amend -m "新信息"   # 只改提交信息
git commit --amend --no-edit    # 内容改，信息不改
```

⚠️ **只要这条提交已经 push 过，`--amend` 就等于改写历史**，再推需要 `--force-with-lease`。多人协作的公共分支上别这么干。

### 提交信息怎么写

```
类型(范围): 一句话主题（不超过 50 字）

为什么这么改，而不是改了什么——改动本身 diff 里能看到。
如果需要，说说取舍和被否掉的方案。

Refs: #123
```

常用类型：`feat` / `fix` / `docs` / `refactor` / `chore` / `test`。

**最少也要做到**：主题行说清「做了什么」，别写 `update`、`fix bug`、`修改`。三个月后翻 `git log` 的是你自己。

### 空提交（有用）

```bash
git commit --allow-empty -m "触发一次 CI"
```

---

## 4. 撤销：按「你在哪一步」选命令

这是最容易搞错的一节。**先判断你的改动走到哪一步了**，再选命令。

| 你的处境 | 命令 | 危险度 |
| --- | --- | --- |
| 改了文件，还没 `add` | `git restore 文件` | 中（改动直接没了） |
| 改了文件，想全撤 | `git restore .` | 中（同上） |
| `add` 错了，想退回来 | `git restore --staged 文件` | 低（改动还在工作区） |
| `commit` 了，还没 push，想改内容 | `git commit --amend` | 低 |
| `commit` 了，还没 push，想整个撤掉 | `git reset --soft HEAD~1` | 低（改动回到暂存区） |
| 同上，但想连暂存区一起清 | `git reset HEAD~1`（默认 `--mixed`） | 中（改动回到工作区） |
| 同上，想彻底丢弃改动 | `git reset --hard HEAD~1` | **高（改动无法恢复）** |
| **已经 push 了** | `git revert <提交>` | 低（生成一个反向提交） |
| 想找回「被 reset 掉」的提交 | `git reflog` + `git reset --hard <哈希>` | 中 |

### `reset` 三种模式的区别

```bash
git reset --soft  <提交>   # 只移动分支指针。暂存区、工作区都不动 → 改动全在「已暂存」
git reset --mixed <提交>   # 默认。移动指针 + 清空暂存区 → 改动全在「未暂存」
git reset --hard  <提交>   # 三个都重置 → 改动彻底消失
```

一张表：

| 模式 | 分支指针 | 暂存区 | 工作区 |
| --- | --- | --- | --- |
| `--soft` | 移动 | 保留 | 保留 |
| `--mixed` | 移动 | **重置** | 保留 |
| `--hard` | 移动 | 重置 | **重置** |

### 把某个文件恢复到某个版本

```bash
git restore --source=HEAD~1 文件      # 恢复成上上次提交的样子
git restore --source=<哈希> 文件
git checkout <哈希> -- 文件           # 老写法，等价
```

### 已经 push 了怎么办

**不要 `reset` 后强推**（除非是只有你自己的分支）。正确做法：

```bash
git revert <要撤掉的提交>     # 生成一个新提交，内容是「反向操作」
```

历史保留，别人拉下来也不会冲突。

### 找回过东西：`reflog`

`reset --hard` 之后、误删分支之后，**提交并没有立刻消失**，它在 `reflog` 里留着（默认 90 天）：

```bash
git reflog                    # 每一次 HEAD 移动的记录
git reset --hard HEAD@{3}     # 回到第 3 步之前
git branch 救回来 <哈希>
```

**这是 Git 里唯一的「后悔药」，救人无数次。记住它就够了。**

---

## 5. 分支

```bash
git branch                    # 本地分支
git branch -a                 # 含远端分支
git branch -vv                # ★ 每个分支跟踪哪个远端、领先/落后多少
git switch -c 新分支           # 新建并切过去（2.23+ 推荐）
git switch 已有分支            # 切换
git checkout -b 新分支         # 老写法，等价
git branch -m 新名字           # 重命名当前分支
git branch -d 分支             # 删除（没合并会拒绝）
git branch -D 分支             # 强删
```

### 从某个提交开分支

```bash
git switch -c 修复 <哈希>      # 从那个提交开一条新分支
```

### 切分支时工作区有改动

```bash
git stash            # 先存起来
git switch 另一分支
git stash pop        # 回来再取
```

或者直接 `git switch` —— 如果改动和目标分支没冲突，Git 会带着改动过去。

### 多目录并行：`worktree`

一个仓库同时在两个目录里检出不同分支，比来回切快得多：

```bash
git worktree add ../proj-fix 分支名
git worktree list
git worktree remove ../proj-fix
```

---

## 6. 合并与变基

### 合并

```bash
git switch main
git merge 功能分支
git merge --no-ff 功能分支    # 强制生成一个合并提交（保留「这里合并过」的痕迹）
git merge --abort            # 冲突太多，放弃这次合并
```

### 变基

```bash
git switch 功能分支
git rebase main              # 把本分支的提交「搬到」main 最新之后
git rebase -i HEAD~3         # 交互式整理最近 3 个提交（squash / reword / drop / reorder）
git rebase --continue        # 解决冲突后继续
git rebase --abort           # 放弃
```

### 该用哪个

| | merge | rebase |
| --- | --- | --- |
| 历史 | 保留分叉和合并点（真实但乱） | 变成一条直线（干净但改写历史） |
| 安全性 | 安全 | **改写提交哈希** |
| 适合 | 公共分支、多人协作 | 自己还没推的分支、提交前整理 |

**铁律**：**已经推给别人、别人可能基于它工作的分支，不要 rebase。** 自己的功能分支随便整理。

### 解决冲突的标准流程

```bash
git status                  # 看哪些文件冲突（both modified）
# 手动编辑，删掉 <<<<<<<  =======  >>>>>>> 这些标记
git add 冲突文件             # 标记为已解决
git merge --continue        # 或 git rebase --continue
# 想放弃：git merge --abort / git rebase --abort
```

```bash
git checkout --ours 文件      # 整个文件用「我这边的」
git checkout --theirs 文件    # 用「对方那边的」
```

### 挑一个提交过来

```bash
git cherry-pick <哈希>        # 把那次提交的改动应用到当前分支
git cherry-pick A..B          # 一段
```

---

## 7. 远端

```bash
git remote -v                        # 现在有哪些远端、地址是什么
git remote add origin <地址>          # 加
git remote set-url origin <新地址>    # 改地址
git remote rename origin old          # 改名
git remote remove old                 # 删
git remote show origin                # 详情（哪些分支跟踪、哪些已过期）
```

### `fetch` 和 `pull` 的区别

```bash
git fetch          # 只把远端的更新下载到本地（不动你的工作区和分支）
git pull           # fetch + merge（或 rebase）
```

**排查问题时的正确顺序**：先 `fetch`，再 `git log --oneline HEAD..origin/main` 看远端多了什么，确认之后再决定 merge 还是 rebase。直接 `pull` 会在你没准备的时候产生合并提交或冲突。

```bash
git config --global pull.rebase true     # 让 pull 默认用 rebase，避免「无意义的合并提交」
```

### 推送

```bash
git push                     # 推当前分支到它跟踪的远端分支
git push -u origin main      # 第一次：推并绑定（之后就能只写 git push）
git push --tags              # 单独推标签
git push --follow-tags       # 推提交 + 相关的附注标签
git push --dry-run           # ★ 演练：会做什么，但不真的做
git push origin :分支名       # 删除远端分支（老写法）
git push origin --delete 分支 # 删除远端分支（新写法）
```

### 强推：永远用 `--force-with-lease`

```bash
git push --force              # ❌ 会覆盖远端一切，包括你不知道的新提交
git push --force-with-lease   # ✅ 远端和你以为的一致才推，否则拒绝
```

### 一份代码推两个地方

```bash
git remote set-url --add --push origin <第二个地址>
git remote -v                 # origin 会有两行 (push)
```

之后一次 `git push` 推两处。想只推其中一个，直接写地址：`git push <地址> main`。

### 跟踪关系

```bash
git branch -vv                          # 看谁跟踪谁
git branch -u origin/分支                # 改跟踪目标
git branch --unset-upstream             # 解除
```

---

## 8. 标签（发版用）

```bash
git tag -l                        # 列出
git tag v1.0.0                    # 轻量标签
git tag -a v1.0.0 -m "首个版本"    # 附注标签（推荐，带说明和日期）
git tag -a v1.0.0 <哈希> -m "..." # 给历史提交补标签
git push origin v1.0.0            # ★ 标签默认不会被 push 带走
git push --tags                   # 一次推全部标签
git tag -d v1.0.0                 # 删本地
git push origin --delete v1.0.0   # 删远端
```

---

## 9. 临时存一下：`stash`

```bash
git stash                 # 存起来（已跟踪的改动）
git stash -u              # 连未跟踪的新文件一起存
git stash list            # 列表
git stash pop             # 取出并删除那条 stash
git stash apply           # 取出但保留 stash
git stash drop            # 删掉最近一条
git stash show -p         # 看内容
```

场景：改了一半要切分支修 bug，又不想提交一个半成品。

---

## 10. 忽略文件

### `.gitignore` 规则

```gitignore
# 注释只能单独占一行！
*.log
build/             # 目录（结尾斜杠表示只匹配目录）
!keep.log          # 反向：不忽略这个
**/node_modules/   # 任意层级
/root-only.txt     # 只忽略仓库根目录这个
```

**四个常错点**：

1. **`#` 不能写在规则行尾**，写了整行就被当成一个匹配不到的模式。
2. `!` 的优先级不是「后写的赢」，而是「**最后一个匹配的规则赢**」——所以反向规则要写在后面。
3. `.gitignore` 只对**未跟踪**的文件生效。已经提交过的要 `git rm --cached`。
4. 空目录不会被跟踪（Git 只存文件），需要占位就放个 `.gitkeep`。

### 已经进库了想踢出来

```bash
git rm --cached 文件         # 只从索引删，磁盘上的文件还在
git rm -r --cached 目录
git commit -m "chore: 移出版本控制"
```

如果要抹掉的是**密钥**，光删不够——历史里还有。要么当作已泄露立刻换掉，要么用 `git filter-repo` 重写历史（之后所有克隆都不一致，团队里要先打招呼）。

### 本机私有忽略（不提交给别人）

```bash
# .git/info/exclude —— 和 .gitignore 同语法，但不会被 push
echo "我的笔记.md" >> .git/info/exclude
```

### 全局忽略

```bash
git config --global core.excludesFile ~/.config/git/ignore
```

放 `*.swp`、`.DS_Store` 这类「只在你这台机器才出现」的东西。

---

## 11. 找东西 / 定位 bug

```bash
git log --grep="关键词"                    # 搜提交信息
git log -S "某段代码"                      # 搜内容增删（谁加的、谁删的）
git log -G "正则"                          # 搜内容变化（正则）
git log --oneline -- 文件名                # 这个文件的提交历史
git log -L 10,20:文件                      # ★ 这几行的演变历史

git bisect start                           # 二分查找「哪次提交引入的 bug」
git bisect bad                             # 当前是坏的
git bisect good <哈希>                     # 这个提交是好的
#   然后 Git 每次检出中间那个提交，你测完说 good 或 bad
git bisect reset                           # 结束后复位
```

`bisect` 在几百个提交里定位回归问题，比肉眼翻 log 快一个数量级。

---

## 12. 体检和修复

```bash
git count-objects -vH       # 仓库多大、松散对象多少
git gc --prune=now          # 打包压缩（Git 平时会自动做）
git fsck                    # 检查对象完整性，偶尔跑一次
git clean -nd               # ★ 演练：哪些未跟踪文件会被删
git clean -fd               # 删掉未跟踪的文件和目录（危险，不可恢复）
```

`git clean` 是**真删**，不进回收站。**永远先跑 `-n`（演练）。**

### 大文件

Git 存的是每个版本的完整快照（压缩过）。一个 200 MB 的文件改 5 次，仓库就接近 1 GB，而且**永久留在历史里**。

- 一次性的大文件 → 别进库
- 真需要版本管理 → `git lfs`
- 依赖目录（`node_modules/`、`.venv/`、`target/`）→ `.gitignore`，用锁文件锁版本

---

## 13. 常用配置和别名

```bash
git config --global core.editor "nvim"
git config --global init.defaultBranch main
git config --global pull.rebase true
git config --global push.default simple          # 只推当前分支
git config --global core.quotepath false         # 中文文件名不再显示成 \344\270\255
git config --global diff.colorMoved zebra        # 移动的行用不同颜色标出来
```

### 别名（省很多打字）

```bash
git config --global alias.st  "status -sb"
git config --global alias.lg  "log --oneline --graph --all --decorate"
git config --global alias.last "log -1 --stat"
git config --global alias.unstage "restore --staged"
git config --global alias.undo "reset --soft HEAD~1"
```

之后 `git st`、`git lg` 就能用。

⚠️ 别名会挡住同名命令：设了 `alias.st`，`git st` 就是 `status -sb`，但 `git status` 不受影响。

---

## 14. 钩子（hooks）

在特定动作前后自动跑脚本。常用几个：

| 钩子 | 时机 | 典型用途 |
| --- | --- | --- |
| `pre-commit` | 提交前 | 格式化、lint、禁止提交密钥 |
| `commit-msg` | 提交信息写完后 | 校验信息格式 |
| `pre-push` | 推送前 | 跑测试、备份 |
| `post-merge` | 合并后 | 更新依赖 |

```bash
ls .git/hooks/                 # 一堆 .sample，去掉后缀才启用
chmod +x .git/hooks/pre-commit
```

**注意：钩子是「每个仓库单独」的配置。**

```bash
git config core.hooksPath .githooks          # 只对当前仓库生效
git config --global core.hooksPath ~/.githooks   # 全局才对所有仓库生效
```

所以「我在 A 仓库挂了 pre-push，新建的 B 仓库会不会也跑」——**不会**，除非你显式设了全局的。这一点查一次就能确定：

```bash
git config --get core.hooksPath     # 空 = 没有钩子
```

---

## 15. 那些「不报错但结果不对」的坑

### 1. 空目录不会进 git

Git 只跟踪文件。`mkdir foo` 之后 `git status` 什么都没有，`git push` 之后远端也没这个目录。要占位就放 `.gitkeep`。

### 2. 文件名改大小写可能不生效

Linux 区分大小写，Windows/macOS 默认不区分。在后者上 `git mv readme.md README.md` 可能「什么都没发生」。两步走：

```bash
git mv readme.md tmp.md
git mv tmp.md README.md
```

### 3. 换行符 CRLF / LF

```bash
git config --global core.autocrlf input    # Linux/macOS
git config --global core.autocrlf true     # Windows
```

或者仓库里放 `.gitattributes` 统一：

```
* text=auto eol=lf
```

否则 Windows 写、Linux 跑脚本会报 `bad interpreter: /bin/bash^M`。

### 4. 中文文件名显示成 `\344\270\255`

不是文件坏了，是 Git 给非 ASCII 字符加了转义：

```bash
git config --global core.quotepath false
```

### 5. `git checkout 文件` 会丢掉你的改动

老写法 `git checkout -- 文件` 是「用暂存区覆盖工作区」，**改动直接没**。2.23 之后拆成了 `git switch`（切分支）和 `git restore`（恢复文件），**用新命令，语义清楚**。

### 6. `pull` 突然多出一个合并提交

因为本地有提交、远端也有提交，`pull` 默认 `merge`。设 `pull.rebase true` 就变成直线。（如果那个合并提交已经推上去了，别 rebase，将错就错。）

### 7. 标签不会被 push 带走

```bash
git push           # ❌ 不推标签
git push --tags    # ✅
```

发版的时候忘了推标签，别人拉下来就找不到那个版本。

### 8. 分支名和标签名不能重名

`git tag main` 会失败。命名上错开（标签用 `v1.0.0` 这种）。

### 9. `git add .` 和 `git add -A` 在子目录里不一样

在 `src/` 里跑 `git add .` 只加 `src/` 下的东西。**在仓库根目录跑最省心**。

---

## 16. 速查表

| 想干什么 | 命令 |
| --- | --- |
| 看状态（简） | `git status -sb` |
| 看没 add 的改动 | `git diff` |
| 看已 add 的改动 | `git diff --staged` |
| 看历史（图） | `git log --oneline --graph --all` |
| 挑着 add | `git add -p` |
| 全部 add | `git add -A` |
| 提交 | `git commit -m "..."` |
| 改上一条提交 | `git commit --amend` |
| 撤销某个文件改动 | `git restore 文件` |
| 取消 add | `git restore --staged 文件` |
| 撤销上一条提交（保留改动） | `git reset --soft HEAD~1` |
| 撤销已推送的提交 | `git revert <哈希>` |
| 找回被 reset 的提交 | `git reflog` |
| 新分支并切过去 | `git switch -c 名字` |
| 切分支 | `git switch 名字` |
| 合并 | `git merge 分支` |
| 变基整理 | `git rebase -i HEAD~3` |
| 暂存当前改动 | `git stash -u` |
| 取回 | `git stash pop` |
| 拉远端（安全） | `git fetch` 然后看 `git log HEAD..origin/main` |
| 推 | `git push` |
| 强推（安全版） | `git push --force-with-lease` |
| 推标签 | `git push --tags` |
| 看远端 | `git remote -v` |
| 这次会推什么 | `git push --dry-run` |
| 这次会删什么 | `git clean -nd` |
| 仓库多大 | `git count-objects -vH` |
| 查配置来源 | `git config --list --show-origin` |
| 有没有钩子 | `git config --get core.hooksPath` |

---

## 17. 一句话总结

Git 只有三类操作：**往前推进**（add / commit / push）、**往回退**（restore / reset / revert）、**换方向**（branch / merge / rebase）。

难点从来不是命令记不住，而是**退的时候退错了地方**：

> 还没 add → `restore`
> add 了 → `restore --staged`
> commit 了没推 → `reset`
> **推了 → `revert`**

记住这条线，绝大多数「Git 把代码搞没了」的恐慌都能避免。真搞没了，还有 `git reflog`。

---

## 相关

- [Markdown 语法手册：写对了，才算写完了](/posts/markdown-guide/)
- [不报错，但结果就是不对：那些「静默失败」](/posts/silent-failures/) —— 这些坑为什么会发生，以及怎么自检
