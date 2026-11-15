---
title: "一次 push，两个远端，备份传了两遍"
date: 2026-11-15T16:00:00+08:00
draft: false
slug: "one-push-two-remotes"
tags: ["Forgejo","备份","OpenWrt","git","自动化"]
categories: []
salutation: "见字如面，"
description: "在家里路由器上装了 Forgejo，于是 git push 一次推两个地方。顺手挂了个「push 时自动备份登录态」的钩子——然后同一份备份被传了两遍，5 份的保留窗口直接砍半。这篇记这个 bug 和它背后的凭据地图。"
postscript: "Forgejo 的部署细节在 .dsh/openwrt/ops/ops-20261114-forgejo.md；备份脚本在 .dsh/tools/userdata-backup.sh，口令不在任何包里。"
---

## 写在前面

这两天做了件一直想做的事：**在家里路由器上跑一个自己的 Git 服务器。**

理由很朴素——GitHub 很好，但我的配置、脚本、笔记里有很多「只有我自己看」的东西，多一个在自家局域网里的副本，心里踏实一点。

装完很顺利，然后把 `origin` 配成一次推两个地方。再然后挂了个备份钩子。最后发现：**同一个备份被上传了两遍。**

这篇按顺序讲：Forgejo 怎么装（和几个不改就起不来的坑）、双远端怎么配、钩子为什么跑了两遍、以及我最后整理出来的「凭据到底存在哪」的地图。

## 一、装 Forgejo：五个必须改的地方

设备是 F50 Pro（OpenWrt 25.12.5，armv8），用 docker compose 跑 `codeberg.org/forgejo/forgejo:17`，实际版本 **17.0.1**。

| 项 | 值 |
| --- | --- |
| 网页 / HTTP Git | `http://<路由器>:3001/` |
| SSH Git | `ssh://git@<路由器>:2222/<owner>/<repo>.git` |
| 数据 | `/mnt/mu300-disk/forgejo/data` |
| 内存 | 189 MiB / 640 MiB 上限 |
| 备份 | `forgejo dump` → cron `47 3 * * *`，保留 5 份 |

看着简单，但按网上抄来的 compose 是起不来的。五个坑：

### 1. 3000 端口被占了

`homepage` 容器（host 网络，`next-server`）占着 3000。Forgejo 改 **3001**。

### 2. 端口映射在这台机器上没用

这台机器上所有容器都用 `network_mode: host`，`docker0` 一直是 DOWN。写 `ports: 3000:3000` 没有实测通路，所以直接去掉，走 host 网络。

### 3. 环境变量是双下划线

```yaml
# 错
- SERVER__ROOT_URL=...
# 对
- FORGEJO__server__ROOT_URL=...
```

格式是 `FORGEJO__[SECTION]__[KEY]`。

### 4. `/etc/localtime` 是个悬空符号链接

宿主的 `/etc/localtime` 指向 `/tmp/localtime`，那是个**悬空**链接（OpenWrt 的 tmpfs）。docker 建 bind mount 时直接报：

```
mkdir /etc/localtime: file exists
```

解法：从任意一份 tzdata 里拷 `Asia/Shanghai` 出来，挂到容器自己的路径：

```bash
scp tzdata/share/zoneinfo/Asia/Shanghai root@<路由器>:/mnt/mu300-disk/forgejo/localtime
```

### 5. 镜像里没有 zoneinfo

所以 `TZ: Asia/Shanghai` 也解析不出来。不设 `TZ`，靠上面那个挂载的文件，Go 会回落到它。实测容器内 `date` 是 CST。

### 为什么不把数据放进 `/cloud`

第一反应是「反正 OpenList 的 `/cloud` 已经能网页访问了，把 `forgejo/data` 放进去，备份也顺手能看」。

结论是**不放**，四个理由：

1. **没收益**：`data/git` 里是 bare 仓库（`objects/pack` + refs），网页打开只有一堆哈希目录，看不出任何源码。
2. **有风险**：`/cloud` 是 OpenList 的存储根，网页端可写、可删、可改名。`gitea.db` 是 SQLite（`-wal`/`-shm` 同时在用），外部工具误碰就可能写坏。
3. `/cloud` 下还挂着外部网盘，目录一旦被同步扫到，Git 仓库会残。
4. 真想「网页上能看到备份」：备份产物落在 `/mnt/mu300-disk/backups/forgejo/`，在 OpenList 里加一个**只读**存储指向它就行，别把活的仓库目录暴露出去。

### 顺手关掉 Actions

装完首页一直有个黄色提示「Actions 正在等待运行」。原因很简单：**这台机器上没有 runner**，而 Forgejo 检测到仓库里有 workflow 文件就会排一个任务，永远 `Waiting to run`。

没有 runner 的 Actions 不是「慢」，是「不会跑」。所以直接关掉，再把历史 pending 状态清掉，免得以后每次看首页都以为哪里坏了。

## 二、双远端：一次 push 推两处

配置很直接——`origin` 挂两个 `pushurl`：

```bash
git remote set-url --add --push origin https://github.com/<me>/<repo>.git
git remote set-url --add --push origin ssh://git@<路由器>:2222/<me>/<repo>.git
```

`git remote -v` 会看到两行 `(push)`：

```
origin  https://github.com/<me>/<repo>.git (fetch)
origin  https://github.com/<me>/<repo>.git (push)
origin  ssh://git@<路由器>:2222/<me>/<repo>.git (push)
```

之后 `git push` 一次推两处。在家的时候顺手，不在家就只推 GitHub：

```bash
git push https://github.com/<me>/<repo>.git main
```

SSH 用无口令的 `id_ed25519`，换机就重新生成、网页里粘公钥。

## 三、钩子：push 时后台备份登录态

