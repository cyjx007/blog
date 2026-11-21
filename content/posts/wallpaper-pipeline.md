---
title: "365 张壁纸，一套配色：壁纸流水线是怎么长出来的"
date: 2026-11-21T11:30:00+08:00
draft: false
slug: "wallpaper-pipeline"
tags: ["NixOS","Noctalia","Wallhaven","壁纸","Material You","自动化"]
categories: []
salutation: "见字如面，"
description: "从「换张壁纸」到「全系统跟着变色」，中间要回答三个问题：图从哪来、什么时候换、颜色怎么落到每个程序里。这篇记这条流水线的设计、被源码推翻的设想，和几个只有长期跑才会暴露的坑。"
postscript: "采集器、Home Manager 模块和 fcitx5 模板已经抽成独立项目 wallhaven-noctalia；本机只留配置和池子。文中 API key、账号与内网地址都已替换。"
---

## 写在前面

起因很小：我想让桌面每天换一张壁纸。

真正动手才发现，这句话背后有三个独立的问题：

1. **图从哪来**——手动存图，存到一百张就开始重复，而且质量参差。
2. **什么时候换**——写个 daemon 每天换？还是交给桌面环境？
3. **换完之后呢**——壁纸换了，终端、面板、输入法、浏览器还是旧配色，看着像两套系统。

最后做出来的东西是一条链：

```
wallhaven 排行榜 ──采集──> 本地壁纸池 ──轮换──> Noctalia
                                              │
                                              └─ Material You 调色
                                                   │
                                                   └─ 模板写进各程序配置
```

这篇记的是这条链为什么长成这样，以及中间被推翻的几个设想。结论不一定适合你，但那些「想当然」和「实际不是」的对照，大概是通用的。

## 一、先定边界：只做采集，不做轮换

最早的方案很自然：一个 systemd timer，每天从池子里挑一张没看过的，`swww` 或 `noctalia msg wallpaper-set` 换上去，再调 `matugen` 生成配色。

查了一圈 Noctalia 的源码之后，这个方案被砍掉了大半。

Noctalia 5.5 里有一个 `wallpaper_shuffle_state.cpp`，实现的是**无放回洗牌**：

- 状态存在 `~/.local/state/noctalia/wallpaper_shuffle.json`；
- `order = "random"` 走的就是 `ShuffleState::pick()`；
- 全部候选都看过之后才清空重来；
- 每轮会重新扫描目录，新增和删除的文件立即生效。

也就是说，**365 张图一轮，天然不会在一年内重复**。我要写的「挑一张没看过的」逻辑，它已经写好了。

于是两个决定：

- 不写轮换 daemon，`wallpaper.directory` 直接指向池子；
- 不引入 matugen，调色全部交给 Noctalia，避免两套颜色引擎打架。

同样被砍掉的还有 `pool/` + `active/` 两层软链。原本想用软链标记「当前这张」，后来发现 Noctalia 自己维护当前壁纸，多一层软链只会多一个可能不同步的状态。

> 这件事教我的：**先读你要集成的那个东西的源码，再决定自己写多少。** 很多「我需要一个调度器」的直觉，在对方的实现里已经有更合适的答案。

## 二、池子怎么保证「能看」

采集本身不难，难的是**过滤**。wallhaven 排行榜里什么都有：纯白背景、几乎全黑、糊成一片的、饱和度低到像蒙了层灰的。

而这些图一旦进了池子，问题不是「不好看」，是**看不清字**：半透明面板和终端会透出壁纸，太亮的图直接把文字对比度吃掉。

Material You 本身保证文本与背景的对比度（实测 `on_surface/surface` 约 14:1，`on_primary/primary` 约 7.7:1），所以不用自己再算对比度。真正要管的是壁纸侧的三个量：

| 检查 | 阈值 | 拒绝原因 |
| --- | --- | --- |
| 平均亮度（256px 灰度缩略图） | `0.03 ~ 0.70` | `too-dark` / `too-bright` |
| 层次（灰度标准差） | `≥ 0.03` | `too-flat` |
| 饱和度 | `≥ 0.06`；低饱和图最多占 10% | `muted-quota` |
| 主色相分布 | 每 30° 一格，单格上限约 `target/12*1.5` | `hue-quota` |
| 文件大小 | `≤ 16 MiB` | `too-large` |
| 感知哈希 | 距离 ≤3 直接拒绝；4–7 交给 `dedupe` 报告 | `duplicates` |

