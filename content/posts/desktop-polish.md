---
title: "一句水印、一个 OCR 键、一张写全的快捷键表"
date: 2026-11-21T17:00:00+08:00
draft: false
slug: "desktop-polish"
tags: ["NixOS","Umbriel","Noctalia","OCR","systemd","桌面"]
categories: []
salutation: "见字如面，"
description: "三件桌面上的小改动，各自踩了一个「看起来能用、其实没生效」的坑：autostart 不管进程、tesseract 给中文每个字加空格、Umbriel 的 keybinds 是整表替换。"
postscript: "水印的完整排障表在 nixos-config/docs/watermark.md，快捷键表在 docs/desktop-shortcuts.md；两处都和配置一一对应。"
---

## 写在前面

这三件事都很小：

- 想在屏幕右下角挂一句「激活 NixOS」的水印；
- 想按一个键就把屏幕上的字变成可复制的文本；
- 想有一张完整、能查的快捷键表。

结果三件都花了比预期长的时间，而且都栽在同一个模式上：**动作发出去了，但落在的那一层不是我以为的那一层**。

## 一、水印：从 autostart 到 systemd

`activate-linux` 是 Windows「Activate Windows」水印的 Linux 移植。它是一个 `wlr-layer-shell` 客户端，在每块屏右下角画两行字，位于 overlay 层，输入区域为空，鼠标可以点穿。

第一版配置很直接：放进 Umbriel 的 `general.autostart`。

### 问题一：autostart 只跑一次

Umbriel 启动时执行一次，之后进程崩溃、被杀、协议断开，都没有人拉起。更麻烦的是，`nixos-rebuild switch` 不会重跑 autostart——改完文案必须注销或重启合成器才看得到。

### 问题二：`-K` 在 Linux 上是「启动即退出」

为了防多开，我给它加了 `-K`。结果水印直接消失。

上游 `src/activate_linux.c` 的逻辑是：

```c
if (options.kill_running) {
  wayland_backend_kill_running();
  x11_backend_kill_running();
  exit(EXIT_SUCCESS);
}
```

而 Wayland/X11 的 `kill_running` 都是空实现，只打印两行 `not implemented`。所以带 `-K` 的自启会启动、打印错误、立刻退出。

**结论：Linux 上不要给 `activate-linux` 加 `-K`。**

### 改成 systemd user service

现在的 unit 长这样：

```nix
systemd.user.services.activate-linux = {
  Unit = {
    Description = "Activate NixOS watermark (activate-linux)";
    PartOf = [ "umbriel.service" ];
    After = [ "umbriel.service" ];
    ConditionEnvironment = "WAYLAND_DISPLAY";
    StartLimitIntervalSec = 60;
    StartLimitBurst = 10;
  };

  Service = {
    Type = "exec";
    ExecStart = "${pkgs.activate-linux}/bin/activate-linux "
      + "-t '激活 NixOS' -m '转到“设置”以激活 NixOS。'";
    Restart = "always";
    RestartSec = 3;
  };

  Install.WantedBy = [ "umbriel.service" ];
};
```

几个键的作用：

| 配置 | 作用 |
| --- | --- |
| `PartOf=umbriel.service` | Umbriel 重启时水印跟着重启，停止时跟着停止 |
| `After=umbriel.service` | 等合成器 READY 后再连，不抢跑 |
| `ConditionEnvironment=WAYLAND_DISPLAY` | 只在 Wayland 会话里启动 |
| `Restart=always` | 崩溃、被杀、协议断开后自动拉起 |
| `WantedBy=umbriel.service` | Umbriel 启动时把它拉起来 |

### 为什么是 `always` 而不是 `on-failure`

`activate-linux` 在合成器连接断开时，`wayland_backend_start()` 返回 0，进程是**干净退出**的。`on-failure` 不会拉起它。

而注销、停止 Umbriel 时，systemd 是主动停服务，`Restart=always` 也不会触发（`man systemd.service` 明确写了：由 systemd 操作导致的进程退出不会重启）。

所以 `always` 不会在注销时变成重启风暴，正好。

### 两个日常细节

- 想临时隐藏，用 `systemctl --user stop activate-linux`，不要 `pkill`。`pkill` 算意外退出，会被 `Restart=always` 拉回来。
- 首次启用时 `umbriel.service` 已经在跑，新增的 `WantedBy` 不会追溯启动，要手动 `systemctl --user start activate-linux` 或注销一次。

如果哪天不想再维护这个小进程，Noctalia 自带 `label` 桌面组件，可以零进程显示两行字。代价是它在 Bottom layer，会被普通窗口盖住，只在看桌面时可见。

## 二、OCR：一个键，把屏幕上的字变成文本

日常最高频的动作是「这个报错/这个地址/这段文字，我想复制」。

之前是截图、开图片、手动敲。现在按 `Mod+Shift+O`，画个框，文字直接进剪贴板。

