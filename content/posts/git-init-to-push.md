---
title: "从建一个目录到 push 上去：本地、GitHub、自建 Forgejo 三条路，以及之后怎么养"
date: 2026-11-16T14:50:00+08:00
draft: false
slug: "git-init-to-push"
tags: ["git","GitHub","Forgejo","SSH","备份"]
categories: []
salutation: "见字如面，"
description: "新建一个目录想放点自己的东西，问了一句「只做本地 git 行不行」。行。但从建目录、写 .gitignore、git init、第一次 push，到之后一年怎么维护，中间有不少不看文档不会知道的地方：注释写错位置会失效、新仓库根本不会继承你挂在别处的钩子、两台同 IP 的机器会让 SSH 认错身份。这篇按顺序记下来，最后给一张从零到可用的检查清单。"
postscript: "双远端和「push 时自动备份」的钩子写在《一次 push，两个远端，备份传了两遍》里；这篇只讲从零到第一次 push，以及养仓库的日常。"
---

## 写在前面

前几天新建了一个目录 `~/mynotes`，想放点私人的东西。要求只有一条：**只在自己机器上**。

于是有一个很朴素的问题：只做本地 git，行不行？会不会被机器上现有的自动上传流程顺手带走？

答案是：**行，也不会。** 但这个过程中「建目录 → 初始化 → 第一次 push → 以后怎么维护」整条路我都走了一遍，踩到几个不看文档绝对想不到的地方：

- `.gitignore` 的注释写错位置，那条规则**直接失效**，而且不报错；
- 新建的仓库**不会**继承你在别的仓库挂的 git 钩子，因为钩子路径是**每个仓库自己的配置**；
- 两台设备用同一个内网 IP，SSH 会认为「主机身份变了」直接拒绝连接；
- 开了连接复用之后，这个坑会升级成**静默连到另一台机器**，不报错、不提示。

这篇按动作顺序写下来，全部是可以直接照抄的命令。最后给三条路线的取舍表，和一张从零到可用的清单。

## 一、先把三样东西分开

很多人卡住是因为把这三个东西混成一件事。

| 东西 | 是什么 | 在哪 |
| --- | --- | --- |
| **工作目录** | 你放文件的地方 | `~/mynotes/` |
| **本地仓库** | 版本历史，一个叫 `.git/` 的隐藏目录 | `~/mynotes/.git/` |
| **远端** | 另一台机器上的一份副本 | GitHub / 自建服务器 / 根本没有 |

关键认知：

1. **`git init` 不联网、不上传、不注册任何东西。** 它只在你目录里建一个 `.git/` 子目录。
2. **没有远端也能干活。** commit、看历史、回滚、开分支、比差异，全都不需要远端。
3. **「push 到本地」这个说法不存在。** push 的定义就是「把提交送到别的地方」。只在本地，就不需要 push，也没有 push 可做。

所以「只做本地 git」是完整的、自洽的用法，不是残废版。

顺带说清楚它**不能**做什么：**git 不是备份。**

git 解决的是「改错了能不能退回去」「删了能不能找回来」。它把所有历史都放在**同一块盘**的 `.git/` 里——盘挂了，工作目录和历史一起没。这两件事经常被混为一谈，实际是两套东西，后面第九节再讲。

## 二、第一步：建目录，先写 `.gitignore`

```bash
mkdir -p ~/mynotes && cd ~/mynotes
```

放哪里有个讲究：**不要放进任何一个现有的 git 仓库里。**

假设你有 `~/code` 是个仓库（还是推到 GitHub 公开的那种），你在里面建 `~/code/mynotes/`，那下次在 `~/code` 里习惯性地 `git add -A`，私人东西就被一起提交、一起推走了。而且嵌套仓库会变成 submodule，git 会给你一堆警告。

独立目录，独立仓库，互不干扰。

### `.gitignore` 要在第一次 `git add` 之前写

事后补也能补，但要 `git rm --cached` 把已经进库的文件摘出来，还要改写历史才算彻底，很烦。一开始就写。