色相配额是为了避免「一整年都是蓝调风景」。收尾阶段候选变少时会自动放宽，否则补不满 365 张。

分层拒绝的原因也很重要：

- **硬性拒绝**（太亮、太暗、太平、太大、格式不支持）写进 `rejected`，以后不再重试；
- **配额类拒绝**（`hue-quota` / `muted-quota`）只是「这一轮不合格」，每次同步都会重新评估，第一遍跑完还会自动进宽松模式再补一遍。

这两类混在一起，就会出现「明明有几千张候选，池子却永远补不满」的怪事。

## 三、去重不是按 id，是按图

wallhaven 的 id 去重只能挡住同一个条目。同一张图被不同账号重复上传、不同压缩参数各传一份，id 完全不同。

所以下载之后还要算 **pHash**：

- 距离 ≤3：视为重复，直接跳过；
- 距离 4–7：正常入池，但留给 `dedupe` 报告。

现有 365 张里抓出过一对距离 2 的真重复——不同压缩的同一张图。`dedupe --apply` 只隔离 ≤3 的，移到 `<池子目录>-quarantine/duplicates/`，**不删除**，`--restore <id>` 可以移回来。

这里的原则和后面所有删除操作一致：**先隔离，再让人决定**。

## 四、从「补满 365」到「滚动窗口」

第一版是「池子不满就下载，满了就退出」。跑了一个月后发现两个问题：

1. 池子会**老化**：一年前收的图不代表现在还喜欢；
2. 池子满了之后，采集器等于永久停摆，品控规则改了也不会重新筛选。

所以 v1.1 改成了滚动窗口：

- 每天最多淘汰 24 张、补 24 张，一年正好换一轮；
- 淘汰进 7 天回收站 `<pool>-trash/YYYYMM/`，期间可以 `restore`；
- **先补后删**：先按「目标数 + 候选数」补货，只有真的补到 N 张，才淘汰 N 张；补货失败一张旧图都不删；
- 淘汰顺序是 `last_shown_at` 最旧的先，从未展示的默认不动；
- 当前正在显示的壁纸**不能删**——这是整条流水线唯一的硬约束。Noctalia 的洗牌状态会清掉不存在的路径，删旧图是安全的，但删当前这张会让桌面直接空掉；
- 同日配额幂等：按 UTC 日期统计，一天跑两次也不会淘汰双份。

### 一个容易被忽略的细节：下载不是原子的

直接往池子里写文件，遇到断网、进程被杀、磁盘满，就会留下半张图。下次扫描把它当正常文件，壁纸换上去就是一条灰色。

现在的做法是先写 `.incoming-<id>.part`，等 SHA-256、pHash、品控全部通过并 `fsync` 之后，才用 `os.replace` 换到正式文件名。0 字节、中断、半张图都进不了池子。

同理，wallhaven API 有明确的限速：

- 全局 1.4 秒一次；
- 429 遵守 `Retry-After`；
- 5xx 和网络错误指数退避加抖动，最多 5 次；
- 下载同样重试 5 次。

这些不是「优化」，是没有它们就跑不完 365 张的东西。

## 五、颜色怎么落到每个程序里

调色交给 Noctalia 之后，剩下的问题是**写文件的所有权**。

Noctalia 的模板会直接改 `~/.config`，但 home-manager 生成的是只读的 store 软链。写只读软链会失败，所以哪些文件归谁写必须提前分清：

| 目标 | 谁写 | 做法 |
| --- | --- | --- |
| `umbriel/noctalia.toml` | Noctalia | 正常；`config.toml` 里声明 optional include |
| `umbriel/theme-fallback.toml` | home-manager | 静态兜底，被 include 覆盖 |
| `kitty/themes/noctalia.conf` | Noctalia | `kitty.conf` 里声明 include |
| `gtk-3.0/noctalia.css`、`gtk-4.0/noctalia.css` | Noctalia | `gtk.css` 里 `@import` |
| `umbriel/config.toml`、`kitty.conf`、`gtk.css` | home-manager | **不让模板碰**，否则写 store 软链会失败 |

