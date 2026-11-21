---
title: "手机和电脑共用一本词库：Rime 同步的两层"
date: 2026-11-21T12:00:00+08:00
draft: false
slug: "rime-sync"
tags: ["Rime","fcitx5","输入法","WebDAV","Android","同步"]
categories: []
salutation: "见字如面，"
description: "文件传上去了，词却没涨——因为同步其实分两层：一层搬文件，一层合并词库。这篇把桌面 fcitx5-rime 和手机小企鹅的同步链拆开讲，包括 Android 存储权限那个绕不过去的限制。"
postscript: "文中的 WebDAV 地址、账号和设备 ID 都是占位符；桌面脚本在 nixos-config/pkgs/rime-webdav-sync.sh，手机端只用 FolderSync，不装需要 root 的东西。"
---

## 写在前面

事情很小：手机上用 Rime 打顺的新词，坐到电脑前发现打不出来。

直觉是“同步没配好”。但真正配的时候会发现，Rime 的同步不是“把词库文件传到网盘”这么简单。它至少分两层：

| 层 | 谁做 | 做什么 |
| --- | --- | --- |
| 文件搬运 | 桌面 `rime-webdav-sync` 定时器 / 手机 FolderSync | 把 `sync_dir` 在各设备和 WebDAV 之间搬来搬去 |
| 词库合并 | Rime 自己 | 把各设备的 `*.userdb.txt` 快照合并进本机词库，再写回自己的快照 |

只做第一层，网盘里会有一堆文件，但输入法不会多一个词。只做第二层，两台设备各写各的，永远碰不上面。

这篇记的是把两层都接通的过程，以及中间几个只有真用才会遇到的坑。

## 一、Rime 到底怎么同步

Rime 的同步目录里，每台设备有自己的一个子目录，名字来自 `installation_id`：

```
sync_dir/
├── <desktop-id>/
│   └── rime_ice.userdb.txt
├── <phone-id>/
│   └── rime_ice.userdb.txt
└── <another-device-id>/
    └── rime_ice.userdb.txt
```

同步时，Rime 会：

1. 把 `sync_dir` 下**所有**设备的 `*.userdb.txt` 读进来；
2. 与本机词库合并；
3. 生成一份新的本机快照，写回自己的目录。

所以两个关键点：

- **每台设备都要有自己独立的子目录**，不能共用；
- **只有 `*.userdb.txt` 快照参与合并**，`rime_ice.userdb/`（LevelDB）和 `build/` 不要交给网盘。

后者是很多人踩过的坑：把正在写的 LevelDB 目录同步上去，轻则文件锁冲突，重则词库损坏。`rime_dict_manager` 也不能在 fcitx5 运行时对着同一个库跑，文件锁会挡住它。

## 二、桌面：rclone + systemd timer

桌面侧的搬运脚本是 `rime-webdav-sync`，实际就是一个 rclone 的薄封装。

配置放在 `~/.config/rime-webdav/config`，权限 600，**不进 git**：

```bash
RIME_WEBDAV_URL="https://dav.example.com/dav/"
RIME_WEBDAV_USER="you@example.com"
RIME_WEBDAV_PASS="app-password"
RIME_WEBDAV_DIR="rime-sync"
```

地址可以换：坚果云、Nextcloud、InfiniCloud、自建 OpenList 都行。只改这个文件，不用 rebuild。

几个常用命令：

```bash
rime-webdav-sync --print        # 看识别到的设备 ID、本地同步目录、远端地址
rime-webdav-sync --check        # 只测 WebDAV 连通性，会列出远端设备目录
rime-webdav-sync                # 手动跑一轮：先拉其他设备，再传本机

systemctl --user start rime-webdav-sync.service    # 立即跑一轮
systemctl --user list-timers | grep rime           # 看下次触发时间
journalctl --user -u rime-webdav-sync -n 30        # 看日志
```

定时器是开机 2 分钟后一次，之后每 15 分钟。没有配置文件时服务直接跳过，不会刷日志。