真正想解决的问题是：**登录态（浏览器 cookie、Telegram 会话、SSH key）会过期，手动备份一定会忘。**

所以挂了个 `pre-push` 钩子，push 时在后台把登录态打包加密、推到路由器 OpenList：

```bash
#!/usr/bin/env bash
set -u
tool="$HOME/code/.dsh/tools/userdata-backup.sh"
[ -x "$tool" ] || exit 0

setsid "$tool" --quiet </dev/null >>"$HOME/code/.dsh/tools/userdata-backup.log" 2>&1 &
exit 0
```

三个设计点：

- **`setsid` + `&`**：完全脱离 push 的会话，push 不等它，失败了也不影响 push。
- **`--quiet`**：不往终端喷。
- **`exit 0`**：钩子永远返回成功，绝不因为备份失败拦住代码。

### 然后备份被传了两遍

`userdata-backup.sh` 有个 `--keep 5`：远端只留最近 5 份。

某次去看远端文件列表，发现保留窗口只剩预期的一半——时间戳却都很近。想了一下才明白：

> `origin` 挂了两个 `pushurl`，git 会**对每个 pushurl 各调一次 pre-push 钩子**。

于是每次 `git push`：

1. 推 GitHub → 钩子跑一遍 → 打包、加密、上传。
2. 推 Forgejo → 钩子又跑一遍 → 再打包、加密、上传。

同一份内容，两个文件名，占掉两个保留位。`--keep 5` 的窗口直接砍半，而且每次 push 都在 eMMC 上多写一次 1.1 MB。

### 修法：5 分钟时间戳 + flock

```bash
stamp="${TMPDIR:-/tmp}/userdata-backup.stamp"
now=$(date +%s)
if [ -f "$stamp" ]; then
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  case $last in ''|*[!0-9]*) last=0 ;; esac
  [ $((now - last)) -lt 300 ] && exit 0
fi

lock="${TMPDIR:-/tmp}/userdata-backup.lock"
exec 9>"$lock"
flock -n 9 || exit 0          # 上一轮还没跑完就跳过
printf '%s\n' "$now" > "$stamp"
```

两层保护：

- **时间戳**：5 分钟内只备一次。两次 push 间隔通常几十秒，第二次直接被挡。
- **flock**：万一第一次还没跑完（上传 1.1 MB 在 40 MB/s 的 eMMC 上不慢，但网络慢），第二次不会叠上来。

`case` 那句是防御性的：时间戳文件被写坏了也不至于让整个钩子报错。

### 一个反直觉的细节：日志是 0 字节

`userdata-backup.log` 常年 **0 字节**，看起来像「钩子根本没跑」。

原因是脚本里的 `log()` 只在非 `--quiet` 时才输出，而钩子永远带 `--quiet`。

所以「日志是空的」不等于「备份没跑」。想确认，得主动看一眼：

```bash
./.dsh/tools/userdata-backup.sh -n      # 只打包，打印清单和大小，不上传
ls -la .dsh/userdata-out/               # 上传成功会删掉本地包
```

我把这条写进了 AGENTS.md，因为我自己被骗过一次。

## 四、凭据到底存在哪

这次顺带把「换机时到底缺什么」整理清楚了。凭据分三条通道，缺一条就少东西：

| 通道 | 里面有什么 | 怎么拿回来 |
| --- | --- | --- |
| **① git 里的加密包** `secrets-<tag>.tar.gz.enc` | GitHub / Cloudflare token、路由器密码、AI key、tg-bot env、tsukimi 账号 | `git clone` 后就在仓库里，`openssl enc -d` 解开 |
| **② 路由器 OpenList** | SSH 私钥、git token、Firefox/Thunderbird 登录态、Telegram 登录态、KeePass 库 | `./.dsh/tools/userdata-backup.sh restore` |
| **③ 哪都没有** | 口令文件 `.dsh/SECRETS-PASSPHRASE.local.txt` | 必须另存密码管理器 / 纸面 |

第 ③ 条是**故意的**：① 和 ② 用同一个口令解密，口令要是也跟着包一起放，等于锁和钥匙同袋。

**丢了口令 = 两个包都变废纸。** 所以换机前先确认能从一台「不在这台机器上」的地方读出它。

这次还顺手把加密包重打了一份（`secrets-20261115.tar.gz.enc`），补进去两样之前漏的：

- Cloudflare 的 `token-browser`（和 `token` 不是同一个，前者给浏览器用）。
- Forgejo 的 API token。

旧包从工作树移走，需要时从 `git log -- secrets-*.enc` 里找回。

## 五、这条链现在的样子

```
写代码 → git push
           ├─→ GitHub（公网，CI 在那边跑）
           ├─→ Forgejo（家里，局域网快、数据在自己手上）
           └─→ pre-push 钩子（5 分钟内只跑一次）
                 └─→ 打包登录态 → 加密 → OpenList（保留 5 份）
                       └─→ 笔记本也留一份（eMMC 是单点）
```

每一层都有冗余，每一层都不依赖上一层成功。

## 结语

这个 bug 本身很小：一行时间戳判断就修好了。但它让我想到一件事：

**自动化的隐藏成本，是「你不知道它跑了几次」。**

手动备份，你至少知道自己按了一次按钮。挂进钩子之后，它跑了两次、三次，还是零次，你都不会察觉——直到某天需要恢复，发现保留窗口只剩 2 份。

所以现在这条链上，我给自己留了三个「看得见」：

1. `-n` 演练能打印清单和大小。
2. `stamp` 文件能看出上次什么时候跑的。
3. 远端文件名带时间戳，`ls` 一下就知道有几份。

自动化可以偷偷跑，但不能偷偷坏。

此致