```gitignore
# 密码 / 密钥
*.kdbx
*.key
*.pem
*.local.txt
id_ed25519*

# 口令 / 环境变量
.env

# 编辑器 / 系统垃圾
.DS_Store
*.swp
__pycache__/
node_modules/
```

### 这里有个真的会坑人的细节

**`#` 注释只能单独占一行。**

```gitignore
*.kdbx   # 密码库      ← 错：整行被当成一个模式
# 密码库
*.kdbx                 ← 对
```

gitignore 不支持行尾注释。上面那行「错」的会被解析成「忽略名字里带 `*.kdbx   # 密码库` 这个模式的文件」，永远匹配不到任何东西。**它不报错**，所以你会以为已经保护好了。

同理还有两个容易忽略的点：

- 行尾空格会被自动去掉，但**模式中间**的空格是有效的；
- `!` 是反向规则（不忽略），但它的优先级**不是**「后写的赢」，而是「最后一个匹配的规则赢」，所以 `*.log` 后面接 `!keep.log` 才能放行。

写完验证一下到底忽略了什么：

```bash
git status --ignored --short
```

## 三、第二步：`git init`

```bash
git init -b main
```

输出：

```
在 /home/<我>/mynotes/.git/ 初始化空的 Git 仓库
```

`-b main` 把初始分支名定成 `main`。不想每次写，就全局设一次：

```bash
git config --global init.defaultBranch main
```

（git 2.28 以后才有 `-b`；更老的版本只能 `git init` 再 `git branch -m main`。）

`.git/` 里现在有啥，大概知道一下就行：

| 路径 | 作用 |
| --- | --- |
| `config` | **本仓库**的配置（远端地址、钩子路径、身份……） |
| `objects/` | 所有文件内容，按内容哈希存，同一内容只存一份 |
| `refs/heads/` | 分支指向哪个提交 |
| `hooks/` | 钩子脚本 |
| `index` | 暂存区（`git add` 之后、`commit` 之前的状态） |

### 一个反直觉的点：新仓库没有钩子

我机器上有一个钩子：`push` 的时候在后台把登录态加密备份到家里的服务器上。挂在 `~/code` 和 `~/nixos-config` 这两个仓库上。

那我新建的 `mynotes` 会不会也被这个钩子管着？

**不会。** 因为启用钩子的那行配置是**仓库级**的：

```bash
~/code$          git config core.hooksPath        # → .dsh/githooks
~/nixos-config$  git config core.hooksPath        # → /home/<我>/code/.dsh/githooks
~/mynotes$       git config core.hooksPath        # → 空，没有
```

全局（`--global`）没设这个值，`init.templateDir` 也没设，所以新仓库的 `hooks/` 里只有一堆 `*.sample`，一个都没启用：

```bash
ls .git/hooks/ | grep -v '\.sample$'
# 没有任何输出
```

**这就是「只传本地」和「顺手被备份走」之间的分界线。** 你要它不参与任何自动流程，别去设全局的 `core.hooksPath` 就行。

## 四、第三步：第一次提交

```bash
git add -A
git commit -m "init: .gitignore（密码/密钥不进库）"
```

### 身份：一台机器可以有好几个

提交里会记 `作者名 <邮箱>`。全局设一次：

```bash
git config --global user.name  "你的名字"
git config --global user.email "you@example.com"
```

但如果这个仓库要推到公开的地方，把真实邮箱写进提交历史就是永久泄露（邮箱藏在每个 commit 里，改不干净）。可以给**单个仓库**单独设：

```bash
git config user.name  "你的名字"
git config user.email "12345678+用户名@users.noreply.github.com"
```

`--global` 和什么都不写（默认 `--local`）的区别就是：带 `--global` 写进 `~/.config/git/config`，不带写进 `.git/config`。查一个值到底从哪来的：

```bash
git config --list --show-origin | grep user.email
# file:/home/<我>/.config/git/config   user.email=...
```

### 提交信息怎么写

一行主题（不超过 50 字左右），需要解释就空一行再写正文：

```bash
git commit -m "feat(hh): 补 SSH / 文件搜索等 9 个分类" -m "- 分类从 11 个增到 20 个
- 行数 104 -> 200"
```

小仓库随便写也行，但**别写「update」**。三个月后你翻 `git log` 的时候会感谢现在的自己。