还有一个 Umbriel 特有的坑：它的 include 合并顺序是「include 先、主文件后」，主文件里的键会覆盖 include。所以动态颜色必须让 include 独占 `[colors]`，静态颜色只能放在 fallback 里当兜底。

覆盖范围大致是这样：

| 跟着变 | 方式 |
| --- | --- |
| Noctalia 本体（栏、Dock、控制中心、通知、锁屏） | 内置 `theme.source = wallpaper` |
| Umbriel 边框 / 总览 / 标签栏 | 内置 `umbriel` 模板 |
| GTK3/GTK4（Thunar、Mousepad） | 内置 + 社区模板 |
| kitty / ghostty / btop / bat | 内置或自定义 user 模板 |
| Qt6（qBittorrent、fcitx5-configtool） | `qt` 模板 + qt6ct |
| Firefox 界面 | 社区 `pywalfox` + 扩展 |
| Zed / opencode | 社区模板写主题文件，配置里选对应主题 |
| fcitx5 | 自定义模板：保留原皮肤圆角和布局，只替换颜色 token |
| Thunderbird | 社区模板写 `userChrome.css`，重启后生效 |

**不会变的**也要写清楚，否则会一直以为哪里坏了：Steam、mpv/uosc、MangoHud、图标/光标/字体。前三个是没有现成模板或皮肤没装，后三个是设计如此。

### fcitx5 为什么没用社区模板

社区 fcitx5 模板是纯色扁平面板，换上去之后输入法候选框会变成一个方块，和原来的圆角皮肤完全不是一回事。

最后改成把原皮肤（mellow-youlan-dark）的圆角 SVG 复制出来，只把颜色替换成 `{{ colors.* }}` token。效果是**布局还是那个布局，颜色跟着壁纸走**。

换壁纸后模板会重新渲染并 `ReloadAddonConfig classicui`；偶尔候选框不刷新，重启一次 fcitx5 就好。

## 六、那些「配置了但没生效」的时刻

这条链跑起来之后，最常见的故障不是崩溃，而是**配置被更高优先级的来源盖掉**。

### `settings.toml` 会覆盖 home-manager

Noctalia 的设置界面把值写进 `~/.local/state/noctalia/settings.toml`，优先级高于 home-manager 生成的 `config.toml`。

所以会出现：仓库里明明写了 `wallpaper.directory`，运行中的 Noctalia 却是空的。第一次遇到时以为是模块没生效，查了半天才发现是界面里点过一次。

`doctor` 现在会检查 `[wallpaper]`、`[theme.templates]`、`[hooks]` 这几段有没有被覆盖。

### 重载不一定等于应用

- `noctalia msg config-reload` 只重读配置；
- `noctalia msg templates-apply` 才真正生成颜色文件；
- 第一次 apply 会下载社区模板，可能要跑两次才全部成功；
- Umbriel 的边框颜色没变，先 `umbriel msg config-reload`，还不行再重启合成器。

这类「三步里漏了一步」的问题，后来都写进了 `doctor` 和文档，而不是靠记忆。

## 七、抽成独立项目

跑稳之后，最自然的动作是把它从 `nixos-config` 里拆出去。

现在采集器、Home Manager 模块和 fcitx5 模板在独立仓库 `wallhaven-noctalia` 里，`nixos-config` 只通过 flake input 引用，本机配置只剩：

- 池子路径；
- API key 路径；
- Noctalia 包；
- `maxPerDay`、`trashDays` 这类参数。

换机的流程也固定了：

1. 先恢复 `~/.local/state/wallhaven-sync/` 里的索引和数据库；
2. `wallhaven-sync rehydrate` 按 active id 重新下载同一批图；
3. **不要**直接 `sync --force-prune`，那会丢 pin 并重新选图。

图片本体不进 git，也不进登录态备份——365 张约 1.4 GiB，重新下载比备份便宜。API key 和 state 会进加密备份。

## 最后

这条流水线真正花时间的部分，不是下载和调色，而是：

- 读对方的源码，确认哪些事不该自己做；
- 把「拒绝」分成永久和临时两类；
- 把所有删除做成可恢复；
- 把「谁写哪个文件」提前分清；
- 把结论写进 `doctor`，而不是留在聊天记录里。

现在它每天自己跑一次，我唯一会主动打开的命令是 `wallhaven-sync status`。一条自动化最好的状态，大概就是**平时想不起来它在跑**。
