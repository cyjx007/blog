---
title: "从零搭到我现在这样：一台 NixOS 笔记本的完整搭建记录"
date: 2026-11-14T19:28:00+08:00
draft: false
slug: "nixos-from-zero"
tags: ["NixOS","Flake","Home Manager","Umbriel","Noctalia","搭建记录"]
categories: []
salutation: "见字如面，"
description: "没有备份、没有现成配置，从一张空盘开始，分 12 个阶段把 NixOS 搭成现在这台机器：桌面、输入法、开发环境、工作区、备份链路。每个阶段都有验收命令和回滚点。"
postscript: "这是「搭建顺序」的记录，不是命令大全。命令的完整解释在《NixOS 使用指南》里，换机恢复在《换一台电脑，把 NixOS 恢复成现在这样》里。"
---

## 写在前面

上一篇讲「有备份怎么恢复」，这一篇讲另一半：

**如果什么都没有，从一张空盘开始，怎么一步步长成现在这台机器？**

这两篇的分界线很清楚：

| | 恢复篇 | 本篇 |
| --- | --- | --- |
| 起点 | 空盘 + GitHub + OpenList | 空盘，什么都没有 |
| 配置 | clone 现成的 | 一行行写出来 |
| 时间 | 半天到一天 | 一到两周（每天几小时） |
| 重点 | 替换硬件、恢复身份 | 设计结构、踩坑、调优 |
| 风险 | 低 | 中（会重装几次） |

先说结论：**从零搭 NixOS 不是「装完就能用」，而是「分阶段长出来」。**

我把它拆成 12 个阶段。每个阶段都满足三个条件：

1. **能验收**：有一组命令能确认这阶段真的成了。
2. **能回滚**：出问题能退回上一个 generation。
3. **能提交**：做完就 commit，下一阶段基于它。

不要想着一次写完全部配置。那一定会失败，而且失败后你不知道是哪一行的问题。

## 目标：最终要长成什么样

先看终点，心里有个图：

| 层 | 最终状态 |
| --- | --- |
| 启动 | UEFI + systemd-boot，保留 6 代，Plymouth 开机动画 |
| 磁盘 | 单盘 btrfs，子卷 `/` `/nix` `/home`，zstd 压缩 |
| 内存 | zram swap，无磁盘 swap |
| 桌面 | Umbriel（wlroots 合成器）+ Noctalia（面板/Dock/通知/锁屏） |
| 登录 | greetd + noctalia-greeter |
| 输入法 | fcitx5 + 雾凇拼音（rime），Wayland 原生 |
| 字体 | Noto CJK + JetBrainsMono Nerd Font |
| 软件 | Firefox / Thunderbird / Thunar / mpv / zathura / GIMP / Kdenlive 等 |
| 开发 | gcc / node 22 / python3 / openssl / pkg-config |
| 用户配置 | Home Manager 管 git、kitty、GTK、光标、rime 同步 |
| 外观 | Noctalia 全量设置 + Catppuccin 风格 |
| 工作区 | `~/code` + 十几个独立仓库 + GitHub 脚本 |
| 备份 | secrets 加密包 + 登录态备份 + pre-push 钩子 + OpenList |
| 调优 | Cachix、auto-optimise、weekly GC、硬解、电源模式 |

最终目录结构：

```text
nixos-config/
├── flake.nix
├── flake.lock
├── hosts/
│   ├── laptop/        # 真机
│   ├── vm/            # 预览虚拟机
│   └── wsl/           # WSL 开发环境
├── modules/
│   ├── common.nix
│   ├── desktop/
│   │   ├── default.nix
│   │   ├── umbriel.nix
│   │   ├── noctalia.nix
│   │   ├── ime.nix
│   │   └── software.nix
│   ├── dev/
│   └── ai-cli/
├── home/
│   ├── base.nix
│   ├── desktop.nix
│   ├── umbriel-base.nix
│   ├── noctalia-settings.nix
│   └── rime-sync.nix
├── overlays/
├── pkgs/
└── docs/
```