验证：

```bash
git log --oneline
# 376ea47 init: .gitignore（密码/密钥不进库）
```

到这一步为止，你已经拥有一个完整可用的版本控制系统，**没有联网过一次**。

## 五、选远端：三种活法

要往外送了，先决定送到哪。

| | 纯本地 | GitHub 私有仓库 | 自建 Forgejo |
| --- | --- | --- | --- |
| 谁能看到 | 只有这台机器 | 微软的服务器 | 只有你的内网 |
| 断网能推吗 | 无所谓 | 不能 | 家 Wi-Fi 下能 |
| 换机/盘坏能找回吗 | **不能** | 能 | 能（只要那台设备还在） |
| 谁可能删你的东西 | 你自己 | 平台（封号/误操作） | 你自己 |
| 协作 / 被搜到 | 无 | 有 | 无 |
| 额外成本 | 0 | 0 | 一台常开的机器 |

我的结论，三条：

1. **迟早要给别人看的东西** → GitHub。省事，生态在那儿。
2. **自己的、不想公开的东西** → 自建。数据不出内网，心里踏实。
3. **纯本地** → 只在「丢了也无所谓」的时候成立。项目一旦有点价值，就是单点。

还有个中间档：**GitHub 私有仓库**。它能解决「盘坏了怎么办」，但仍然是别人的硬盘。要不要放上去，是个纯粹的个人判断，没有技术上的对错。

（顺带：`git` 一条命令就能换远端，所以这个决定**不是永久的**。先推自建，哪天想公开了 `git remote add` 加一个，推一次就上去了。）

## 六、路线 A：推 GitHub

### 1. 建仓库

网页：右上角 `+` → New repository → 填名字 → 选 **Private** → **不要**勾「Add a README」（否则远端有个提交，你本地推上去会冲突）→ Create。

命令行（装了 `gh` 的话）：

```bash
cd ~/mynotes
gh repo create mynotes --private --source=. --push
```

一条命令把「建远端 + 加 remote + 推第一次」都做了。没有 `gh` 就用 API：

```bash
curl -s -X POST -H "Authorization: token $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"mynotes","private":true}' \
  https://api.github.com/user/repos
```

### 2. 鉴权：HTTPS 还是 SSH

两条路，选一条就行。

| | HTTPS + token | SSH |
| --- | --- | --- |
| 第一次准备 | 网页建 Personal Access Token | `ssh-keygen` 生成密钥，公钥贴到网页 |
| 之后 | 自动，不输东西 | 自动（密钥带口令时靠 ssh-agent） |
| 能不能只给一个仓库的权限 | **能**（fine-grained token） | 能（Deploy key） |
| 典型 remote | `https://github.com/<我>/mynotes.git` | `git@github.com:<我>/mynotes.git` |

**HTTPS 的做法。** 令牌千万别写进 URL（`https://user:token@github.com/...` 会被记进 `.git/config`，一提交就泄露）。正确姿势是放到文件里，配一个 credential helper 去读：

```bash
mkdir -p ~/.config/git && chmod 700 ~/.config/git
printf '%s' 'ghp_xxxxxxxx' > ~/.config/git/github-token
chmod 600 ~/.config/git/github-token

git config --global credential.https://github.com.helper /path/to/your-helper
```

helper 就是个脚本，`get` 的时候把用户名和密码（token）打到标准输出，下面第九节附一个 20 行的 shell 版本。

**SSH 的做法。**

```bash
ssh-keygen -t ed25519 -C "laptop"        # 建议设口令
cat ~/.ssh/id_ed25519.pub                 # 整段复制
```

粘到 GitHub → Settings → SSH and GPG keys → New SSH key。验证：

```bash
ssh -T git@github.com
# Hi <用户名>! You've successfully authenticated...
```

### 3. 加远端，推第一次

```bash
git remote add origin git@github.com:<我>/mynotes.git
git push -u origin main
```

`-u` 是 `--set-upstream`：把本地 `main` 和远端的 `origin/main` 绑定。**绑定之后**，以后再 `git push` / `git pull` / `git status` 都不用写 `origin main` 了。