脚本只有二十多行：

```bash
#!/usr/bin/env bash
set -o pipefail

region=${1:-}
if [ -z "$region" ]; then
  region=$(slurp) || exit 0
fi

if ! text=$(grim -g "$region" - \
  | tesseract stdin stdout -l chi_sim+eng 2>/dev/null \
  | ocr-clean); then
  noctalia msg notification-show "OCR 失败" "截图或识别步骤出错了" || true
  exit 1
fi

if [ -z "${text//[[:space:]]/}" ]; then
  noctalia msg notification-show "OCR" "选区里没认出文字" || true
  exit 0
fi

printf '%s' "$text" | wl-copy
preview=$(printf '%s' "$text" | tr '\n' ' ' | cut -c1-80)
noctalia msg notification-show "OCR 已复制到剪贴板" "$preview" || true
```

链路是：

```
slurp（画框）→ grim（截图）→ tesseract（中英混排）→ ocr-clean → wl-copy
```

几个刻意的设计：

- 没画框就静默退出（`slurp` 返回非零），不弹错误；
- 识别为空时明确告诉用户「选区里没认出文字」，而不是复制一段空白；
- 成功后弹通知预览前 80 个字，不用切窗口确认；
- 脚本同时装成命令 `ocr-region`，终端里也能跑，还能传区域参数方便测试。

### tesseract 的中文空格

第一版识别出来的中文是这样的：

```
这 是 一 段 中 文 ， 每 个 字 之 间 都 有 空 格 。
```

原因是 `chi_sim` 把每个汉字当成一个「单词」，词与词之间自然加空格。

后处理 `ocr-clean` 做的三件事：

1. **只删同一行内 CJK/假名/中文标点之间的空格**；
2. **保留换行**，也保留西文单词之间的空格；
3. 把夹在中文里的半角标点转成全角。

不能简单 `sed 's/ //g'`，那会把 `NixOS 26.11` 变成 `NixOS26.11`，也会把换行一起吃掉。

韩文不要过这个过滤器——韩文用空格分词，删了就粘成一坨。

### 顺带留下的 psm 经验

tesseract 的 `--psm` 参数决定了它怎么理解版面：

| 场景 | 参数 |
| --- | --- |
| 扫描页、整块文档 | `--psm 6`（按段落排） |
| 单行文字：按钮、标题、验证码 | `--psm 7` |
| 稀疏文字：PPT、桌面截图 | `--psm 11`（跳过空白） |

小字或模糊截图先灰度、放大两倍、锐化，再识别，成功率会高不少：

```bash
magick in.png -colorspace Gray -resize 200% -sharpen 0x1 /tmp/ocr.png
tesseract /tmp/ocr.png stdout -l chi_sim+eng | ocr-clean
```

## 三、快捷键表：Umbriel 的 keybinds 是整表替换

有段时间我总觉得「怎么什么快捷键都没有」。

原因不是键位写错，而是：**Umbriel 的配置里只要出现 `[keybinds]`，内置默认键位就整体失效，不会和你的键位合并。**

当时表里只写了 4 条，于是整个桌面的默认快捷键全没了。

解决方案只有两个：

- 要么完全不写这个表，用默认；
- 要么把需要的键位**写全**。

现在 `home/umbriel-base.nix` 里是一张完整的表，`docs/desktop-shortcuts.md` 和它一一对应，改键位时两处一起改。

### 一个不明显但好用的键

`Mod+Shift+W` 循环当前工作区的布局：

```
scrolling → dwindle → master → stacking
```

比进设置里点快得多。类似的还有 `Mod+/` 随时打开快捷键速查表，不用翻文档。

### 改键位不用注销

Umbriel 支持热替换配置：

```bash
f=$(readlink -f ~/.config/umbriel/config.toml)
umbriel config validate -c "$f"    # 期望：config: ok
umbriel config-replace "$f"
umbriel config get keybinds        # 看实际生效的键位
```

注意 `config-replace` 读的必须是 `readlink -f` 之后的真实文件。直接传软链路径，有一次它没读进去。

### 键位表本身的坑

`Mod` 在真机上是 Super，嵌套在别的桌面里运行时是 Alt。文档里要写清楚，否则换环境之后会以为键位失效。

另外，方向类动作到边缘不循环，只有 `output-focus-next` / `-previous` 才循环。这种细节不写下来，下次一定重新踩。

## 最后

三件事的共同点，其实是一条：

**不要相信「配置写了」这件事，要相信实际接管它的那一层。**

- 水印由 systemd 管，不是由开机脚本管；
- OCR 的输入是合成器的选区，不是剪贴板里的图；
- 快捷键由 Umbriel 整表接管，不是「默认加补丁」。

想清楚每件事的「执行者」是谁，很多看起来玄学的问题就变得很具体了。