下面是它长出来的过程。

## 阶段 0：准备（半天）

### 0.1 先想清楚三件事

装系统之前，先回答：

1. **这台机器是干什么的？** 主力机、开发机、还是折腾机？决定要不要双系统、要不要全盘加密。
2. **桌面要什么？** GNOME/KDE 最省事；Hyprland/Sway/Umbriel 这类合成器更自由，但要自己配面板、通知、锁屏。
3. **中文输入法用什么？** fcitx5 是 Wayland 下的事实标准，rime 词库最舒服，但首次配置有坑。

我选的是「单系统 + Umbriel + fcitx5/rime」。如果你只想稳定办公，装 GNOME 会少走很多路——这不是妥协，是合理选择。

### 0.2 记录硬件

装完再查会麻烦，尤其网卡型号：

```bash
lspci -nn | grep -E 'VGA|3D|Network|Audio'
lsusb
lsblk -o NAME,SIZE,MODEL,TYPE
```

把结果记在一个地方（手机备忘录也行）。重点：

- 无线网卡：决定要不要 `hardware.enableRedistributableFirmware`
- 显卡：决定 `videoDrivers` 和要不要 PRIME
- 磁盘：决定分区命令里的设备名
- 指纹/摄像头：决定开不开对应服务

### 0.3 做 U 盘

```bash
sudo dd if=nixos-26.11-graphical.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

Windows 用 Rufus 的 DD 模式。BIOS 里关 Secure Boot、关 Fast Boot、SATA 模式改 AHCI。

### 0.4 联网

Graphical ISO：

```bash
nmtui
```

Minimal ISO：

```bash
wpa_passphrase "SSID" "密码" > /tmp/wpa.conf
wpa_supplicant -B -i wlan0 -c /tmp/wpa.conf
dhcpcd wlan0
```

## 阶段 1：最小可启动系统（第 1 小时）

目标：**能开机、能联网、能敲命令。** 不要在这一步装桌面。

### 1.1 分区

```bash
lsblk -o NAME,SIZE,MODEL,TYPE
wipefs -a /dev/nvme0n1
sgdisk --zap-all /dev/nvme0n1

parted -s /dev/nvme0n1 mklabel gpt
parted -s /dev/nvme0n1 mkpart ESP fat32 1MiB 1GiB
parted -s /dev/nvme0n1 set 1 esp on
parted -s /dev/nvme0n1 mkpart root btrfs 1GiB 100%

mkfs.fat -F 32 -n NIXBOOT /dev/nvme0n1p1
mkfs.btrfs -f -L nixos /dev/nvme0n1p2

mount /dev/nvme0n1p2 /mnt
btrfs subvolume create /mnt/@
btrfs subvolume create /mnt/@home
btrfs subvolume create /mnt/@nix
umount /mnt