不写 `-u` 也能推，但下次还得写全，`git status` 也不会告诉你「领先远端 3 个提交」。

### 4. 私有仓库要多想一步

- **Actions 有分钟数限制**（免费账户私有仓库每月 2000 分钟），公开仓库免费无限。
- **Fork 别人的私有仓库** 不占你的额度这件事，别指望。
- **把别人加进来**要小心：一旦给了写权限，他能读到全部历史——包括你以前不小心提交过的密钥。

## 七、路线 B：推自建 Forgejo

Forgejo 是 Gitea 的社区分支，一个二进制 + 一个数据库就是全套 Git 服务。我在家里的路由器上跑了一个（装的过程见《一次 push，两个远端，备份传了两遍》），端口 3001，SSH 2222。

### 1. 建仓库

网页上也行，但既然有 API，就一行：

```bash
curl -s -X POST -H "Authorization: token $FORGEJO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"mynotes","description":"私人笔记","private":true,"default_branch":"main"}' \
  http://<内网地址>:3001/api/v1/user/repos
```

返回里有关键两行：

```json
{
  "full_name": "<我>/mynotes",
  "private": true,
  "ssh_url": "ssh://git@192.168.x.x:2222/<我>/mynotes.git",
  "clone_url": "http://192.168.x.x:3001/<我>/mynotes.git"
}
```

**`private: true` 一定要带。** 自建服务器上也默认是公开的，忘了就是「家门口的公告板」。

### 2. 两种 remote，推荐 SSH

| 方式 | remote 长这样 | 认证 |
| --- | --- | --- |
| HTTP | `http://<内网地址>:3001/<我>/mynotes.git` | 账号密码 / token，**每次都可能要输** |
| SSH | `ssh://git@<内网地址>:2222/<我>/mynotes.git` | 公钥，配好一次就不用管 |

```bash
git remote add origin ssh://git@<内网地址>:2222/<我>/mynotes.git
git push -u origin main
```

实际输出：

```
To ssh://git@<内网地址>:2222/<我>/mynotes.git
 * [new branch]      main -> main
分支 'main' 设置为跟踪 'origin/main'。
```

### 3. 顺手给服务器起个名字

`ssh://git@192.168.x.x:2222/...` 记不住也不好看。`~/.ssh/config` 里加一段：

```sshconfig
Host forgejo
    HostName 192.168.x.x
    Port 2222
    User git
```

remote 就能写成：

```bash
git remote add origin ssh://forgejo/<我>/mynotes.git
```

端口和用户名都从 config 里取，命令里干净了。（用 IP 直连的那份源码里也是同一个仓库，两种写法等价。）

## 八、两个 SSH 坑，踩过才知道

这两个都发生在我把内网地址写死成别名之后。**它们不是 Forgejo 特有的，任何「同一个地址对应多台设备」的场景都会遇到**，比如家里两台路由器、公司跳板和家里服务器撞了 IP。

### 坑一：known_hosts 是按「你敲的名字」记的

SSH 第一次连一台机器，会记住它的主机公钥，存在 `~/.ssh/known_hosts`。下次再连，公钥变了就拒绝——这是防中间人的机制，很合理。

但它记录时用的键是**命令行里敲的那个名字**，不是解析出来的 IP。而我家里两台路由器（一台随身 Wi-Fi、一台备用）**内网地址都是 `192.168.x.x`，主机公钥不同**。

结果：连过 A 之后，换成 B 插上，敲同一个地址：

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

连接直接被拒。**解法**不是去删 `known_hosts`（那两台会永远互相覆盖），而是给每台一个名字：

```sshconfig
Host router-a
    HostName 192.168.x.x
    HostKeyAlias router-a-key

Host router-b
    HostName 192.168.x.x
    HostKeyAlias router-b-key
```

`HostKeyAlias` 强制用这个名字去查/存 known_hosts。之后 `ssh router-a` 和 `ssh router-b` 各存一条，互不影响。**敲错名字会直接报错，这是保护，不是 bug。**

### 坑二：连接复用会把两台机器串起来

为了加速，我给 SSH 开了连接复用：第一个连接建好之后留着，后面的连接直接搭上这条通道，不再握手、不再输密码。