## 三、手机：真正的限制不是网络，是权限

手机端用的是「小企鹅输入法 + Rime 插件」，同步目录默认在：

```
/sdcard/Android/data/org.fcitx.fcitx5.android/files/data/rime/sync
```

### 为什么不能把 sync_dir 指到 Documents

最自然的想法是：把 Rime 的 `sync_dir` 改到 `/sdcard/Documents/rime-sync`，然后用任意网盘客户端同步这个普通目录。

实际不行。小企鹅**没有存储权限**：

- targetSdk 已经到 36，Android 的分区存储把 `Android/data/` 保护起来了；
- 应用没有申请 `MANAGE_EXTERNAL_STORAGE`，也不应该为了同步去申请；
- 所以 `sync_dir` 只能留在应用自己的目录里，改到外部路径会直接同步失败。

上游对这个限制的说明很明确：输入法没有存储权限，不支持自定义 `sync_dir`，建议用支持 SAF 的目录同步工具。

这就是为什么手机端不是“装个网盘客户端”那么简单，而要绕到 **SAF（Storage Access Framework）**。

### 用 SAF 把目录授权给 FolderSync

小企鹅自带一个 DocumentsProvider，系统文件选择器的侧栏里能看到「小企鹅输入法」。FolderSync 支持 SAF，所以可以读写这棵树。

关键点：**文件夹对里一开始没有「小企鹅输入法」这个存储项**。必须先用系统选择器授权一次，它才会以一个名字很有迷惑性的条目出现。

步骤：

1. FolderSync → 设置 → 权限 → 最下面「添加用户定义的文件夹」。
2. 输入路径（只填这一截，前缀 `Android/data/` 已经有了）：

   ```
   org.fcitx.fcitx5.android/files/data/rime
   ```

3. 点确定，弹出系统文件选择器：
   - 左上角菜单 →「小企鹅输入法」；
   - 进 `data` → `rime`；
   - 底部「使用此文件夹」→「允许」。
4. 回到权限页，列表里出现 `files/data/rime` 就成功了。
5. 添加 WebDAV 账户：

   | 字段 | 值 |
   | --- | --- |
   | 名称 | 随意，例如 `Rime` |
   | 用户名 / 密码 | 和桌面配置里的一样 |
   | 服务器地址 | 只填主机名，**不要带 `https://`** |
   | 端口 | `443` |
   | 路径 | `/dav`（按服务商要求） |

6. 建文件夹对：
   - 左侧「设备存储」→ 选那个显示成 **「SD 卡」** 的条目（路径是 `/files/data/rime`）；
   - 进 `sync` 目录，选择文件夹；
   - 右侧 WebDAV → `rime-sync`，选择文件夹；
   - 同步类型「双向」。

「SD 卡」这个名字极容易让人以为选错了。它不是外置存储，就是刚才授权出来的 `files/data/rime`。名字是 FolderSync 按 provider 类型给的，路径显示才是准的。

7. 同步选项里确认两件事：
   - **同步删除操作：关**。关掉删除传播，两边目录互不影响；
   - 校验和计算保持开启。

免费版没有定时同步，日常就是手动点一下。

## 四、四个实测坑

### 坑一：路径框被中文输入法吃掉字母

在 FolderSync 的路径框里输 `org.fcitx...`，小企鹅的 Rime 引擎会把它当拼音转成中文，最后变成一串看不懂的东西。

绕法很简单：输入前把默认输入法临时切成系统输入法，或者在小企鹅里切到英文，输完再切回来。

### 坑二：provider 缓存文件大小，显示「已传输 0」

现象：

- 手机的 `rime_ice.userdb.txt` 明明变大了；
- FolderSync 日志里那一条显示「冲突 / 错误」；
- 之后每次同步都是「已传输 0」，远端一直是旧大小。

原因是 provider 缓存了文件大小，FolderSync 认为“没变化”，于是跳过。

绕过办法（改一次就行，之后记录会重新对齐）：