mount -o compress=zstd,noatime,subvol=@     /dev/nvme0n1p2 /mnt
mkdir -p /mnt/{boot,home,nix}
mount -o compress=zstd,noatime,subvol=@home /dev/nvme0n1p2 /mnt/home
mount -o compress=zstd,noatime,subvol=@nix  /dev/nvme0n1p2 /mnt/nix
mount /dev/nvme0n1p1 /mnt/boot
```

### 1.2 生成硬件配置

```bash
nixos-generate-config --root /mnt
```

得到 `/mnt/etc/nixos/hardware-configuration.nix`。这个文件之后会搬进仓库的 `hosts/laptop/`。

### 1.3 写最小 configuration.nix

```nix
{ config, pkgs, ... }:
{
  imports = [ ./hardware-configuration.nix ];

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.loader.systemd-boot.configurationLimit = 6;

  networking.hostName = "laptop";
  networking.networkmanager.enable = true;

  time.timeZone = "Asia/Shanghai";
  i18n.defaultLocale = "zh_CN.UTF-8";

  users.users.tanghuang = {
    isNormalUser = true;
    extraGroups = [ "wheel" "networkmanager" "video" "input" ];
  };
  security.sudo.wheelNeedsPassword = true;

  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  nixpkgs.config.allowUnfree = true;

  environment.systemPackages = with pkgs; [
    git vim curl wget htop ripgrep fd jq tree unzip p7zip
  ];

  system.stateVersion = "26.11";
}
```

### 1.4 安装

```bash
nixos-install
reboot
```

### 1.5 验收

```bash
nixos-version
ip a
ping -c1 nixos.org
sudo -v
```

四条都过，阶段 1 完成。没过就别往下走——网络和 sudo 是所有后续步骤的前提。

### 1.6 立刻做三件事

```bash
passwd                                  # 设自己的密码
sudo systemctl status NetworkManager    # 确认网络服务
sudo nixos-rebuild switch               # 确认配置能重建
```

第三条很重要：**如果第一次 switch 就失败，说明基础配置有问题，越早发现越好。**

## 阶段 2：把系统变成仓库（第 1 天）

目标：**不再编辑 `/etc/nixos/configuration.nix`，改成编辑 git 仓库里的 flake。**

### 2.1 为什么先建仓库再写配置

因为从这一刻开始，你所有的改动都有历史、能回滚、能推到远程。后面写错几千行都不怕。

```bash
mkdir -p ~/nixos-config
cd ~/nixos-config
git init
git branch -M main

mkdir -p hosts/laptop modules home overlays pkgs docs

cp /etc/nixos/hardware-configuration.nix hosts/laptop/
```

### 2.2 最小 flake.nix

```nix
{
  description = "我的 NixOS 配置";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, home-manager, ... }@inputs:
  let
    mkHost = extra: nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit inputs; };
      modules = [
        home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.backupFileExtension = "hm-bak";
          home-manager.extraSpecialArgs = { inherit inputs; };
        }
        ./modules/common.nix
      ] ++ extra;
    };
  in {
    nixosConfigurations.laptop = mkHost [ ./hosts/laptop ];
    formatter.x86_64-linux = nixpkgs.legacyPackages.x86_64-linux.nixfmt-rfc-style;
  };
}
```

### 2.3 modules/common.nix

把「所有主机都一样」的东西放这里：

```nix
{ pkgs, ... }:
{
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    trusted-users = [ "root" "@wheel" ];
    auto-optimise-store = true;
    connect-timeout = 5;
  };

  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 14d";
  };
  nix.optimise.automatic = true;

  time.timeZone = "Asia/Shanghai";
  i18n = {
    defaultLocale = "zh_CN.UTF-8";
    supportedLocales = [ "zh_CN.UTF-8/UTF-8" "en_US.UTF-8/UTF-8" ];
    extraLocaleSettings = {
      LC_TIME = "zh_CN.UTF-8";
      LC_NUMERIC = "zh_CN.UTF-8";
      LC_MONETARY = "zh_CN.UTF-8";
      LC_PAPER = "zh_CN.UTF-8";
      LC_MEASUREMENT = "zh_CN.UTF-8";
    };
  };

  nixpkgs.config.allowUnfree = true;

  environment.systemPackages = with pkgs; [
    curl git jq ripgrep wget
  ];

  programs.git = {
    enable = true;
    config.safe.directory = "*";
  };
}
```

### 2.4 先建一个最小的 home/base.nix

因为 flake 已经接了 Home Manager，`hosts/laptop/default.nix` 会引用 `home/base.nix`。这个文件现在还不存在，先建一个占位，否则阶段 2 的 switch 会报 `path does not exist`：

```nix
# home/base.nix（占位，阶段 7 再扩展）
{ ... }:
{
  home.username = "tanghuang";
  home.homeDirectory = "/home/tanghuang";
  home.stateVersion = "26.11";
}
```

### 2.5 hosts/laptop/default.nix

```nix
{ ... }:
{
  imports = [ ./hardware-configuration.nix ];

  networking.hostName = "laptop";
  system.stateVersion = "26.11";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.loader.systemd-boot.configurationLimit = 6;

  hardware.enableRedistributableFirmware = true;
  hardware.graphics.enable = true;
  services.xserver.videoDrivers = [ "modesetting" ];
  zramSwap.enable = true;

  users.users.tanghuang = {
    isNormalUser = true;
    extraGroups = [ "wheel" "networkmanager" "video" "input" ];
  };

  home-manager.users.tanghuang.imports = [ ../../home/base.nix ];
}
```

### 2.6 第一次 switch --flake

```bash
cd ~/nixos-config
git add -A
git commit -m "init: 最小 flake"

