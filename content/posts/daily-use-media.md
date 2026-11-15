---
title: "把机器用起来：音乐、视频、电子书"
date: 2026-11-15T16:10:00+08:00
draft: false
slug: "daily-use-media"
tags: ["NixOS","桌面","mpv","电子书","日常使用"]
categories: []
salutation: "见字如面，"
description: "系统能开机，和能天天用，中间隔着一堆小到不值得写、但少一个就难受的细节。这篇记这两天把 NixOS 从「装好了」推到「顺手」的过程：音乐、视频、电子书、下载、命令速查。"
postscript: "文中命令都来自我自己的 hh 速查表（home/hh-commands.tsv），换机器时它跟着 nixos-config 一起过去。"
---

## 写在前面

上一篇《从零搭到我现在这样》讲的是怎么把系统搭起来。但那只是「能开机」。

真正开始天天用之后，问题变得很琐碎：

- 想听歌，得先开浏览器找网页版。
- 想看个视频，字幕是乱码，右键菜单是英文。
- 下载的小说是一堆 txt，手机上看不了。
- 想知道「上次那条查温度的 curl 怎么写」，翻半天聊天记录。

这些事单拎出来都不值得写一篇博客，但攒在一起就是「这台机器到底顺不顺手」。

这篇就记这两天补上的这些东西。它们有个共同点：**装完之后，你不用再记得它怎么开。**

## 一、音乐：go-musicfox 与一个多出来的播放器

网易云没有 Linux 官方客户端，但有个 TUI 的第三方实现 `go-musicfox`，支持登录、歌单、日推、歌词，还带 MPRIS（能在系统顶栏控制）。

```nix
# modules/desktop/software.nix
go-musicfox
```

代价是闭包 96 MB（Go + 终端 UI 库）。换来的是：`go-musicfox` 一敲，终端里就是完整的网易云。

### 顶栏里出现了两个 musicfox

装完发现 Noctalia 的「媒体」页里有两个同名条目，但磁盘上明明只有一个 `musicfox`。

查下去是 `playerctl` 包自带的守护进程 **`playerctld`**：

- 它占着 `org.mpris.MediaPlayer2.playerctld` 这个总线名。
- 它把当前正在播的播放器**整套属性镜像**出来，连 `Identity` 都直接返回 `"musicfox"`。
- Noctalia 只按 `org.mpris.MediaPlayer2.*` 枚举播放器，不认「代理」这回事。

所以看到的不是 bug，是一个长得一模一样的影子。处理方式是按总线名子串屏蔽：

```nix
# home/noctalia-settings.nix
shell.mpris.blacklist = [ "playerctld" ];
```

只影响显示，真播放器照常工作。

> 顺带记一句：Firefox 也走 MPRIS，但它的播放状态不回传（`PlaybackStatus` 一直是 `Stopped`），
> 所以顶栏媒体控件对 Firefox 无效。这不是配置能修的，是 Firefox 的实现如此。

## 二、视频：mpv 的三层

### 2.1 界面：uosc

nixpkgs 里有 `mpvScripts.uosc`，现代控制条 + 右键菜单 + 缩略图预览。观感参考的是 Windows 上的 `hooke007/mpv_PlayKit`。

但整包搬不过来——那是 Windows 懒人包：`gpu-context=d3d11`、VapourSynth、144 MB 着色器。Linux 上照抄会直接报错。所以只取「好看」的那层：

| 从 PlayKit 拿的 | 怎么落地 |
| --- | --- |
| uosc 控制条 / 右键菜单 | `mpvScripts.uosc` |
| 缩略图 | `mpvScripts.thumbfast` |
| 6 个着色器（共 248 KB） | `home/mpv/shaders/` |
| 中文界面 | `slang = "zh-hans,zh,en"` |
| 字幕排版 | 字体 / 描边 / 阴影 / 缩放一组参数 |

### 2.2 一个 Nix 侧的坑：`programs.mpv.scripts` 没生效

按理说脚本该这么挂：

```nix
programs.mpv.scripts = [ pkgs.mpvScripts.uosc ];
```

