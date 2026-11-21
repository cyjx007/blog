---
title: "给 GRUB 换一张星铁开机图，顺便和可变字体打了一架"
date: 2026-11-21T13:00:00+08:00
draft: false
slug: "grub-starrail"
tags: ["NixOS","GRUB","systemd-boot","字体","启动"]
categories: []
salutation: "见字如面，"
description: "systemd-boot 干净但不支持主题，于是换成 GRUB。真正花时间的不是引导配置，而是字体：GRUB 只认 pf2，Noto CJK 可变字体的默认实例是 Thin，最后要用 fontTools 切出 600 的字重。"
postscript: "主题来自公开的 StarRailGrubThemes 仓库；截图是自己机器上的菜单画面。字体和主题的 hash 都 pin 在配置里，换角色只需改 URL 和 hash。"
---

## 写在前面

systemd-boot 很好：配置简单、启动快、跟 systemd 一套。

但它有一个硬限制：**不支持主题和背景图**。

想要一个好看的开机菜单，只能换 GRUB。换完之后发现，引导本身半小时就搞定了，剩下的时间全花在字体上——这大概就是“看起来只是换张图”的典型。

先看结果：

![GRUB 菜单：星穹铁道 Aeon-Aha 主题](https://cloudflare-imgbed-auw.pages.dev/file/1795244012104_grub-starrail.jpg)

## 一、从 systemd-boot 换到 GRUB

### 先想好回退

改 bootloader 是少数“改完必须重启才能验证”的操作，所以回退路径要写在前面：

- systemd-boot 的 EFI 文件（`EFI/systemd`、`EFI/BOOT`）和 UEFI 启动项都还在；
- 开机按 F7 / F12（这台神舟是这两个）能选回旧的 `Linux Boot Manager`；
- `configurationLimit` 只保留最近几代，不会把 `/boot` 撑满。

有这三条，最坏情况也只是多按一次键。

### 配置

```nix
boot.loader.systemd-boot.enable = false;
boot.loader.efi.canTouchEfiVariables = true;
boot.loader.timeout = 3;

boot.loader.grub = {
  enable = true;
  efiSupport = true;
  device = "nodev";          # 纯 EFI，不往 MBR 写
  configurationLimit = 6;    # 菜单只留最近 6 代
  gfxmodeEfi = "1920x1080";  # 主题背景是 1080p，别被拉伸
};
```

`device = "nodev"` 是纯 EFI 系统的写法。如果还往 MBR 写，反而可能把别的东西弄坏。

`gfxmodeEfi` 要和主题背景的分辨率对上。背景是 1920×1080，菜单却跑在 1024×768，画面就会被拉得很难看。

## 二、主题：别拉整个仓库

星铁主题的仓库里有很多角色，但**每个角色单独打成了 release 资产**，一个包大约 2.7 MB。

整个仓库包含大量预览图，动辄几百 MB。只为了一个角色去拉整仓，不划算。

所以用 `fetchzip` 直接取单个角色的包：

```nix
starRailGrubTheme = pkgs.fetchzip {
  url = "https://github.com/voidlhf/StarRailGrubThemes/releases/download/20261121-044459/Aeon-Aha_cn.tar.gz";
  hash = "sha256-M70P1l9iMkn6pTkjV9RFcs0AI6oxuree1X7QnqxQoMk=";
};
```

换角色时：

1. 把 URL 里的 `Aeon-Aha_cn` 换成别的目录名；
2. 用 `nix store prefetch-file --unpack --json <新URL>` 拿新 hash；
3. 改配置，switch。

然后挂上去：

```nix
boot.loader.grub.theme = starRailGrubTheme;
boot.loader.grub.splashImage = "${starRailGrubTheme}/background.png";
```

主题目录里要有 `theme.txt`；背景图顺便也给 GRUB 兜底，避免主题加载失败时是一片黑。

## 三、字体：三个坑叠在一起

这是整件事真正的难点。

### 坑一：GRUB 只认 pf2

GRUB 不读 OTF/TTF，只读自己转出来的 **pf2 点阵字体**。NixOS 会在构建时调 `grub-mkfont` 转换，所以配置里给的是源字体路径。

中文版主题的倒计时标签是：

```
当前已选中系统将会在 %d 秒后启动
```

所以字体必须带 CJK 字形。选了 Noto Sans CJK。

### 坑二：可变字体的默认实例是 Thin

第一次做出来的菜单，字细得像头发丝。

原因：`NotoSansCJK-VF.otf.ttc` 是一个**可变字体（Variable Font）**，默认轴是：

```
wght = 100
```

也就是 Thin。`grub-mkfont` 只会取默认实例，不会问你要哪个字重。

所以不能直接把 VF 丢给它，得先“实例化”出 600（SemiBold）的静态字体。

### 坑三：TTC 里不止一个字体

`NotoSansCJK-VF.otf.ttc` 是一个字体集合，包含 JP / KR / SC / TC / HK 好几个 face。中文要用 **SC**，索引是 2：

```
0 = JP
1 = KR
2 = SC
3 = TC
4 = HK
```

用 fontTools 一次做完：

```nix
grubMenuFont = pkgs.runCommand "grub-font-noto-sans-cjk-sc-semibold.pf2" {
  nativeBuildInputs = [
    pkgs.python3Packages.fonttools
    pkgs.grub2
  ];
} ''
  python3 - <<'PY'
  from fontTools.ttLib import TTCollection
  from fontTools.varLib.instancer import instantiateVariableFont

  src = "${pkgs.noto-fonts-cjk-sans}/share/fonts/opentype/noto-cjk/NotoSansCJK-VF.otf.ttc"
  collection = TTCollection(src)
  font = collection.fonts[2]  # SC
  instantiateVariableFont(font, {"wght": 600}, inplace=True)
  font.save("font.otf")
  PY

  grub-mkfont --size 26 -o $out font.otf
'';
```

这样出来的才是 SemiBold 600、26px 的 pf2。

## 四、NixOS 模块的一个隐藏坑

把字体挂上去时，第一版写的是：

```nix
boot.loader.grub.font = grubMenuFont;   # ❌ 传 derivation
```

构建直接报错，大意是 `isFromBootstrapFiles missing`。

原因是 NixOS 的 GRUB 模块会把这个值塞进 `builtins.toXML`。传 derivation 进去，求值器会去遍历它的 `passthru`，然后在一个不存在的属性上炸掉。

正确写法是**传字符串**：

```nix
boot.loader.grub.font = "${grubMenuFont}";
```

但这样又有一个新问题：字符串只是路径，不算构建依赖，`nixos-rebuild build` 可能不会真的把字体编出来，而是留到 switch 时现编。

所以要显式拉进系统闭包：

```nix
system.extraDependencies = [ grubMenuFont ];
```

完整的一段：

```nix
boot.loader.grub.font = "${grubMenuFont}";
system.extraDependencies = [ grubMenuFont ];
```

## 五、验证与回退

改完：

```bash
cd ~/nixos-config
nixos-rebuild build --flake .#laptop     # 先只构建
sudo nixos-rebuild switch --flake .#laptop
sudo reboot
```

重启后看三件事：

1. 菜单是星铁主题，背景没有被拉伸；
2. 中文倒计时标签的字重是 SemiBold，不是头发丝；
3. 能正常进系统，`/boot` 没被撑满。

如果菜单没出来，或者进不了系统：

- 开机按 F7 / F12，选旧的 `Linux Boot Manager`；
- 或在 GRUB 菜单里选上一代 generation；
- 最坏情况从 UEFI 启动项回退，systemd-boot 的文件还在。

## 最后

这次折腾的配置本身不复杂，真正值得记的是三个“默认值”：

- **默认的字体实例**是 Thin，不是 Regular，更不是 SemiBold；
- **默认的 TTC face** 是 JP，不是 SC；
- **默认的 Nix 值传递**会求值 derivation，而不是把它当路径。

每一个都不是 bug，只是“默认”和“我以为”不一样。开机菜单这种不常改的东西，尤其容易在半年后忘记当时为什么这么写——所以把 hash、字体实例、回退路径都留在配置注释里，比留在记忆里可靠。