sudo nixos-rebuild switch --flake .#laptop
```

**注意 `git add`**：flake 只认 git 跟踪的文件。新文件不加，直接报 `path does not exist`。

### 2.7 验收

```bash
readlink /nix/var/nix/profiles/system
nixos-rebuild list-generations
cd ~/nixos-config && git status --short
```

从这一刻起，`/etc/nixos/configuration.nix` 就可以不管了。**唯一工作副本是 `~/nixos-config`。**

## 阶段 3：Nix 基础设施（第 1 天）

目标：**让构建走缓存、让磁盘不爆炸、让网络能通。**

### 3.1 加 Cachix

补进 `modules/common.nix` 里已有的 `nix.settings`（NixOS 模块系统会把 attrset 合并，不需要重写整块）：

```nix
nix.settings = {
  substituters = [
    "https://cache.nixos.org"
    "https://umbriel.cachix.org"
  ];
  trusted-public-keys = [
    "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
    "umbriel.cachix.org-1:JfNq/2yg2S6D6z4Z2dVSZrZlDPQTKtexB6GAVLD98nw="
  ];
};
```

公钥别凭记忆写，去项目页复制。

### 3.2 自动 GC

```nix
nix.gc = {
  automatic = true;
  dates = "weekly";
  options = "--delete-older-than 14d";
};
```

### 3.3 代理（如果需要）

`nix-daemon` 是独立进程，不继承 shell 的代理：

```nix
systemd.services.nix-daemon.environment = {
  https_proxy = "http://127.0.0.1:7890";
  http_proxy = "http://127.0.0.1:7890";
  no_proxy = "localhost,127.0.0.1,192.168.0.0/16";
};
```

### 3.4 GitHub token（拉私有 flake input 用）

```bash
install -d -m700 ~/.config/nix
printf 'access-tokens = github.com=%s\n' "$(cat ~/.config/git/github-token)" \
  > ~/.config/nix/nix.conf
```

### 3.5 验收

```bash
nix flake update
nixos-rebuild build --flake .#laptop
nix store gc --dry-run
```

`build` 应该大部分从缓存下载，而不是大量 `building`。如果一直在编译，先查网络和 substituters。

## 阶段 4：桌面（第 2–3 天）

目标：**从 TTY 进到一个真正的图形会话。**

### 4.1 选合成器

我选 Umbriel，理由是：

- wlroots 系，Wayland 原生，轻。
- 配置是 TOML，可以完全声明式地放进 Home Manager。
- 有配套的 Noctalia 做面板/通知/锁屏，不用自己拼 waybar + mako + swaylock。

代价是生态比 GNOME 小，遇到问题要自己查。

### 4.2 接 flake input

```nix
inputs = {
  umbriel.url = "github:noctalia-dev/umbriel";
  noctalia = {
    url = "github:noctalia-dev/noctalia";
    inputs.nixpkgs.follows = "nixpkgs";
  };
};
```

**umbriel 的 nixpkgs 不要 follow**。它的 Cachix 是按自己锁定的 nixpkgs 构建的，follow 之后 store path 对不上，只能本地编译 wlroots。

### 4.3 模块

```nix
# modules/desktop/umbriel.nix
{ inputs, ... }:
{
  imports = [ inputs.umbriel.nixosModules.default ];
  programs.umbriel.enable = true;
}