```sshconfig
Host *
    ControlMaster auto
    ControlPath ~/.ssh/cm-%h-%p
    ControlPersist 10m
```

问题就在 `%h` 上：**`%h` 展开成的是 `HostName`，不是别名。** 两台路由器都是 `192.168.x.x:22`，于是**共用同一个 socket 文件**。

后果比坑一严重得多：你在 A 上挂着会话，换成 B 插上，「连到 A 的那条通道」直接被复用——**你以为连的是 B，其实在 A 上敲命令**。不报错，不提示，`hostname` 也不一定想得起来敲。

**解法：改用 `%n`（命令行里敲的名字）**：

```sshconfig
ControlPath ~/.ssh/cm-%n-%p
```

（`%C` 也是个常见写法，但它内部同样基于 `%h`，一样会串。）

配套的几条现在是我的标配：

```sshconfig
Host *
    ServerAliveInterval 15     # 每 15 秒探活，防止 NAT/路由器把空闲连接掐了
    ServerAliveCountMax 3
    StrictHostKeyChecking accept-new   # 新主机自动接受，但公钥变了照样拒绝
```

`accept-new` 是 `yes` 和 `no` 之间的甜点：省掉第一次的 `Are you sure you want to continue connecting?`，但不放弃「公钥变了就报错」这条底线。`no` 是真的危险，别用。

## 九、以后怎么养

建好之后，90% 的操作就三个动作。

### 日常三步

```bash
git status -sb                 # 我改了啥（-sb 会顺带显示领先/落后几个提交）
git add -A && git commit -m "..."   # 存一个快照
git push                       # 送出去
```

`git add -A` 是全加，包括删除。想只加某几个文件：`git add 文件1 文件2`；想交互式挑：`git add -p`。

### 写坏了想退回

| 想干什么 | 命令 | 危险度 |
| --- | --- | --- |
| 撤销**没提交**的改动（单个文件） | `git restore 文件` | 低（改动没了） |
| 撤销**没提交**的改动（全部） | `git restore .` | 低（改动没了） |
| 把暂存区的文件拿出来 | `git restore --staged 文件` | 低 |
| 撤销**已提交**的那一个 | `git revert <提交>` | 低（生成一个反向提交，历史保留） |
| 把分支指针退回到某个提交 | `git reset --hard <提交>` | **高**（后面的提交变成孤儿） |
| 改写远端历史 | `git push --force` | **最高**（别人如果有副本就冲突了） |

原则：**已经推上去的东西，用 `revert`；还没推的，用 `restore` / `reset`。**

必须强制推的场合（比如刚推上去发现带了一个 30 MB 的二进制文件），别用 `--force`，用：

```bash
git push --force-with-lease
```

它会在「远端有你不知道的新提交」时拒绝推送，`--force` 不会。这是一颗很便宜的保险。

### 改远端

```bash
git remote -v                                   # 现在指向哪
git remote set-url origin <新地址>              # 换地址
git remote add github git@github.com:<我>/x.git # 加一个（不删原来的）
git remote rename origin old                   # 改名
git remote remove github                       # 删掉

git push github main                           # 只推其中一个
git push --dry-run                             # 演练：真的会做什么，但不改东西
```

回忆 `-u` 那步：`git push` 不带参数能work，是因为 `main` 已经绑定到一个 upstream。`git branch -vv` 能看到绑定关系。

### 忽略规则写错了

已经把不该进库的文件提交了，`.gitignore` 加了也没用（git 只忽略**未跟踪**的文件）。要把它从索引里摘出来：

```bash
git rm --cached 那个文件        # 只从 git 里删，磁盘上的文件还在
git commit -m "chore: 把 xxx 移出版本控制"
```

如果要抹掉的是**密钥**，删文件不够——它还在历史里，`git log -p` 依然能看到。要么当它已泄露、立刻去换一把，要么用 `git filter-repo` 重写历史（重写之后所有已克隆的副本都会对不上，团队里得先说一声）。

### 大文件别塞 git

git 存的是**每个版本的完整快照**（压缩过），一个 200 MB 的视频改 5 次，仓库就涨到接近 1 GB，而且**永久留着**。