```bash
# 在桌面把远端那个文件改名，FolderSync 就会当新文件重新上传
rclone moveto rime:rime-sync/<手机ID>/rime_ice.userdb.txt \
              rime:rime-sync/<手机ID>/rime_ice.userdb.txt.bak
```

手机点一次同步，确认远端大小变成手机端的值，再把两边的 `.bak` 删掉：

```bash
adb shell rm /sdcard/Android/data/org.fcitx.fcitx5.android/files/data/rime/sync/<手机ID>/rime_ice.userdb.txt.bak
rclone delete rime:rime-sync/<手机ID> --include "*.bak"
```

### 坑三：同步目录里的文件变成 444

Rime 备份旧快照时，如果目标文件只读，会失败，日志里是：

```
error backing up file .../sync/<设备ID>/xxx
```

根因是 `~/.local/share/fcitx5/rime/sync` 里的文件被复制成了只读 444——源头是 home-manager 生成的 `/nix/store` 软链，复制时把权限一起带过来了。

手动补一次：

```bash
find ~/.local/share/fcitx5/rime/sync -type f ! -perm -u+w -exec chmod u+w {} +
```

现在 `rime-webdav-sync` 每轮会自动补，不用再管。

### 坑四：手机其实会自己同步

一开始我以为每次都要去手机里找「同步」按钮。实测发现 fcitx5-rime 在**保存数据时会自动跑一次同步**：切换输入法、系统回收、大约半小时一次，都会触发。

所以正常节奏是：

1. 手机正常打字，输入法自己保存并同步；
2. FolderSync 点一下，把手机快照传到远端；
3. 桌面定时器每 15 分钟拉一次；
4. 桌面 fcitx5 下次保存时自动合并，生成新快照，再被定时器传上去。

两端都是 `rime_ice` 方案，快照按文件名合并。删除词条不保证跨端生效，冲突时以词频高的一方为准。

## 五、排错表

| 现象 | 先看什么 | 处理 |
| --- | --- | --- |
| `--check` 返回 401 | 账号 / 应用密码 | 坚果云要用应用密码，不是登录密码 |
| 连不上自建 OpenList | 是不是在家里 Wi-Fi | 只写局域网地址，地址用占位符替换 |
| 桌面同步后没新词 | `rime-webdav-sync --print` 的远端目录 | 确认两端都是 `rime_ice`，`sync_dir` 一致 |
| 手机报 `.temp.userdb` 被占用 | `data/rime/.temp.userdb/` | 删掉它，或用「高级设置 → 导出/导入用户数据」重建 |
| FolderSync 看不到「小企鹅输入法」 | 权限页有没有 `files/data/rime` | 按上面的 SAF 步骤重新授权一次 |
| 一直「已传输 0」 | 远端文件大小 | 按坑二改名成 `.bak` 再同步 |
| 改了地址没生效 | 定时器周期 | `systemctl --user start rime-webdav-sync.service` 手动触发 |

## 六、隐私提醒

Rime 的快照里不只有词库，还有 `installation.yaml`、`custom_phrase.txt` 等配置备份。`custom_phrase.txt` 里是个人短语——名字、地址、常用回复都可能在里面。

所以 WebDAV 选自己能接受的那个：

- 只走局域网，就用家里的 OpenList；
- 要用公网，至少确认服务商不会拿你的文件做别的事；
- 不要把 `sync_dir` 直接放进公开的网盘分享目录。

## 最后

这条链真正麻烦的地方，不是 WebDAV，也不是 rclone，而是**移动端的权限模型**。

Android 把 `Android/data/` 保护起来是对的；输入法不申请全盘存储权限也是对的。两个“对”撞在一起，结果就是必须用 SAF 绕一层。

想清楚这一点之后，FolderSync 里那个叫「SD 卡」的条目、为什么路径必须填 `org.fcitx...`、为什么不能改 `sync_dir`，就都说得通了。

现在手机和电脑共用一本词库。新词在手机上打一遍，过十几分钟电脑上就有了——最好的同步，就是让人忘记它存在。