# modules/desktop/noctalia.nix
{ inputs, ... }:
{
  imports = [ inputs.noctalia.nixosModules.default ];
  programs.noctalia = {
    enable = true;
    recommendedServices.enable = true;   # NetworkManager / 蓝牙 / UPower
  };
}
```

`modules/desktop/default.nix` 把这两个、输入法、软件、字体都 import 进来，再在 `flake.nix` 里给 `laptop` 加上 `./modules/desktop`。

### 4.4 图形登录

```nix
services.displayManager.noctalia-greeter = {
  enable = true;
  settings = {
    cursor.size = 24;
    keyboard.layout = "us";
  };
};
```

这个模块会自己 enable greetd 并设 `default_session`。**不要再手写 `services.greetd.settings.default_session`**，会冲突。

### 4.5 验收

```bash
echo $XDG_SESSION_TYPE
pgrep -a umbriel
pgrep -a noctalia
```

能看到 `wayland` 和两个进程，就算成了。

### 4.6 起不来怎么办

| 现象 | 处理 |
| --- | --- |
| 黑屏 | systemd-boot 里加 `nomodeset`，进 TTY 改回核显 |
| 停在 greetd | `journalctl -u greetd -b`，看 session command 路径 |
| 进了桌面但没面板 | 看 Noctalia 的 autostart / `programs.noctalia` 是否 enable |
| 鼠标键盘没反应 | 检查 `video`/`input` 组，或者 libinput 是否加载 |

先保证能进 TTY（Ctrl+Alt+F2），所有图形问题都能在 TTY 里修。

## 阶段 5：中文与输入法（第 3–4 天）

目标：**能正常显示中文、能打中文、候选框不丑。**

### 5.1 字体

```nix
fonts = {
  packages = with pkgs; [
    noto-fonts
    noto-fonts-cjk-sans
    noto-fonts-cjk-serif
    noto-fonts-color-emoji
    nerd-fonts.jetbrains-mono
  ];

  fontconfig.defaultFonts = {
    sansSerif = [ "Noto Sans CJK SC" "Noto Sans" ];
    serif = [ "Noto Serif CJK SC" "Noto Serif" ];
    monospace = [ "JetBrainsMono Nerd Font" "Noto Sans Mono CJK SC" ];
    emoji = [ "Noto Color Emoji" ];
  };
}
```

旧写法 `fonts.fonts` 已经改成 `fonts.packages`。

### 5.2 fcitx5 + rime

```nix
i18n.inputMethod = {
  enable = true;
  type = "fcitx5";

  fcitx5 = {
    waylandFrontend = true;
    addons = with pkgs; [
      qt6Packages.fcitx5-chinese-addons
      (fcitx5-rime.override { rimeDataPkgs = [ rime-data rime-ice ]; })
      qt6Packages.fcitx5-configtool
      fcitx5-gtk
    ];
  };
}
```

### 5.3 五个真实的坑

1. **`fcitx5-chinese-addons` 在 26.11 里是 throw 别名**，真身在 `qt6Packages`。
2. **`rime-data` 的 `default.yaml` 会覆盖 rime-ice**，必须在 `default.custom.yaml` 里显式写 `schema_list`。
3. **皮肤软链**：`cp` 主题要带 `-L`，否则 `panel.svg` 断链，fcitx5 回退白皮肤。
4. **首次启动编译词库**要 30–60 秒，不是卡死。
5. **Electron 应用**要 `--enable-wayland-ime --ozone-platform-hint=auto`，或者设 `NIXOS_OZONE_WL=1`。

### 5.4 验收

```bash
fcitx5-diagnose | head -40
fcitx5-remote
fc-match "Noto Sans CJK SC"
```

然后实际打一段中文，在 Firefox、终端、Electron 应用里各试一次。

## 阶段 6：软件与开发工具（第 4–5 天）

目标：**日常软件齐全，开发工具链能用。**

### 6.1 software.nix

按类别放，不要堆在一个列表里：

```nix
environment.systemPackages = with pkgs; [
  # 浏览器
  firefox thunderbird
  # 文件
  thunar thunar-volman thunar-archive-plugin tumbler file-roller p7zip unzip unrar
  # 媒体
  mpv imv zathura tsukimi amberol ffmpeg kdePackages.kdenlive gimp
  # 文档
  tesseract poppler-utils ghostscript
  # 打印
  system-config-printer
];
```

配套服务：

```nix
services.udisks2.enable = true;    # U 盘/手机挂载
services.gvfs.enable = true;       # 回收站、网络位置
services.printing.enable = true;
services.avahi = {
  enable = true;
  nssmdns4 = true;
  openFirewall = true;
};
```

### 6.2 开发工具

```nix
# modules/dev/default.nix
{ pkgs, ... }:
{
  environment.systemPackages = with pkgs; [
    gcc gnumake nodejs_22 openssl pkg-config python3
    fastfetch btop
  ];
}
```

### 6.3 跑第三方二进制

```nix
programs.nix-ld.enable = true;
programs.nix-ld.libraries = with pkgs; [
  stdenv.cc.cc.lib zlib openssl
];
```

### 6.4 验收

```bash
firefox --version
node -v && python3 -V && gcc --version | head -1
thunar
mpv --version | head -1
```

## 阶段 7：Home Manager（第 5–6 天）

目标：**dotfiles 也进仓库，不再手改 `~/.config`。**

### 7.1 接入

阶段 2 的 flake 已经接了 `home-manager.nixosModules.home-manager`。现在写 `home/base.nix`：

```nix
{ config, pkgs, ... }:
{
  home.username = "tanghuang";
  home.homeDirectory = "/home/tanghuang";
  home.stateVersion = "26.11";

  home.packages = with pkgs; [ fd htop tree ];

  programs.git = {
    enable = true;
    settings = {
      init.defaultBranch = "main";
      user.name = "你的名字";
      user.email = "you@example.com";
    };
  };
}
```

### 7.2 接管 dotfiles 的顺序

不要一次全接管。按这个顺序：

1. `programs.git`（最重要，影响提交身份）
2. `programs.bash` 或 `programs.starship`
3. `programs.kitty`（终端）
4. `gtk` + `home.pointerCursor`
5. 各种 `xdg.configFile`

第一次接管已存在的文件会冲突：

```text
Existing file '/home/me/.config/kitty/kitty.conf' is in the way
```

开 `home-manager.backupFileExtension = "hm-bak"`，确认新配置没问题后再删备份。

### 7.3 desktop.nix

```nix
{
  imports = [
    inputs.umbriel.homeModules.default
    inputs.noctalia.homeModules.default
    ./rime-sync.nix
  ];

  programs.umbriel = {
    enable = true;
    settings = lib.mkDefault (import ./umbriel-base.nix);
  };

  programs.noctalia = {
    enable = true;
    checkConfig = false;          # 开发阶段关掉，省构建时间
    settings = import ./noctalia-settings.nix;
  };

  gtk = {
    enable = true;
    theme = { name = "Adwaita-dark"; package = pkgs.gnome-themes-extra; };
    iconTheme = { name = "Papirus-Dark"; package = pkgs.papirus-icon-theme; };
  };

  home.pointerCursor = {
    enable = true;
    name = "Bibata-Modern-Ice";
    package = pkgs.bibata-cursors;
    size = 24;
    gtk.enable = true;
    x11.enable = true;
  };
}
```

### 7.4 验收

```bash
home-manager generations | head
readlink ~/.config/kitty/kitty.conf
git config --global user.name
```

## 阶段 8：外观与桌面细节（第 1 周）

目标：**从「能用」到「像自己的机器」。**

### 8.1 Noctalia 设置

全部写进 `home/noctalia-settings.nix`，包括顶栏、Dock、通知、OSD、壁纸、主题。这样换机也能复现。

**注意**：Noctalia 的设置界面会写 `~/.local/state/noctalia/settings.toml`，同名键会**覆盖** `~/.config/noctalia/config.toml`。约定是：界面里调好后，把值同步进 Nix 文件，再把 state 文件改名备份。

### 8.2 快捷键

Umbriel 的 keybinds 在 `home/umbriel-base.nix`。**改键位时注意：`keybinds` 会整体替换默认值**，不是合并。要保留默认的，得把默认项也抄进去。

### 8.3 Qt / GTK 统一

```nix
qt = {
  enable = true;
  platformTheme.name = "kde";
  style = {
    name = "kvantum";
    package = pkgs.kvantum;
  };
};
```

Qt 对话框要中文，还需要：

```nix
environment.systemPackages = [ pkgs.qt6Packages.qttranslations ];
```

### 8.4 电源模式

```nix
services.power-profiles-daemon.enable = true;
```

之后：

```bash
powerprofilesctl get
powerprofilesctl set performance
```

### 8.5 验收

看三样：顶栏/面板是否正常、快捷键是否生效、Qt 应用是否是暗色且中文。

## 阶段 9：工作区与博客（第 1 周）

目标：**代码、笔记、博客都能在新机器上跑。**

### 9.1 clone 工作区

```bash
git clone https://github.com/cyjx007/code ~/code
cd ~/code
./sync-repos.sh
```

### 9.2 GitHub 脚本

`code/.dsh/github/gh.mjs` 用 token 调 REST：

```bash
node .dsh/github/gh.mjs GET /user
```

token 放 `~/.config/git/github-token`（600）。

### 9.3 博客

```bash
cd ~/blog
nix shell nixpkgs#hugo --command hugo server
```

没有 hugo 也没关系，用 `nix shell` 临时跑。发布就是 `git push`，Cloudflare Pages 自动构建。

### 9.4 双远端（可选）

如果家里有 Forgejo：

```bash
git remote set-url --add --push origin https://github.com/cyjx007/code.git
git remote set-url --add --push origin ssh://git@<内网地址>:2222/tanghuang/code.git
```

一次 push 推两处。

### 9.5 验收

```bash
node ~/code/.dsh/github/gh.mjs GET /user | head -5
cd ~/blog && git log --oneline -1
```

## 阶段 10：备份链路（第 1 周，最重要）

目标：**从这一刻起，机器坏了能恢复。**

### 10.1 凭据加密包

```bash
cd ~/code
./.dsh/tools/secrets-pack.sh -n     # 演练，看会打包什么
./.dsh/tools/secrets-pack.sh        # 真的生成 secrets-<日期>.tar.gz.enc
```

口令会自动生成到 `.dsh/SECRETS-PASSPHRASE.local.txt`（600）。**把它抄到手机密码管理器里**，否则包等于废的。

### 10.2 登录态备份

```bash
./.dsh/tools/userdata-backup.sh -n      # 看清单和大小
./.dsh/tools/userdata-backup.sh         # 打包 + 加密 + 上传
```

覆盖 SSH、git token、Firefox/Thunderbird 登录态、Telegram、tsukimi、AI key、KeePass、kwallet、rime 同步配置。

### 10.3 pre-push 钩子

```bash
git config core.hooksPath .dsh/githooks
cat .dsh/githooks/pre-push
```

之后每次 `git push` 会在后台跑一次登录态备份，不阻塞推送。

### 10.4 OpenList

路由器上跑 OpenList，目录：

```text
/cloud/code/recovery/          # 明文凭据（过渡用）
/cloud/code/userdata-backup/   # 登录态加密备份
```

**不要把 `/cloud` 暴露到公网。**

### 10.5 演练

```bash
# 1. 确认加密包能解开
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -in secrets-*.tar.gz.enc -out /tmp/test.tar.gz
tar -tzf /tmp/test.tar.gz | head
rm /tmp/test.tar.gz