实测（2026-11-14）这个 nixpkgs 版本生成的 wrapper 里 **`--script=` 一个都没有**，uosc 根本不加载。改成挂到 mpv 自己会扫的 `~~/scripts`：

```nix
home.file.".config/mpv/scripts/uosc".source =
  "${pkgs.mpvScripts.uosc}/share/mpv/scripts/uosc";
home.file.".config/mpv/scripts/thumbfast.lua".source = ...;
home.file.".config/mpv/scripts/mpris.so".source = ...;
```

还有一处：uosc 的图标字体在 nixpkgs 包的 `share/fonts` 里，mpv 不会自动加载，得手动放进 `~~/fonts`，否则控制条上是一排豆腐块。

### 2.3 解码：为什么必须写死 `vaapi-device`

这台机器有两个 DRM 渲染节点：

| 节点 | 属于谁 |
| --- | --- |
| `renderD128` | 独显 GTX 1650 Ti（被内核的 **nouveau** 认领，没有 CUDA，也没有可用的硬解） |
| `renderD129` | Intel UHD 630（iHD 驱动，真正能硬解的那个） |

libva 默认挑 `renderD128` → iHD 初始化失败 → **mpv 静默退回软解**，不报错，只是 CPU 高、风扇响。

所以配置里显式指定设备，而且用 by-path 软链而不是写死 `renderD129`（PCI 地址不会变，节点号会）：

```nix
hwdec = "vaapi-copy";
vaapi-device = "/dev/dri/by-path/pci-0000:00:02.0-render";
hwdec-codecs = "h264,vc1,hevc,vp8,vp9,av1,prores,ffv1";
```

`vaapi-copy` 而不是 `vaapi`：显式 copy-back，只走 VA-API，不再让 ffmpeg 去试 CUDA/VDPAU（那两条报错就是这么来的）。

### 2.4 tsukimi：必须用 OpenGL 才有硬解

tsukimi（GTK4 + 内嵌 mpv）播 1080p 动漫时报 `Audio/Video desynchronisation detected`，一查根本没硬解，而且默认走的是 Vulkan 上下文。

原因是它在纯 Wayland 下的实现问题：给 mpv render API 传原生 display 的分支只处理了 X11，Wayland 分支什么都没传，VAAPI→Vulkan 的 dmabuf interop 建不起来。

```bash
dconf write /moe/tsukimi/mpv-renderer 2   # 2 = OpenGL/EGL，必须重启 tsukimi
dconf write /moe/tsukimi/mpv-hwdec 1      # 1 = auto-safe，实时生效
```

效果：tsukimi 进程 CPU 从约 **12% 降到 2.5%**，`Dropped Frames` 归零，`A-V: +0.00006`。

### 2.5 怎么一眼看出「到底有没有硬解」

播放中按 `i`，看三行：

| 字段 | 有硬解 | 没硬解 |
| --- | --- | --- |
| `Video:` 行 | 有 `HW: vaapi` | 没有 `HW:` 段 |
| Video 段 `Format:` | `nv12` | `yuv420p` |
| Display 段 `Context:` | `wayland`（GL） | `waylandvk`（Vulkan → 软解） |

原理：`stats.lua` 显示的是 `hw-pixelformat`，没有才退到 `pixelformat`。这比看 CPU 占用可靠得多。

## 三、下载：yt-dlp 与「不落盘的登录态」

### 3.1 登录态：运行时读，不导出

B 站 1080P+ 和 YouTube 年龄限制都要登录。常见做法是导出 `cookies.txt`——但那是明文凭据，一旦落在磁盘上就多一个泄漏面。

改成让 yt-dlp 运行时直接读 Firefox 的 cookies 库：

```nix
home.file.".config/yt-dlp/config".text = ''
  --cookies-from-browser firefox
'';
```

好处有两个：明文不落盘；过期了也不用重新导，浏览器里保持登录就行。

这份配置同时作用于 `yt-dlp` 命令和 **mpv 的 `ytdl_hook`**（mpv 调 yt-dlp 时也读它），所以 `mpv 'https://...'` 播大会员清晰度也是通的。