- 一次性的大文件 → 别进库，放外面
- 真的需要版本管理的大文件 → Git LFS
- 依赖目录（`node_modules/`、`.venv/`、`target/`）→ 一律 `.gitignore`，用锁文件锁住版本

体检一下仓库：

```bash
git count-objects -vH          # 仓库多大、松散对象多少
git gc --prune=now            # 打包压缩（git 会自己定期做）
git fsck                       # 检查对象完整性，偶尔跑一次
```

### git 不是备份，那备份怎么做

回到第一节那句话：`.git/` 和你的工作目录在**同一块盘**上。盘挂了，两个一起没。

自建服务器的价值就在这儿：副本在另一台设备上。但它也有单点（那台设备本身）。真要稳一点：

```bash
# 整个仓库（含全部历史）打包成一个文件，可以扔到任何地方
git bundle create ../mynotes-$(date +%Y%m%d).bundle --all

# 从包恢复
git clone mynotes-20261116.bundle mynotes
```

`bundle` 的好处是：**一个文件就带全部历史**，不依赖对方跑 Git 服务，加密压缩一下丢到网盘/U 盘都行。缺点是它是「快照」，不会自己更新，得靠 cron 或手动定期跑。

三层比较理想的组合：

1. **工作副本** → 这台机器
2. **远端** → 另一台设备（GitHub 或自建）
3. **离线快照** → 定期 `git bundle` 存一份到别的地方

只有第 1 层，就是在赌硬盘。

### 多台机器 / 多把钥匙

一台机器上有好几个身份（个人 GitHub、工作 GitLab、家里 Forgejo）时，别指望 SSH「自动选对钥匙」。显式指定：

```sshconfig
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes          # 只用这一把，别把其它钥匙挨个试

Host forgejo
    HostName 192.168.x.x
    Port 2222
    User git
    IdentityFile ~/.ssh/id_ed25519_home
    IdentitiesOnly yes
```

`IdentitiesOnly yes` 很重要：不加的话，ssh 会把你**所有**密钥依次递给服务器试一遍，服务器有连接尝试次数限制，钥匙一多就会莫名失败（`Too many authentication failures`）。

## 十、从零到可用的清单

存下来，下次新建仓库照着走。

```bash
# 1. 建独立目录（不要放进已有的 git 仓库里）
mkdir -p ~/x && cd ~/x

# 2. 先写 .gitignore（# 注释必须独占一行！）
$EDITOR .gitignore

# 3. 初始化（全局设过 init.defaultBranch 就不用 -b）
git init -b main

# 4. 确认没有钩子被继承（输出为空 = 干净）
git config --get core.hooksPath

# 5. 第一次提交
git add -A && git commit -m "init: xxx"

# 6. 建远端（网页 / gh / API / Forgejo API），注意勾 private

# 7. 加远端（SSH 优先，别把 token 写进 URL）
git remote add origin <地址>
git remote -v                      # 确认只有一个、且是你要的

# 8. 推第一次并绑定 upstream
git push -u origin main

# 9. 验证
git branch -vv                     # 有没有 [origin/main]
git log --oneline -1
```

九步。真正容易出错的是第 2、4、7 步——都是那种**不报错但结果不对**的地方。

## 最后

这件事最有意思的地方在于：**问题的答案比问题本身简单，但中间的路不平。**

「只做本地 git 行不行」——行，一条命令的事。可要确认「它真的不会被别的东西顺手带走」，就得去查 `core.hooksPath` 是全局的还是仓库的；要给服务器起个好记的名字，就得知道 `known_hosts` 记的是名字不是 IP；要开连接复用，就得知道 `%h` 和 `%n` 的差别，否则哪天会对着 A 机器敲 B 的命令。

这些都不难，只是没人会在你 `git init` 的时候提醒你。

又及：这篇里的地址都写成了 `<内网地址>` 这类占位符，你自己照抄的时候替换掉就行。真正的密钥、token、口令，**一个都不要进仓库**——包括私有的、包括自建的。私有仓库保护的是「别人看不到」，不保护「你自己手滑」。