# 2. 确认登录态备份能列清单
./.dsh/tools/userdata-backup.sh -n
```

### 10.6 验收

三条：加密包能解、登录态能列、`git push` 后 OpenList 上有新文件。

## 阶段 11：调优（第 2 周）

目标：**跑得稳、占得少、升级不慌。**

### 11.1 zram

```nix
zramSwap = {
  enable = true;
  memoryPercent = 50;
  algorithm = "zstd";
};
```

### 11.2 启动项限制

```nix
boot.loader.systemd-boot.configurationLimit = 6;
```

`/boot` 只有 1G，不限制迟早满。

### 11.3 GC

```nix
nix.gc = {
  automatic = true;
  dates = "weekly";
  options = "--delete-older-than 14d";
};
```

### 11.4 硬解

```nix
hardware.graphics.extraPackages = with pkgs; [ intel-media-driver ];
environment.sessionVariables.LIBVA_DRIVER_NAME = "iHD";
```

没有这个，mpv 的 `hwdec` 会静默退回软解，看 4K 风扇起飞。

### 11.5 升级策略

```bash
git commit -am "before update"
nix flake update
nixos-rebuild build --flake .#laptop
nix store diff-closures /run/current-system ./result
sudo nixos-rebuild switch --flake .#laptop
```

一个月更新一次就够。更新前 commit，坏了 `git revert` + 回滚 generation。

## 阶段 12：最终验收

一条条对照：

```bash
# 系统
nixos-version
systemctl --failed
nixos-rebuild list-generations | head -3