### 3.2 aria2

`aria2c URL` 直接走默认配置：16 线程、断点续传、存到 `~/Downloads`。配置在 `~/.config/aria2/aria2.conf`（声明在 `home/desktop.nix`），要网页界面就把 RPC 三行取消注释。

```bash
aria2c 'https://example.com/big.iso'
aria2c -c -i urls.txt
yt-dlp --downloader aria2c --downloader-args 'aria2c:-x16 -s16' 'URL'
```

## 四、电子书：一条链，两个坑，一个 0.6 秒

想看的网络小说基本只有网页版或 txt。这条链是：

```
so-novel 按书源抓成 epub  →  foliate 读
已有 txt  →  txt2epub.sh 转  →  foliate 读
```

| 东西 | 说明 |
| --- | --- |
| `foliate` | 主力阅读器，epub / mobi / azw3 / fb2 / cbz，GTK4 原生 Wayland |
| `sonovel` | 按书源抓整本小说 |
| `txt2epub.sh` | 中文 txt → epub，自动识别「第X章」切章 + 生成目录 |

```bash
sonovel                                  # TUI：搜书名 → 挑书源 → 下载到 ~/books
sonovel -u 'https://…/book/12345/'       # 按详情页链接直下整本
foliate ~/books                          # 书架视图
txt2epub.sh                              # 不带参数：fzf 从 ~/books 选 txt
```

### 坑一：上游自带的 JRE 在 NixOS 上跑不了

so-novel 只发 `sonovel-linux_x64.tar.gz`（jar + 自带 JRE）。那个 JRE 是给普通 glibc 发行版编的：

```
Could not start dynamically linked executable
NixOS cannot run dynamically linked executables intended for generic linux environments
```

所以自己包的时候只取 `app.jar` + `config.ini` + `rules`，把 `runtime/` 丢掉，用 nixpkgs 的 `jre_headless` 启动。实测 Javet（它内置的 JS 引擎）和 DSL 规则引擎都正常。

启动脚本还要做一件事：首次运行把配置复制到 `~/.local/share/so-novel/`，并把 `download-path` 改成 `~/books`。书源会失效，失效时更新那里的 `rules/main.json`。

### 坑二：calibre 转 964 章会卡死

手里那本 txt 11 MB / 964 章。用 calibre 的 `ebook-convert`：

- `--chapter` 单文件模式：跑 15 分钟没出来，只能杀。
- markdown 模式：只认出前 102 章。

于是干脆自己拼 EPUB 3：读 txt、正则找「第X章」、生成 `mimetype` + `META-INF` + 每章一个 XHTML + `nav.xhtml` 目录 + `content.opf`，打包成 zip。**964 章 0.6 秒。**

### 坑三：从终端启动的 GUI，关终端就死

从终端敲 `foliate`，它是该终端的子进程，`Ctrl+C` 或关窗口一起杀，而且 webkit/a11y 的警告一直往终端喷（wlroots 上没有 a11y bus，无害但吵）。

所以速查表里写成脱离会话的形式：

```bash
setsid -f foliate ~/books >/dev/null 2>&1
f=$(fd -e epub -e mobi -e azw3 . ~/books | fzf) && setsid -f foliate "$f" >/dev/null 2>&1
```

验证：`ps -o pid,ppid,sid,cmd -p <pid>`，`PPID` 不是终端、`SID == PID` 就是脱离了。

更彻底的办法是根本不经过终端——从 Noctalia 启动器（Super）搜 `foliate` 打开。

### 顺手记下的小坑

| 现象 | 原因 |
| --- | --- |
| `foliate '~/books/x.epub'` 静默退出 | 单引号里的 `~` 不展开，要 `"$HOME/books/x.epub"` |
| `bash: 未预期的记号 "(" 附近有语法错误` | so-novel 的文件名带 `(作者)`，必须加引号 |
| `fzf: command not found` | fzf 只在 hh 自己的包装里，PATH 里一直没有 → 加到 `home.packages` |
| `koodo-reader` 装不上 | 锁在 electron-41，nixpkgs 已标 insecure；TTS 需求可看 `readest` |