# 网络
nmcli device status
curl -sI https://nixos.org | head -1

# 桌面
echo $XDG_SESSION_TYPE
pgrep -a umbriel
pgrep -a noctalia

# 输入法
fcitx5-remote
fc-match "Noto Sans CJK SC"

# 开发
node -v; python3 -V; gcc --version | head -1

# 工作区
ls ~/code
node ~/code/.dsh/github/gh.mjs GET /user | head -3

# 备份
ls ~/code/secrets-*.enc
~/code/.dsh/tools/userdata-backup.sh -n

# 磁盘
df -h / /nix /boot
du -sh /nix/store
```

全部正常，就算「搭到我现在这样」了。

## 时间线与踩坑

| 阶段 | 大概耗时 | 最容易踩的坑 |
| --- | --- | --- |
| 0 准备 | 半天 | 网卡型号没记，装完没网 |
| 1 最小系统 | 1 小时 | 分区写错盘；ESP 太小 |
| 2 仓库化 | 半天 | 新文件没 `git add` |
| 3 基础设施 | 半天 | nix-daemon 不走代理 |
| 4 桌面 | 1–2 天 | 显卡 BusID 写错黑屏；greetd 冲突 |
| 5 输入法 | 1 天 | rime 配置被覆盖；皮肤断链 |
| 6 软件 | 半天 | 忘了 udisks2/gvfs，U 盘不显示 |
| 7 Home Manager | 1 天 | 文件冲突；`extraSpecialArgs` 写错 |
| 8 外观 | 1–2 天 | Noctalia state 文件覆盖配置 |
| 9 工作区 | 半天 | token 权限不对 |
| 10 备份 | 半天 | 口令没存，包等于没有 |
| 11 调优 | 半天 | GC 太激进，回滚不了 |
| 12 验收 | 1 小时 | 只看「能开机」，没测输入法/备份 |

几条总结：

1. **每个阶段结束都 commit。** 这是你唯一的「存档点」。
2. **先让系统能进 TTY，再折腾图形。** 图形起不来时，TTY 是救命通道。
3. **不要一次接管所有 dotfiles。** Home Manager 冲突一次改一个。
4. **备份要在「不需要它」的时候搭好。** 等坏了再搭就晚了。
5. **配置里的每一行，都要能解释为什么。** 否则半年后自己都看不懂。

## 结语

从零搭一台 NixOS，最像的不是「装系统」，而是「养一盆植物」。

第一天你只种下一颗种子（最小系统），然后每天加一片叶子（一个模块），偶尔修枝（重构），偶尔换盆（升级）。它不会一夜长成，但每长一片你都看得见，也都留得下。

等它长成现在这样，你会发现真正有价值的不是「这台机器能跑」，而是：

- 你知道每一部分为什么在那里。
- 你能把它复制到另一台机器。
- 你坏了能修，修不好能回滚。

这三件事，才是「从零到我现在这样」的真正含义。

此致