## 五、命令速查：hh

折腾多了会发现，真正浪费时间的不是不会，是**记得大概但忘了具体写法**。

`hh` 是个两级 fzf 菜单：第一级分类，第二级命令，回车复制到剪贴板。

```bash
hh             # 两级菜单（分类 → 命令）
hh 下载         # 全局搜索
hh -l          # 列出全部，可以 hh -l | grep 温度
hh -c 下载      # 打印某个分类
```

工具本体已经开源成独立仓库 `cyjx007/hh-cheatsheet`（MIT），`nixos-config` 里只引用 flake + 放本机的速查表 `home/hh-commands.tsv`。加一条命令 = tsv 里加一行，然后 switch。

配套还装了：

- `tealdeer`：`tldr tar` 看例子，比 `man` 快。
- `nix-index`：敲一个没装的命令时提示「这个在 `nixpkgs#xxx` 里」。

## 六、桌面上的两个小改动

### 6.1 顶栏加「焦点窗口标题」和网速

之前顶栏只有时钟、CPU、内存、电源模式。现在补上：

- **焦点窗口标题**：切窗口时不用低头看。
- **上下行网速**：`network_speed_compact = true`，一位小数，2 秒轮询。

右侧按功能分组重排（系统状态 / 网络 / 媒体 / 时钟），一眼能扫。

### 6.2 空闲 10 分钟关屏，30 分钟锁定并挂起

用 wlroots 的 `ext_idle_notifier`，不是自己写定时器：

| 空闲 | 动作 |
| --- | --- |
| 10 分钟 | 关屏 |
| 30 分钟 | 锁定 + 挂起 |

## 七、这两天还顺手改了这些

上面是能写成段落的，剩下这些一句话就够，但少一个都会觉得缺：

| 类别 | 改动 |
| --- | --- |
| 输入法 | Rime 词库走 WebDAV 同步；手机导出的词库转成 `custom_phrase`；候选改横排、每页 7 个 |
| 剪贴板 | 历史记录加密落盘，不裸存 |
| 日历 | 农历改用 ChinaCalendar 的 ICS 订阅（本地生成 vdir 那条路走不通，已撤） |
| 登录 | 换 Noctalia Greeter 图形登录；systemd-boot 菜单只留 6 代，免得越滚越长 |
| 常用软件 | Thunderbird、cups 打印、GIMP、ffmpeg、kdenlive、amberol、tesseract、scrcpy、poppler、ghostscript |
| 外观 | Plymouth 开机动画、光标主题写进 `[input.cursor]`、kitty / Qt 主题 |
| AI CLI | codex 拆两套 profile（网关 / 官方账号 `-p gpt`）；opencode 桌面客户端中文化 |
| 机器人 | tg-bot 搜索重构成「多引擎合并 + 托管 API 优先」，接入 Exa / Serper |
| Cloudflare | Kitesurf（无状态 AI 浏览器）走 Browser Run Quick Actions |

还有一条**负结果**值得记：opencode 和 codex 的官方账号登录，在这台机器上试了三种方式（浏览器 OAuth、device code、桌面客户端），全部卡在同一堵墙——「电话号码是必填项」。这是 OpenAI 对 Codex 的策略，不是配置问题，也不是网络问题（`--device-auth` 都出码成功了，验完手机号那一步才拦住）。

所以我现在的策略是：日常用家里的网关，官方账号只在确实需要它的模型时才碰。省下的不是钱，是反复验证手机号的耐心。

## 结语

这篇里的东西，单看每一条都很小：一个黑名单、一个 `by-path` 软链、一句 `setsid`。

但它们合起来回答了一个问题：**这台机器现在能不能「不想它」地用？**

我的判据很土：

1. 想听歌，敲一个词就能放。
2. 想看的视频，双击就是硬解，字幕是中文。
3. 下载的书，扔进 `~/books` 就能读。
4. 忘了命令怎么写，`hh` 里搜得到。

这四条都满足之后，我就不再「维护系统」了，只是用它。这大概是折腾一台机器最好的终点。

此致
