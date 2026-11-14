---
title: "NixOS 使用指南：从小白到大神"
date: 2026-11-14T19:20:00+08:00
draft: false
slug: "nixos-guide"
tags: ["NixOS","Linux","Nix","Flake","Home Manager","教程"]
categories: []
salutation: "见字如面，"
description: "从装系统到写 flake：一份 NixOS 26.11 的完整使用指南。涵盖 nix store 与 generation、nixos-rebuild、Home Manager、flake、开发环境、自己打包、Wayland 桌面、缓存与代理、排障手册和远程部署。"
postscript: "文中配置片段来自我的 nixos-config 仓库（NixOS 26.11）。版本不同选项名可能变化，以你机器上的 search.nixos.org/options 为准。"
---

## 写在前面

这封信有点长，长到可能要折三折。

我在这台笔记本上跑 NixOS 有一段时间了：26.11，单盘 btrfs，systemd-boot，Umbriel + Noctalia 桌面，fcitx5 打中文，整套系统配置在一个 flake 仓库里，`git push` 之后换台机器就能复现。这一路踩过的坑，比我在 Arch 上两年踩的还多，但也比任何一次折腾都值。

所以我想把这件事完整写一遍——**从「NixOS 是什么」到「自己写模块、打补丁、远程部署」**，中间不跳步。

这篇不是官方手册的翻译。官方手册当然更权威，但它假设你已经知道很多名词；这篇假设你只会用 Ubuntu，甚至只会用 Windows，然后把那些名词一个一个拆开。

读法建议：

- 前六章按顺序读，别跳。NixOS 的门槛全在概念上，概念通了，后面全是查文档。
- 第七章之后可以当参考书，用到哪节翻哪节。
- 文中的配置片段都可以直接抄，但**版本以 NixOS 26.11 为准**。NixOS 改选项名的速度不慢，旧教程里 `hardware.opengl.enable`、`fonts.fonts` 这类写法现在会直接报错，我在相应位置标了新旧对照。

我的环境，供你对照：

| 项 | 值 |
| --- | --- |
| 系统 | NixOS 26.11（unstable 分支的 nixpkgs） |
| 磁盘 | 单盘 btrfs，子卷 `/` `/nix` `/home` + 1G vfat `/boot` |
| 启动 | systemd-boot，保留最近 6 代 |
| 桌面 | Umbriel（wlroots 合成器）+ Noctalia（面板/Dock/通知） |
| 输入法 | fcitx5 + 雾凇拼音（rime） |
| 配置 | `flake.nix` + `home-manager`，主机分 `laptop` / `vm` / `wsl` |

好，开始。

## 一、NixOS 到底是个什么东西

### 1.1 一句话版本

**NixOS 是一个「整台系统由一份配置文件描述」的 Linux 发行版。**

你不再「装一个包」，而是「在配置里写一句 `environment.systemPackages = [ pkgs.firefox ];`」，然后运行一条命令，系统就变成你想要的样子。想撤销？回滚到上一代就行，几秒钟。

这句话听起来像营销，但它是字面意思。你的整个系统——内核、驱动、服务、桌面、字体、输入法、甚至 `/etc` 下大部分文件——都是从一份（或一组）`.nix` 文件**计算**出来的。

### 1.2 和你熟悉的发行版差在哪

| 维度 | Ubuntu / Arch / Fedora | NixOS |
| --- | --- | --- |
| 装包 | `apt install` / `pacman -S`，直接改系统 | 改配置 → `nixos-rebuild switch` |
| 配置在哪 | `/etc` 里一堆手改的文件 | `.nix` 文件；`/etc` 是生成的 |
| 卸载干净吗 | 经常留残渣 | 不用的东西不在闭包里，GC 后彻底消失 |
| 升级失败 | 手动修，可能救不回来 | 重启选上一代，或 `--rollback` |
| 两台机器一致 | 写脚本、用 Ansible | 同一个 flake，`switch` 两次 |
| 学习曲线 | 平缓 | 前三天陡，之后很平 |
| 磁盘占用 | 小 | 大（store 会堆，需要 GC） |
| 生态 | 全部 | 绝大部分，个别闭源软件要自己打包 |

最重要的一行是第三行：**NixOS 的「回滚」是系统级、原子性的。** 不是「备份了再恢复」，是「上一代还在硬盘上，改个启动项就回去了」。

### 1.3 三个关键词：store、derivation、generation

这三个词你必须懂，否则后面全是天书。

**① /nix/store —— 只读的仓库**

所有软件、配置、内核、甚至一篇文章生成出来的静态站点，只要经过 Nix 构建，都会落在这个目录里，路径长这样：

```text
/nix/store/7xq2m9...-firefox-142.0/
/nix/store/1a2b3c...-nixos-system-laptop-26.11.20261110.abcdef/
```

路径前面的那串 hash 不是随机数，是**这个包所有输入（源码、依赖、编译参数、补丁）的指纹**。输入变一个字节，hash 就变，就是一个全新的路径。

这带来两个后果：

- 同一个软件的不同版本可以**同时存在**，互不冲突（`/nix/store` 里可能躺着三个 Python）。
- 已经构建好的东西**永远不会被就地修改**。升级不是覆盖，是「构建一个新的，然后把软链接指过去」。

**② derivation —— 构建配方**

一个 derivation 就是一份「怎么从源码做出这个包」的说明书：源码在哪、依赖谁、跑什么命令、产物是什么。你在 `.nix` 里写的 `pkgs.firefox` 最终会求值成一堆 derivation。

你可以把 derivation 理解成 Makefile + 依赖锁 + 输出指纹三合一。

**③ generation —— 系统快照**

每次 `nixos-rebuild switch` 成功，都会生成一个新的 generation。它记录的是「这一代系统指向 store 里哪些路径」。

```text
/nix/var/nix/profiles/system-1-link -> /nix/store/...-nixos-system-...
/nix/var/nix/profiles/system-2-link -> /nix/store/...-nixos-system-...
/nix/var/nix/profiles/system -> system-2-link
```

`system` 这个软链接指向当前代。回滚就是把软链接指回上一代，再重启。**没有任何文件被删除或覆盖**，所以回滚是瞬间的、可靠的。

### 1.4 它不适合谁

说点实话，免得你装完骂我。

- **你只有一台电脑，且不能接受半天不能用。** 第一次装 NixOS，请留好退路（双系统、U 盘 live、或者先虚拟机）。
- **你需要某个只在 AUR 里的国产软件，且不会打包。** NixOS 没有 AUR。要么找现成包，要么自己写 derivation，要么用 `distrobox` / `nix-ld` 跑二进制。
- **你讨厌读文档。** NixOS 的报错很有用，但需要你愿意顺着报错去查 option。
- **你想要「点一下就好」。** 图形化配置在 NixOS 里是二等公民，声明式才是主线。

反过来说，如果你符合下面任意一条，NixOS 会很香：

- 有多台机器，想统一环境。
- 经常折腾，又经常把系统折腾坏。
- 做开发，需要精确复现某套工具链。
- 单纯喜欢「配置即代码」这种秩序感。

### 1.5 装之前的心态准备

请记住一句话：**在 NixOS 上，「改配置文件」永远优先于「直接改系统」。**

- 想装软件 → 写进配置，不要 `nix-env -i`。
- 想改服务 → 写 `services.xxx`，不要手改 `/etc/systemd/system`。
- 想调内核参数 → 写 `boot.kernelParams`，不要改 GRUB 配置。
- 实在没有对应选项 → 才用 `environment.etc` 或 `systemd.services` 兜底。

手改的东西在下次 rebuild 时会被覆盖，或者更糟：看起来生效了，但换台机器就没了。**配置仓库里没有的，等于不存在。**

## 二、装系统（小白篇）

### 2.1 先别急着抹盘

三条路，按风险从低到高：

1. **虚拟机**：VirtualBox / GNOME Boxes / QEMU 都行。装一遍，玩两天，确认喜欢再上真机。
2. **双系统**：留 40G 以上空闲空间，Windows 那边先关掉快速启动和 BitLocker。
3. **全盘**：想清楚，数据先备份。

我最推荐第 1 条。NixOS 在虚拟机里体验是完整的，除了显卡和休眠。

另外，如果你在 Windows 上用 WSL2，也可以装 NixOS-WSL（官方社区项目）。它跑的是真正的 NixOS 用户空间，只是没有自己的内核和桌面。拿来练 `nix` 命令、写 flake 完全够用。我自己的 `wsl` 主机就是这么用的。

### 2.2 制作启动 U 盘

去 <https://nixos.org/download> 下载 ISO。两个版本：

- **Graphical ISO**（约 2.5G）：带图形安装器和 NetworkManager，新手选这个。
- **Minimal ISO**（约 1G）：纯命令行，适合老手和服务器。

写盘：

```bash
# Linux
sudo dd if=nixos-26.11-graphical.iso of=/dev/sdX bs=4M status=progress oflag=sync

# Windows 用 Rufus 或 balenaEtcher，选 DD 模式
```

`/dev/sdX` 是整块 U 盘，不是分区（别写成 `/dev/sdX1`，会写不进去还报错）。

### 2.3 分区：UEFI + btrfs 子卷

开机按 F12/F2 选 U 盘，进 live 环境。先确认磁盘：

```bash
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
```

假设目标盘是 `/dev/nvme0n1`（**整块盘会被清空**）。下面这套是单盘 btrfs，`/`、`/nix`、`/home` 各一个子卷，方便单独快照和回滚：

```bash
# 1. 分区表
parted /dev/nvme0n1 -- mklabel gpt
parted /dev/nvme0n1 -- mkpart ESP fat32 1MiB 1GiB
parted /dev/nvme0n1 -- set 1 esp on
parted /dev/nvme0n1 -- mkpart primary 1GiB 100%

# 2. 文件系统
mkfs.fat -F 32 -n boot /dev/nvme0n1p1
mkfs.btrfs -L nixos /dev/nvme0n1p2

# 3. 建子卷
mount /dev/nvme0n1p2 /mnt
btrfs subvolume create /mnt/@
btrfs subvolume create /mnt/@nix
btrfs subvolume create /mnt/@home
umount /mnt

# 4. 挂载
mount -o compress=zstd,noatime,subvol=@ /dev/nvme0n1p2 /mnt
mkdir -p /mnt/{boot,nix,home}
mount -o compress=zstd,noatime,subvol=@nix /dev/nvme0n1p2 /mnt/nix
mount -o compress=zstd,noatime,subvol=@home /dev/nvme0n1p2 /mnt/home
mount /dev/nvme0n1p1 /mnt/boot
```

为什么单独给 `/nix` 一个子卷？两个好处：给 `/` 做快照时不会把几十 G 的 store 一起快照；以后想换发行版，`/nix` 可以原样保留（理论上，实际还要看兼容性）。

**swap 怎么办？** 我这台机器用 zram，不建 swap 分区：

```nix
zramSwap.enable = true;
```

它会在内存里压缩出一块 swap，比磁盘 swap 快得多，代价是吃一点 CPU。16G 内存的笔记本开这个，日常完全够。要休眠（hibernate）才需要真的 swapfile。

### 2.4 联网

Graphical ISO 直接用 `nmtui`：

```bash
nmtui          # 选 Activate a connection → 选 Wi-Fi → 输密码
ping -c 2 nixos.org
```

Minimal ISO 没有 NetworkManager，用 wpa_supplicant：

```bash
ip a                                  # 找到无线网卡，比如 wlan0
wpa_passphrase "你的SSID" "你的密码" > /tmp/wpa.conf
wpa_supplicant -B -i wlan0 -c /tmp/wpa.conf
dhcpcd wlan0
```

有线的话插上就通，不用配。

### 2.5 生成初始配置

```bash
nixos-generate-config --root /mnt
```

它会在 `/mnt/etc/nixos/` 下生成两个文件：

- `hardware-configuration.nix`：磁盘 UUID、内核模块、CPU 微码。**这个文件基本不要手改**，重装时重新生成即可。
- `configuration.nix`：系统配置，你的主战场。

先看一眼 `hardware-configuration.nix`，确认 `fileSystems` 里的挂载点和 UUID 对得上：

```bash
cat /mnt/etc/nixos/hardware-configuration.nix
```

### 2.6 第一次 nixos-install

最朴素的装法：

```bash
nixos-install
```

它会问你 root 密码，然后开始下载、构建、安装。第一次通常 5–20 分钟，取决于网速。装完：

```bash
reboot
```

如果你已经决定用 flake（推荐，后面会讲），流程是：

```bash
# 在 live 环境里把配置仓库 clone 到 /mnt/etc/nixos/
git clone https://github.com/你的用户名/nixos-config /mnt/etc/nixos/nixos-config
# 把刚生成的 hardware-configuration.nix 拷进去
cp /mnt/etc/nixos/hardware-configuration.nix /mnt/etc/nixos/nixos-config/hosts/laptop/
# 装
nixos-install --flake /mnt/etc/nixos/nixos-config#laptop
```

注意 `#laptop` 是 flake 里 `nixosConfigurations` 的名字，必须对得上。

### 2.7 最小可用 configuration.nix

装完第一次开机，你会看到一个朴素的 TTY 或者图形登录界面。先把这份配置写进去，得到一个「能日常用」的系统：

```nix
{ config, pkgs, ... }:
{
  imports = [ ./hardware-configuration.nix ];

  # ---- 启动 ----
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.loader.systemd-boot.configurationLimit = 6;

  # ---- 网络 ----
  networking.hostName = "nixos";
  networking.networkmanager.enable = true;

  # ---- 时区与语言 ----
  time.timeZone = "Asia/Shanghai";
  i18n.defaultLocale = "zh_CN.UTF-8";
  i18n.extraLocaleSettings = {
    LC_TIME = "zh_CN.UTF-8";
    LC_NUMERIC = "zh_CN.UTF-8";
    LC_MONETARY = "zh_CN.UTF-8";
    LC_PAPER = "zh_CN.UTF-8";
    LC_MEASUREMENT = "zh_CN.UTF-8";
  };

  # ---- 用户 ----
  users.users.me = {
    isNormalUser = true;
    extraGroups = [ "wheel" "networkmanager" "video" "input" ];
    # 密码用 passwd 设，别写 initialPassword（明文会进 /nix/store）
  };
  security.sudo.wheelNeedsPassword = true;

  # ---- Nix 本身 ----
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  nix.settings.auto-optimise-store = true;
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 14d";
  };
  nixpkgs.config.allowUnfree = true;

  # ---- 常用软件 ----
  environment.systemPackages = with pkgs; [
    vim
    git
    curl
    wget
    htop
    ripgrep
    fd
    jq
    tree
    unzip
    p7zip
  ];

  # 首次安装时定死，之后不要改
  system.stateVersion = "26.11";
}
```

保存后：

```bash
sudo nixos-rebuild switch
```

如果这条命令成功，恭喜，你已经跨过了 NixOS 最大的门槛。接下来都是「往这份文件里加东西」的游戏。

**关于 `system.stateVersion`**：它标记「你首次安装时的版本」，用来让某些服务保持向后兼容的默认值。**装完就别动它**，升级系统不需要改。改了可能让数据库格式、用户目录结构发生意外迁移。

## 三、日常操作：重建系统

### 3.1 四条命令，覆盖 99% 的场景

```bash
# 只构建，不激活。不需要 root，用来检查配置对不对
nixos-rebuild build --flake .#laptop

# 构建 + 激活，但重启后回到旧系统（临时试配置）
sudo nixos-rebuild test --flake .#laptop

# 构建 + 设为下次启动默认，不立即激活
sudo nixos-rebuild boot --flake .#laptop

# 构建 + 激活 + 设为默认（最常用）
sudo nixos-rebuild switch --flake .#laptop
```

我自己的习惯是：

1. 改配置。
2. `nixos-rebuild build --flake .#laptop` —— 不 sudo，快，能抓 90% 的错。
3. `sudo nixos-rebuild switch --flake .#laptop` —— 真的激活。
4. 没问题就 `git commit`。

如果只是改了个小东西想立刻看效果，`test` 更快（不动启动项）。但注意：`test` 的改动重启就没了，别拿它当正式部署。

### 3.2 回滚的三种方式

**① 命令回滚（最快）**

```bash
sudo nixos-rebuild switch --rollback
```

它会把系统切到上一个 generation。如果你的改动还没重启就已经发现问题，这条就够了。

**② 启动菜单回滚（最可靠）**

重启，在 systemd-boot 菜单里选「NixOS - Generation N」（上一代）。系统起不来时用这个。

**③ 手动指软链接（救援用）**

```bash
sudo /nix/var/nix/profiles/system-41-link/bin/switch-to-configuration switch
```

或者 live 环境里 `nixos-enter` 进去改。一般用不到，但知道它存在会安心。

### 3.3 generation 管理

```bash
# 列出所有系统代
nixos-rebuild list-generations

# 看当前代
readlink /nix/var/nix/profiles/system

# 删掉 30 天前的代（连带清理 store）
sudo nix-collect-garbage --delete-older-than 30d

# 删掉除当前代以外的所有代（激进）
sudo nix-collect-garbage -d
```

注意：`nix-collect-garbage -d` 删的是**所有 profile 的旧代**，包括 home-manager 的。删完就不能回滚到旧代了，所以别在「刚升级完还没验证」的时候跑。

`/boot` 只有 1G 的话，很容易被旧内核塞满。`boot.loader.systemd-boot.configurationLimit = 6` 会自动只保留 6 代，这个选项建议人人都开。

### 3.4 改配置的标准流程

```bash
cd ~/nixos-config

# 1. 改文件
$EDITOR hosts/laptop/default.nix

# 2. 构建检查（不用密码）
nixos-rebuild build --flake .#laptop

# 3. 激活
sudo nixos-rebuild switch --flake .#laptop

# 4. 提交
git add -A
git commit -m "feat(desktop): 加 zathura"
git push
```

第 4 步不是仪式感。**配置仓库是你唯一的工作副本**，不提交等于没做。我有一次把 `cp -r` 的副本当成工作目录，改了半天，最后差点用旧配置覆盖新的——从那以后，所有改动都先进 git。

### 3.5 不要再用 /etc/nixos 当工作目录

传统教程会让你直接编辑 `/etc/nixos/configuration.nix`。**用 flake 之后不要这样。**

原因：

- `/etc/nixos` 不在 git 里，改坏了没历史。
- 用 `nixos-rebuild --flake .#host` 时，flake 求值走的是 **git 跟踪的文件**（`git ls-files`），`/etc/nixos` 里的东西它看不见。
- 一旦你同时维护两份，早晚会不一致。

正确做法：仓库放 `~/nixos-config`，`/etc/nixos` 留个软链接或者干脆空着。我的机器上 `/etc/nixos` 只有一个安装器留下的备份文件。

## 四、装软件的四种姿势

这是新手最容易混乱的地方。同样是「装 Firefox」，有四种写法，效果完全不同。

| 方式 | 写在哪 | 生效范围 | 适合 |
| --- | --- | --- | --- |
| `environment.systemPackages` | 系统配置 | 全机所有用户 | 系统工具、驱动、服务 |
| `home.packages` | home-manager | 当前用户 | 日常应用、CLI 工具 |
| `nix shell` / `nix run` | 命令行临时 | 当前 shell | 试软件、一次性任务 |
| `nix profile install` | 命令式 | 当前用户 | 不推荐，容易和声明式打架 |

### 4.1 系统级：environment.systemPackages

```nix
environment.systemPackages = with pkgs; [
  firefox
  git
  htop
];
```

`with pkgs;` 的意思是「后面的名字都从 `pkgs` 里找」，省得写 `pkgs.firefox`。这个语法在 Nix 里很常见，但别滥用——嵌套太深时容易看不清名字从哪来。

装完 `switch` 之后，这些包会出现在所有用户的 `PATH` 里。

### 4.2 用户级：home.packages

```nix
home.packages = with pkgs; [
  ripgrep
  fd
  bat
  eza
];
```

区别只在「给谁装」。系统级包进的是系统 profile，用户级进的是用户 profile。实际使用中，**能放用户级就放用户级**：升级更灵活，不污染系统，多用户时也不会互相干扰。

不过有些东西必须系统级：

- 需要 setuid 的（`sudo`、`ping` 的某些实现）
- 需要系统服务的（`NetworkManager`、`bluetooth`）
- 需要出现在 `/run/current-system/sw/bin` 的（某些脚本硬编码这个路径）
- 字体、图标主题（`fonts.packages`、`home.pointerCursor` 除外）

### 4.3 临时用：nix shell 和 nix run

不想为了一次性任务装包？直接开一个带工具的 shell：

```bash
# 临时进入带 ffmpeg 和 imagemagick 的 shell，退出即消失
nix shell nixpkgs#ffmpeg nixpkgs#imagemagick

# 直接跑，不进交互 shell
nix run nixpkgs#cowsay -- "hello nixos"

# 跑某个 flake 里的程序
nix run github:NixOS/nixpkgs#hello
```

这是 Nix 最爽的功能之一。你需要 `jq` 处理一个文件，不想装、不想留垃圾，`nix shell nixpkgs#jq` 用完 `exit`，系统干干净净。

`nix shell` 里 `nixpkgs#` 是 flake 引用语法，等价于「从 nixpkgs 这个 flake 里取这个包」。第一次会下载，之后走缓存。

### 4.4 不推荐：nix profile

```bash
nix profile install nixpkgs#firefox
```

它能装，但装进去的东西**不在你的配置里**。换台机器就没了，而且容易和 `home.packages` 里的同名包冲突（两个 Firefox 在 PATH 里打架）。

只有一种情况我会用它：**在还没决定要不要长期用的软件上试水**，试完记得 `nix profile list` 看名字，再 `nix profile remove <名字>` 清掉。

### 4.5 怎么找包

```bash
# 命令行搜索（要 flakes）
nix search nixpkgs firefox

# 查某个包的信息
nix eval nixpkgs#firefox.version
nix eval nixpkgs#firefox.meta.description
```

更常用的是网页：<https://search.nixos.org/packages>。它还能按「有没有 aarch64 构建」「license 是不是 free」筛。

查**选项**用 <https://search.nixos.org/options>。这个比包搜索更重要——NixOS 有上万个 option，你能想到的系统行为基本都有对应开关，只是名字不一定直觉。

小技巧：在配置里想知道某个 option 的当前值，可以

```bash
nix eval .#nixosConfigurations.laptop.config.services.xserver.videoDrivers
```

或者进 REPL：

```bash
nix repl
:lf .
nixosConfigurations.laptop.config.services.xserver.videoDrivers
```

### 4.6 版本、多版本、override

NixOS 默认只给一个版本，但你可以同时装多个：

```nix
environment.systemPackages = with pkgs; [
  python3
  python311
  nodejs_20
  nodejs_22
];
```

二进制名会冲突（两个 `python3`），所以更常见的做法是用 `nix shell` 临时切版本，或者用 `pkgs.python311.withPackages` 组合环境。

改包的编译参数用 `override`：

```nix
(pkgs.firefox.override { ... })
(pkgs.hello.overrideAttrs (old: {
  patches = (old.patches or []) ++ [ ./my-fix.patch ];
}))
```

改整个 nixpkgs 的包用 overlay（第七章讲）。

## 五、Flake：现代 NixOS 的入口

### 5.1 为什么用 flake

不用 flake 也能用 NixOS（channel + `configuration.nix`），但 flake 解决了三个痛点：

1. **锁定版本**：`flake.lock` 记录每个依赖的确切 commit，半年后重建，得到的还是同一套东西。
2. **统一入口**：系统配置、开发环境、包、格式化工具，全都可以从 `flake.nix` 暴露出来。
3. **可组合**：别人的 flake 可以直接当 input 用（home-manager、nixos-wsl、各种主题都是这么分发的）。

现在社区新项目基本都默认 flake。NixOS 官方也在往这个方向走（`nixos-rebuild --flake` 已经是一等公民）。

### 5.2 flake.nix 逐段讲

下面是我仓库的简化版，保留了结构，去掉了业务细节：

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
          home-manager.extraSpecialArgs = { inherit inputs; };
        }
        ./modules/common.nix
      ] ++ extra;
    };
  in {
    nixosConfigurations = {
      laptop = mkHost [ ./hosts/laptop ./modules/desktop ./modules/dev ];
      vm     = mkHost [ ./hosts/vm ./modules/desktop ];
    };

    formatter.x86_64-linux = nixpkgs.legacyPackages.x86_64-linux.nixfmt-rfc-style;
  };
}
```

一段一段看：

**`inputs`** —— 这个 flake 依赖谁。每个 input 是一个 URL，可以是 GitHub、GitLab、tarball、本地路径。`nix flake lock` 会把它们解析成具体 commit 写进 `flake.lock`。

**`inputs.nixpkgs.follows = "nixpkgs"`** —— 让 home-manager 用它自己的 nixpkgs 依赖时，改用我这里的 nixpkgs。不加这句，flake 里会出现两份 nixpkgs，包重复、闭包变大、还可能版本冲突。

**`outputs`** —— 这个 flake 对外提供什么。`nixosConfigurations` 是系统配置，`devShells` 是开发环境，`packages` 是包，`formatter` 是 `nix fmt` 用的格式化器。

**`mkHost`** —— 我自己写的小函数，把「所有主机共用的模块」和「这台主机特有的模块」拼起来。这样加一台机器只要一行。

**`specialArgs`** —— 把 `inputs` 传给所有模块，模块里就能直接写 `{ inputs, ... }:` 拿到别的 flake。

**`legacyPackages`** —— nixpkgs 不是标准 flake，它的包集合放在 `legacyPackages.<system>` 下，所以这里要写全。

### 5.3 lock 文件与更新

`flake.lock` 是自动生成的 JSON，**要提交到 git**。它保证「今天能构建的，明年今天还能构建」。

更新依赖：

```bash
# 更新所有 input
nix flake update

# 只更新 nixpkgs
nix flake update nixpkgs

# 把某个 input 钉到具体 commit
nix flake lock --override-input nixpkgs github:NixOS/nixpkgs/<commit>
```

更新的正确姿势：

```bash
nix flake update
nixos-rebuild build --flake .#laptop              # 先构建，看有没有坏
nix store diff-closures /run/current-system ./result   # 看变了哪些包（进阶）
sudo nixos-rebuild switch --flake .#laptop
```

别每天 `nix flake update`。unstable 分支一天一个样，稳定用一个月再更新一次比较舒服。更新前先 `git commit`，坏了直接 `git revert`。

### 5.4 新文件必须先 git add

这是 NixOS + flake 最坑的坑之一：

```text
error: path '/home/me/nixos-config/modules/foo.nix' does not exist
```

文件明明在那里。为什么？

因为 flake 在 git 仓库里求值时，**只把 git 跟踪的文件复制到 store**（`git ls-files`）。新建的文件没 `git add`，Nix 就当它不存在。

解决：

```bash
git add modules/foo.nix
sudo nixos-rebuild switch --flake .#laptop
```

记住这条，能省你半小时。

### 5.5 devShell：给项目配环境

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
  let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
  in {
    devShells.${system}.default = pkgs.mkShell {
      packages = with pkgs; [
        nodejs_22
        python3
        gcc
        gnumake
        pkg-config
        openssl
      ];

      shellHook = ''
        echo "node $(node -v) / python $(python3 -V)"
      '';
    };
  };
}
```

进环境：

```bash
nix develop
```

它会给你一个 shell，里面 `node`、`python3`、`gcc` 都是声明的那几个版本，退出就消失。项目里放一个 `flake.nix`，队友 `nix develop` 一下，环境完全一致，不用再写「请安装 Node 22，别用 18」这种 README。

`mkShell` 还支持：

```nix
mkShell {
  packages = [ ... ];
  buildInputs = [ ... ];       # 编译时依赖
  nativeBuildInputs = [ ... ]; # 构建工具
  shellHook = '''';
  NIX_ENFORCE_PURITY = 0;      # 少数场景关掉纯度检查
}
```

### 5.6 nix flake check 与格式化

```bash
# 求值所有 outputs，检查有没有坏
nix flake check

# 格式化（用 flake 里定义的 formatter）
nix fmt
```

`nix flake check` 会把 `nixosConfigurations`、`devShells`、`packages` 全部求值一遍，能抓出「某个模块引用了不存在的 option」这类错误。CI 里跑这个很合适。

`nix fmt` 需要 flake 里有 `formatter.<system>`，我配的是 `nixfmt-rfc-style`，官方推荐的格式。

### 5.7 多个 nixpkgs 怎么办

除了 `follows`，还有一种情况：**你确实需要两个不同版本的 nixpkgs**（比如一个包在新版坏了）。

```nix
inputs = {
  nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-26.05";
};

# 用的时候
environment.systemPackages = [
  inputs.nixpkgs-stable.legacyPackages.x86_64-linux.someOldPackage
];
```

代价是闭包变大（两套 glibc、两套 Qt）。能不用就不用。

## 六、Home Manager：把 dotfiles 也声明化

### 6.1 它解决什么问题

系统配置管的是 `/etc`、服务、内核。但你的 `~/.bashrc`、`~/.config/kitty/kitty.conf`、`~/.gitconfig` 呢？

传统做法是 dotfiles 仓库 + stow/chezmoi。Home Manager 把这层也接进 Nix：

```nix
programs.git = {
  enable = true;
  settings.user.name = "你的名字";
  settings.user.email = "you@example.com";
};
```

它生成 `~/.config/git/config`，内容由 Nix 管理。改配置 → `switch` → 文件更新，全程可回滚。

### 6.2 两种集成方式

**① 作为 NixOS 模块（我用的）**

```nix
# flake.nix
modules = [
  home-manager.nixosModules.home-manager
  {
    home-manager.useGlobalPkgs = true;
    home-manager.useUserPackages = true;
    home-manager.backupFileExtension = "hm-bak";
  }
];

# hosts/laptop/default.nix
home-manager.users.me = {
  imports = [ ../../home/base.nix ../../home/desktop.nix ];
};
```

好处：跟系统一起 `nixos-rebuild switch`，不用记两套命令。

**② 独立使用**

```bash
home-manager switch --flake .#me
```

适合非 NixOS 系统（macOS、Ubuntu 上也能用 Home Manager）。

### 6.3 programs.* / home.file / xdg.configFile

三种写法，从「有现成模块」到「完全手写」：

```nix
# 1. 有 programs.* 模块的，优先用
programs.kitty = {
  enable = true;
  settings = {
    font_size = 12;
    background_opacity = 0.9;
  };
};

# 2. 配置文件在 ~/.config 下的，用 xdg.configFile
xdg.configFile."nix/nix.conf".text = ''
  experimental-features = nix-command flakes
'';

# 3. 其他地方（~/.bashrc、~/.ssh/config），用 home.file
home.file.".ssh/config".text = ''
  Host *
      AddKeysToAgent yes
'';

# 4. 直接放一个文件进去
home.file.".config/foo/bar.conf".source = ./dotfiles/bar.conf;
```

`programs.*` 模块的好处是它会帮你处理「配置格式」「服务重启」「环境变量」。比如 `programs.git` 会同时处理 `~/.gitconfig` 和 XDG 路径；`programs.fcitx5` 会接好输入法环境变量。

没有模块的软件就退回 `xdg.configFile`，一样能用。

### 6.4 文件冲突与备份

如果 `~/.config/kitty/kitty.conf` 已经存在（你手写的），Home Manager 默认会报错：

```text
Existing file '/home/me/.config/kitty/kitty.conf' is in the way
```

两种处理：

```nix
# 方案 A：让它自动备份成 .hm-bak
home-manager.backupFileExtension = "hm-bak";

# 方案 B：手动删掉旧文件，让 HM 接管
rm ~/.config/kitty/kitty.conf
```

我建议第一次接管时用 `backupFileExtension`，确认新配置没问题后再删备份。

### 6.5 系统 vs 用户的边界

经验法则：

| 放系统 | 放用户 |
| --- | --- |
| 驱动、内核、文件系统 | 编辑器、终端、浏览器 |
| 系统服务（ssh、cups） | git、bash、starship |
| 字体、输入法框架 | 输入法词库/皮肤 |
| 用户账号、sudo | dotfiles、桌面快捷键 |
| 需要 root 才能装的东西 | 日常 CLI 工具 |

不确定的时候问自己：**「换一个用户登录，这东西还应该在吗？」** 在 → 系统；不在 → 用户。

## 七、配置怎么组织（从单文件到仓库）

### 7.1 单文件能撑多久

`configuration.nix` 在 200 行以内很舒服。超过 500 行就开始痛苦：找一个选项要滚半天，改一处怕碰坏另一处。

这时候该拆了。拆的原则只有一个：**按「变化的原因」拆，不是按文件类型拆。**

- `common.nix`：所有机器都一样的（时区、Nix 设置、基础包）
- `desktop/`：桌面相关的（合成器、输入法、主题）
- `dev/`：开发工具链
- `hosts/<name>/`：这台机器特有的（硬件、hostName、显卡）
- `home/`：用户级配置

### 7.2 我的目录树

```text
nixos-config/
├── flake.nix
├── flake.lock
├── hosts/
│   ├── laptop/
│   │   ├── default.nix
│   │   └── hardware-configuration.nix
│   ├── vm/
│   └── wsl/
├── modules/
│   ├── common.nix
│   ├── desktop/
│   │   ├── default.nix
│   │   ├── ime.nix
│   │   ├── software.nix
│   │   └── umbriel.nix
│   └── dev/default.nix
├── home/
│   ├── base.nix
│   ├── desktop.nix
│   └── rime-sync.nix
├── overlays/default.nix
├── pkgs/
└── docs/
```

对应到 flake：

```nix
nixosConfigurations = {
  laptop = mkHost [ ./hosts/laptop ./modules/desktop ./modules/dev ];
  vm     = mkHost [ ./hosts/vm ./modules/desktop ];
  wsl    = mkHost [ ./hosts/wsl ./modules/dev ];
};
```

`common.nix` 在 `mkHost` 里统一加，不用每台机器重复写。

### 7.3 写一个自己的模块

模块的本质是「一组 option + 一组 config」。下面是一个完整例子：

```nix
# modules/services/hello.nix
{ lib, config, pkgs, ... }:
{
  options.my.services.hello = {
    enable = lib.mkEnableOption "hello 演示服务";

    port = lib.mkOption {
      type = lib.types.port;
      default = 8080;
      description = "监听端口";
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.hello;
      description = "要跑的程序";
    };
  };

  config = lib.mkIf config.my.services.hello.enable {
    systemd.services.hello = {
      description = "Hello service";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        ExecStart = "${config.my.services.hello.package}/bin/hello";
        DynamicUser = true;
        Restart = "on-failure";
      };
    };

    networking.firewall.allowedTCPPorts = [ config.my.services.hello.port ];
  };
}
```

用的时候：

```nix
imports = [ ./modules/services/hello.nix ];

my.services.hello = {
  enable = true;
  port = 9000;
};
```

几个关键函数：

| 函数 | 作用 |
| --- | --- |
| `lib.mkIf 条件 值` | 条件成立才生效 |
| `lib.mkDefault 值` | 设默认值，别人可以覆盖 |
| `lib.mkForce 值` | 强制覆盖，别人改不动 |
| `lib.mkMerge [ ... ]` | 合并多个配置块 |
| `lib.mkBefore` / `mkAfter` | 列表拼接顺序 |
| `lib.mkEnableOption` | 生成一个布尔开关 |

**`mkDefault` 和 `mkForce` 是解决「选项冲突」的钥匙。** 两个模块同时设了 `services.foo.port`，NixOS 会报 conflict。这时在「更默认」的那边用 `mkDefault`，或者明确用 `mkForce` 压过对方。

### 7.4 specialArgs：把外部东西传进模块

模块的函数参数是 NixOS 自动传的（`pkgs`、`lib`、`config`）。想传自己的东西：

```nix
# flake.nix
nixosSystem {
  specialArgs = { inherit inputs; };
  modules = [ ... ];
}
```

```nix
# 任何模块
{ inputs, pkgs, ... }:
{
  environment.systemPackages = [
    inputs.umbriel.packages.${pkgs.system}.umbriel
  ];
}
```

`specialArgs` 给 NixOS 模块用，`extraSpecialArgs` 给 Home Manager 模块用。两个名字很像，别写错。

### 7.5 多主机复用

同一份桌面配置跑在三台机器上，靠的是「模块化 + 条件」：

```nix
# modules/desktop/default.nix
{ config, lib, pkgs, ... }:
{
  imports = [
    ./umbriel.nix
    ./noctalia.nix
    ./ime.nix
    ./software.nix
  ];

  # 只有真机才需要的
  services.xserver.videoDrivers = lib.mkIf (config.networking.hostName == "laptop") [ "modesetting" ];
}
```

或者更干净：把差异全部放进 `hosts/<name>/default.nix`，模块保持「只描述功能，不描述硬件」。

## 八、开发环境（进阶）

### 8.1 一个真实的 devShell

假设你要写一个 Node + Rust 的混合项目：

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, rust-overlay }:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      overlays = [ rust-overlay.overlays.default ];
    };
    rust = pkgs.rust-bin.stable.latest.default;
  in {
    devShells.${system}.default = pkgs.mkShell {
      packages = [
        rust
        pkgs.cargo-watch
        pkgs.nodejs_22
        pkgs.pnpm
        pkgs.pkg-config
        pkgs.openssl
      ];

      RUST_SRC_PATH = "${rust}/lib/rustlib/src/rust/library";

      shellHook = ''
        echo "rust: $(rustc --version)"
        echo "node: $(node --version)"
      '';
    };
  };
}
```

`rust-overlay` 是 Rust 生态的标准做法，能精确指定 toolchain 版本（`rust-bin.stable."1.83.0".default`）。

### 8.2 direnv：进目录自动进环境

每次手敲 `nix develop` 很烦。装 direnv + nix-direnv：

```nix
# home/base.nix
programs.direnv = {
  enable = true;
  nix-direnv.enable = true;
};

programs.bash.initExtra = ''
  eval "$(direnv hook bash)"
'';
```

项目里：

```bash
echo "use flake" > .envrc
direnv allow
```

以后 `cd` 进目录自动加载，`cd` 出去自动卸载。第一次会慢一点（要构建/下载），之后有缓存，基本无感。

### 8.3 打包自己的脚本

最轻量的打包方式：

```nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.writeShellApplication {
  name = "my-backup";
  runtimeInputs = with pkgs; [ rsync openssl curl ];
  text = ''
    set -euo pipefail
    echo "backing up..."
    rsync -a "$HOME/docs/" /mnt/backup/docs/
    echo "done"
  '';
}
```

`writeShellApplication` 会自动加 `shellcheck` 检查、`set -euo pipefail`、把 `runtimeInputs` 加进 PATH。产物在 `$out/bin/my-backup`，可以直接 `nix run .#my-backup`。

比手写 `#!/bin/sh` 强的地方：**依赖是声明式的**，换台机器不会因为没装 `rsync` 而挂。

### 8.4 打包一个真实软件

```nix
# pkgs/hello-tool.nix
{ lib, stdenv, fetchFromGitHub, makeWrapper, ffmpeg }:

stdenv.mkDerivation (finalAttrs: {
  pname = "hello-tool";
  version = "1.2.3";

  src = fetchFromGitHub {
    owner = "someone";
    repo = "hello-tool";
    tag = "v${finalAttrs.version}";
    hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    install -m755 hello-tool $out/bin/
    wrapProgram $out/bin/hello-tool \
      --prefix PATH : ${lib.makeBinPath [ ffmpeg ]}
    runHook postInstall
  '';

  meta = with lib; {
    description = "一个演示用的工具";
    homepage = "https://github.com/someone/hello-tool";
    license = licenses.mit;
    mainProgram = "hello-tool";
    platforms = platforms.linux;
  };
})
```

第一次构建会报 hash mismatch，把报错里的 `got:` 值填回 `hash` 即可（这是 Nix 的标准工作流，不是出错）。

`fetchFromGitHub` 需要 hash；`fetchurl` 也是。本地文件用 `./file` 或 `builtins.path`，不需要 hash。

### 8.5 overlay：改包、加包

```nix
# overlays/default.nix
final: prev: {
  local = prev.callPackage ../pkgs { };

  # 给某个包打补丁
  my-app = prev.my-app.overrideAttrs (old: {
    patches = (old.patches or []) ++ [ ../patches/fix-crash.patch ];
  });

  # 换版本
  nodejs_22 = prev.nodejs_22.override { ... };
}
```

挂进系统：

```nix
nixpkgs.overlays = [ (import ./overlays { inherit inputs; }) ];
```

之后 `pkgs.local.hello-tool` 就能用了。

`final` 和 `prev` 的区别：`final` 是「应用完所有 overlay 之后」的包集，`prev` 是「应用之前」的。互相引用时用 `final` 才能看到彼此；用 `prev` 容易拿到旧版本。大多数情况用 `final` 更安全。

### 8.6 语言生态的坑

- **Python**：不要 `pip install` 到系统环境。用 `python3.withPackages (ps: [ ps.requests ])`，或者项目里用 venv（venv 本身可以由 Nix 提供 python）。
- **Node**：`npm install -g` 会写到 `~/.npm-global` 之类的地方，能用但不声明式。长期用的 CLI 工具用 `pkgs.` 装，项目依赖用 `package.json`。
- **Rust**：`rustup` 在 NixOS 上能用，但更推荐 `rust-overlay`。`cargo install` 出来的二进制不在 Nix 管理下，升级/卸载要手动。
- **动态链接**：NixOS 没有 `/lib64/ld-linux-x86-64.so.2` 这种固定路径，预编译二进制（比如某些 IDE、游戏启动器）可能跑不起来。解法是 `nix-ld`：

```nix
programs.nix-ld.enable = true;
programs.nix-ld.libraries = with pkgs; [
  stdenv.cc.cc.lib
  zlib
  openssl
];
```

开了之后，`./some-binary` 会自动用 nix-ld 找库。这是 NixOS 跑第三方二进制的标准方案。

## 九、系统级定制（进阶）

### 9.1 写一个 systemd 服务

NixOS 里写服务非常舒服，不用碰 unit 文件：

```nix
systemd.services.my-backup = {
  description = "每日备份";
  wantedBy = [ "multi-user.target" ];
  after = [ "network-online.target" ];
  wants = [ "network-online.target" ];

  serviceConfig = {
    Type = "oneshot";
    User = "me";
    ExecStart = "${pkgs.bash}/bin/bash /etc/my-backup.sh";
    Nice = 10;
  };
};

systemd.timers.my-backup = {
  wantedBy = [ "timers.target" ];
  timerConfig = {
    OnCalendar = "daily";
    Persistent = true;   # 关机错过的，开机补跑
  };
};
```

`systemd.services.<name>` 的每个字段基本对应 unit 文件里的 `[Service]` 段。`wantedBy` 对应 `[Install] WantedBy`。

定时任务用 `systemd.timers`，比 cron 好在：有日志（`journalctl -u my-backup`）、能补跑、能加依赖。

### 9.2 内核参数与模块

```nix
boot.kernelParams = [ "quiet" "splash" "loglevel=3" ];
boot.kernelModules = [ "kvm-intel" "wireguard" ];
boot.blacklistedKernelModules = [ "nouveau" ];
```

改内核版本：

```nix
boot.kernelPackages = pkgs.linuxPackages_latest;
# 或者指定一个 nixpkgs 里确实存在的版本
boot.kernelPackages = pkgs.linuxPackages_6_12;
```

换内核前先 `nixos-rebuild build`，确认构建过。有些第三方模块（ZFS、NVIDIA）对新内核支持滞后。`pkgs.linuxPackages_6_12` 只是个例子，26.11 的内核版本可能已经更高，具体有哪些用 `nix search nixpkgs linuxPackages_` 查。

### 9.3 显卡与 Wayland

NixOS 24.11 之后，`hardware.opengl` 改名为 `hardware.graphics`：

```nix
hardware.graphics.enable = true;
```

Intel/AMD 核显：

```nix
services.xserver.videoDrivers = [ "modesetting" ];
```

NVIDIA 双显卡（PRIME offload）：

```nix
hardware.nvidia = {
  modesetting.enable = true;
  powerManagement.enable = true;
  open = false;                  # 16 系及更老用闭源
  prime = {
    offload.enable = true;
    offload.enableOffloadCmd = true;
    intelBusId = "PCI:0:2:0";
    nvidiaBusId = "PCI:1:0:0";
  };
};
```

BusID 用 `lspci | grep -E 'VGA|3D'` 查，写错会黑屏。之后单程序用独显：

```bash
nvidia-offload blender
```

Wayland 相关的环境变量：

```nix
environment.sessionVariables = {
  NIXOS_OZONE_WL = "1";          # Electron/Chromium 走 Wayland
  MOZ_ENABLE_WAYLAND = "1";      # Firefox
  QT_QPA_PLATFORM = "wayland";
  SDL_VIDEODRIVER = "wayland";
  CLUTTER_BACKEND = "wayland";
};
```

### 9.4 内存、swap、休眠

```nix
# zram：内存压缩 swap
zramSwap = {
  enable = true;
  memoryPercent = 50;      # 最多用一半内存
  algorithm = "zstd";
};

# 要休眠才需要 swapfile
swapDevices = [{
  device = "/var/lib/swapfile";
  size = 16 * 1024;        # MB
}];

boot.resumeDevice = "/dev/disk/by-uuid/...";
```

注意：btrfs 上 swapfile 需要特殊处理（`btrfs filesystem mkswapfile`），而且不能开 CoW。NixOS 的 `swapDevices` 会帮你做一部分，但 btrfs 子卷 + 压缩的情况下建议单独查文档。

### 9.5 存储：让 /nix/store 别爆炸

```nix
nix.settings.auto-optimise-store = true;   # 硬链接去重
nix.optimise.automatic = true;

nix.gc = {
  automatic = true;
  dates = "weekly";
  options = "--delete-older-than 14d";
};
```

手动清理：

```bash
# 看 store 多大
du -sh /nix/store

# 看谁占地方（需要 nix-tree）
nix run nixpkgs#nix-tree -- /nix/var/nix/profiles/system

# 清掉所有不可达路径
sudo nix-collect-garbage -d

# 只清 30 天前的
sudo nix-collect-garbage --delete-older-than 30d
```

`/nix/store` 里有很多「硬链接共享」的文件，`du` 会重复计算。用 `nix path-info -Sh` 看真实闭包大小。

`/boot` 满了的症状是 `nixos-rebuild switch` 报 `No space left on device`。开 `configurationLimit`，或者手动删旧代后 `nix-collect-garbage -d`。

### 9.6 容器与虚拟化

```nix
# Docker
virtualisation.docker.enable = true;
users.users.me.extraGroups = [ "docker" ];

# Podman（更干净，不需要 daemon）
virtualisation.podman.enable = true;

# libvirt / KVM
virtualisation.libvirtd.enable = true;
programs.virt-manager.enable = true;

# systemd-nspawn 容器（NixOS 原生）
containers.mycontainer = {
  autoStart = true;
  config = { ... };   # 一个完整的 NixOS 配置
};
```

NixOS 的 `containers.*` 很有意思：每个容器就是一个 NixOS 系统，配置写在主配置里，`nixos-container root-login mycontainer` 进去。适合跑隔离的服务。

### 9.7 防火墙与 SSH

```nix
networking.firewall = {
  enable = true;
  allowedTCPPorts = [ 22 80 443 ];
  allowedUDPPorts = [ ];
  trustedInterfaces = [ "tailscale0" ];
};

services.openssh = {
  enable = true;
  settings = {
    PasswordAuthentication = false;
    PermitRootLogin = "no";
  };
};
```

改 SSH 配置时**先确认新配置能登录，再退出当前会话**，否则可能把自己锁在外面。稳妥做法：保留一个已登录的 root 会话，另开一个窗口测试。

## 十、桌面：Wayland 那一套（本机实录）

### 10.1 Umbriel + Noctalia 是什么

- **Umbriel**：基于 wlroots 的 Wayland 合成器，配置用 TOML，轻量、可脚本化。
- **Noctalia**：桌面 shell（面板、Dock、通知、锁屏、设置界面），风格接近 Material You。

两者都有 flake 包，也有 Cachix 缓存。我的 flake 里：

```nix
inputs = {
  umbriel.url = "github:noctalia-dev/umbriel";
  noctalia = {
    url = "github:noctalia-dev/noctalia";
    inputs.nixpkgs.follows = "nixpkgs";
  };
};
```

**一个坑**：umbriel 的 nixpkgs **不要** `follows` 本仓库。它的 Cachix 缓存是按自己锁定的 nixpkgs 构建的，改了 follow 会导致 store path 对不上，只能本地编译 wlroots（很慢）。

### 10.2 登录界面

用 greetd + noctalia-greeter：

```nix
services.displayManager.noctalia-greeter = {
  enable = true;
  settings = {
    cursor.size = 24;
    keyboard.layout = "us";
  };
};
```

这个模块自己会 enable greetd 并设置 `default_session`。**不要再手写 `services.greetd.settings.default_session`**，会冲突。

想开机免登录：

```nix
services.greetd.settings.initial_session = {
  command = "${config.programs.umbriel.package}/bin/start-umbriel";
  user = "me";
};
```

### 10.3 输入法：fcitx5 + 雾凇拼音

wlroots 系合成器只有 `text-input-v3`，没有 GNOME 的 `input-method-v2`。所以 **ibus 基本不能用，fcitx5 是标准选择**。

```nix
i18n.inputMethod = {
  enable = true;
  type = "fcitx5";

  fcitx5 = {
    waylandFrontend = true;    # 走 text-input-v3，不靠 GTK_IM_MODULE
    addons = with pkgs; [
      qt6Packages.fcitx5-chinese-addons
      (fcitx5-rime.override { rimeDataPkgs = [ rime-data rime-ice ]; })
      qt6Packages.fcitx5-configtool
      fcitx5-gtk
    ];
  };
};
```

五个真实的坑：

1. **`fcitx5-chinese-addons` 在 26.11 里是 throw 别名**，真身在 `qt6Packages.fcitx5-chinese-addons`。升级后如果报 attribute missing，改回顶层路径试试。
2. **`rime-data` 的 `default.yaml` 会覆盖 rime-ice 的配置**。必须在 `default.custom.yaml` 里显式写 `schema_list`，否则候选方案不对。
3. **皮肤软链**：`cp` 主题目录时要加 `-L`，否则 `panel.svg` 这类相对软链会断，fcitx5 加载失败会退回白色默认皮肤。
4. **首次启动会编译词库**，要等几十秒，不是卡死。
5. **环境变量别乱设**：`GTK_IM_MODULE=fcitx` 在 Wayland 原生应用里反而可能干扰，优先用 `waylandFrontend = true`。

### 10.4 字体、光标、缩放

```nix
fonts.packages = with pkgs; [
  noto-fonts
  noto-fonts-cjk-sans
  noto-fonts-cjk-serif
  noto-fonts-emoji
  source-han-sans
  (nerd-fonts.jetbrains-mono)
];

fonts.fontconfig.defaultFonts = {
  sansSerif = [ "Noto Sans CJK SC" ];
  serif = [ "Noto Serif CJK SC" ];
  monospace = [ "JetBrainsMono Nerd Font" ];
};

home.pointerCursor = {
  package = pkgs.bibata-cursors;
  name = "Bibata-Modern-Ice";
  size = 24;
};
```

**旧写法对照**：`fonts.fonts` → `fonts.packages`，`fonts.fontconfig.defaultFonts` 没变。

Wayland 缩放：

```nix
environment.sessionVariables = {
  GDK_SCALE = "1";
  QT_SCALE_FACTOR = "1";
};
```

分数缩放（1.25、1.5）在各家合成器上表现不一，wlroots 系建议先用整数缩放，或者用 `wlr-randr` 调输出分辨率。

### 10.5 Wayland 常见问题

| 现象 | 原因 | 解法 |
| --- | --- | --- |
| Electron 应用模糊/黑屏 | 走了 XWayland | `NIXOS_OZONE_WL=1`，或加 `--ozone-platform=wayland` |
| 输入法不弹候选框 | 用了 X11 的 IM 模块 | `waylandFrontend = true`，检查 `fcitx5-diagnose` |
| 截图工具抓不到窗口 | 缺 xdg-desktop-portal | `xdg.portal.enable = true` + 对应后端 |
| 屏幕共享黑屏 | 同上 | 装 `xdg-desktop-portal-wlr`（wlroots） |
| 光标太大/太小 | 只设了 GTK | `home.pointerCursor` + `XCURSOR_THEME`/`XCURSOR_SIZE` |
| 应用启动慢 | 字体缓存没建 | `fc-cache -fv`，或 rebuild 后重启 |

## 十一、网络：缓存、镜像、代理

### 11.1 二进制缓存是怎么回事

Nix 的包默认从 `cache.nixos.org` 下载**已经构建好的产物**，不用本地编译。你写 `pkgs.firefox`，它去缓存里找对应 hash 的路径，有就下，没有才编译。

所以「NixOS 装包慢」通常不是 Nix 慢，是**你要的包在官方缓存里没有**（比如刚更新的包、自己改过编译参数的包、非 x86_64 的平台）。

看某个包会不会走缓存：

```bash
nix path-info --store https://cache.nixos.org nixpkgs#firefox
```

### 11.2 Cachix：给第三方 flake 加速

```nix
nix.settings = {
  substituters = [
    "https://cache.nixos.org"
    "https://umbriel.cachix.org"
    # 其他缓存（nix-community 等）从项目页复制完整地址
  ];
  trusted-public-keys = [
    "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
    "umbriel.cachix.org-1:JfNq/2yg2S6D6z4Z2dVSZrZlDPQTKtexB6GAVLD98nw="
  ];
};
```

`trusted-public-keys` 必须和 `substituters` 配套，否则 Nix 会拒绝从不受信任的缓存下载（安全机制：防止别人替换 store 路径内容）。公钥不要凭记忆写，去 Cachix 项目页复制——写错一个字符就会一直 fallback 到本地编译。

### 11.3 国内镜像

网络不好的话可以加镜像：

```nix
nix.settings.substituters = [
  "https://mirrors.ustc.edu.cn/nix-channels/store"
  "https://cache.nixos.org"
];
```

注意镜像的**同步延迟**和**覆盖范围**。很多镜像只同步 channel 的稳定包，unstable 的新包不一定有。加了镜像反而可能因为「镜像说没有、官方说有」而多等一轮。

我的建议：先用官方缓存 + 代理；镜像作为备用，不要一上来就换。

### 11.4 代理：nix-daemon 是独立进程

这是新手最常踩的坑：**你在 shell 里设了 `https_proxy`，但 `nixos-rebuild` 还是超时。**

因为构建是 `nix-daemon`（root 的 systemd 服务）做的，它不继承你的 shell 环境。要单独给它设：

```nix
systemd.services.nix-daemon.environment = {
  https_proxy = "http://127.0.0.1:7890";
  http_proxy = "http://127.0.0.1:7890";
  all_proxy = "socks5://127.0.0.1:7891";
  no_proxy = "localhost,127.0.0.1,192.168.0.0/16";
};
```

改完 `switch` 后 `systemctl daemon-reload` 或重启 nix-daemon。

另外 `nix` 命令自己（非 daemon）也会联网，用户级可以设：

```nix
home.sessionVariables = {
  https_proxy = "http://127.0.0.1:7890";
  http_proxy = "http://127.0.0.1:7890";
};
```

验证代理是否生效，别用 `ping`（ICMP 不走代理）：

```bash
curl -q -4 --noproxy '*' -o /dev/null -w "%{http_code}\n" https://cache.nixos.org
```

### 11.5 自建缓存（进阶）

机器多了以后，每次构建都重复下载很浪费。方案：

- **Cachix**：托管服务，免费额度够个人用。`cachix push` 上传，别人 `substituters` 加你的缓存。
- **attic**：自建，支持 S3/本地存储，比 nix-serve 现代。
- **nix-serve**：最轻量，`nix-serve -p 5000` 就能把本机 store 变成 HTTP 缓存。

家庭内网里，一台常开的机器做 attic，其他机器指过去，升级会快很多。

## 十二、排障手册（救命篇）

### 12.1 构建失败怎么读

Nix 的报错通常很长，但**真正的错误在最后 20 行**。前面是构建日志。

```text
error: builder for '/nix/store/xxx.drv' failed with exit code 1;
       last 10 log lines:
       > make: *** [Makefile:42: all] Error 1
```

先看 `last N log lines`，再看完整日志：

```bash
nix log /nix/store/xxx.drv
```

求值错误（不是构建错误）会带 `--show-trace` 看调用栈：

```bash
nixos-rebuild build --flake .#laptop --show-trace
```

### 12.2 常见错误对照表

| 报错 | 原因 | 解法 |
| --- | --- | --- |
| `attribute 'xxx' missing` | 包名/option 名写错 | search.nixos.org 查准确名字 |
| `The option 'xxx' does not exist` | 版本改名 | 查当前版本 manual，常见：`hardware.opengl`→`hardware.graphics`、`fonts.fonts`→`fonts.packages` |
| `infinite recursion encountered` | 配置引用了自己 | 用 `mkDefault`/`mkForce`，或把值拆到 `let` 里 |
| `hash mismatch in fixed-output derivation` | 源码 hash 变了 | 把报错里的 `got:` 填回 `hash` |
| `collision between '/nix/store/a' and '/nix/store/b'` | 两个包提供同名文件 | `lib.hiPrio` 指定优先，或 `buildEnv.ignoreCollisions` |
| `Package 'xxx' has an unfree license` | 闭源软件 | `nixpkgs.config.allowUnfree = true;` |
| `experimental Nix feature 'nix-command' is disabled` | 没开 flakes | `nix.settings.experimental-features = [ "nix-command" "flakes" ];` |
| `path '...' does not exist` | 新文件没 `git add` | `git add` 后重试 |
| `warning: Git tree is dirty` | 有未提交改动 | 不影响构建，但建议提交后再 rebuild |
| `No space left on device` | `/boot` 或 store 满 | 删旧代 + `nix-collect-garbage -d` |
| `SSL certificate problem` / timeout | 代理/时间不对 | 给 nix-daemon 设代理，检查系统时间 |
| `error: cannot evaluate a function that has an argument without a value` | 模块参数没传 | 检查 `specialArgs` / `extraSpecialArgs` |
| `error: value is a set while a string was expected` | 类型错 | 看 option 的 `type`，比如 port 要整数不是字符串 |
| `error: undefined variable 'pkgs'` | 函数参数没写 | 模块开头 `{ pkgs, ... }:` |

### 12.3 系统起不来怎么办

**第一招：systemd-boot 菜单选上一代。** 开机按方向键，选 `NixOS - Generation N-1`。

**第二招：live U 盘 + nixos-enter。**

```bash
# 挂载原系统
mount /dev/nvme0n1p2 /mnt
mount -o subvol=@nix /dev/nvme0n1p2 /mnt/nix
mount -o subvol=@home /dev/nvme0n1p2 /mnt/home
mount /dev/nvme0n1p1 /mnt/boot

# 进入原系统
nixos-enter --root /mnt

# 在里面回滚或修配置
nixos-rebuild switch --rollback
```

**第三招：从菜单进 rescue shell。** systemd-boot 里选带 `(rescue)` 的条目，或者在内核参数后加 `systemd.unit=rescue.target`。

**第四招：`nixos-rebuild boot` 后重启。** 如果 `switch` 把当前会话搞坏了但系统还能启动，`boot` 只改下次启动的默认代，不会立即生效。

### 12.4 store 和 boot 满了

```bash
# 看谁大
du -sh /nix/store
nix path-info -Sh /run/current-system | sort -k2 -h | tail -20

# 删旧代（先看列表）
nixos-rebuild list-generations
sudo nix-collect-garbage --delete-older-than 7d

# 极端情况：删掉所有旧代
sudo nix-collect-garbage -d
```

`/boot` 单独小分区的话，内核+initrd 一份约 100–150MB，6 代就接近 1G。`configurationLimit = 4~6` 比较合适。

### 12.5 无限递归与选项冲突

无限递归的典型写法：

```nix
# 错：config.foo 引用自己
config.services.foo.port = config.services.foo.port;
```

或者两个模块互相 `mkForce`：

```nix
# A 模块
services.foo.port = lib.mkForce 80;
# B 模块
services.foo.port = lib.mkForce 443;
```

NixOS 会报 `The option 'services.foo.port' has conflicting definition values`。解法：只在一处设值，另一处用 `mkDefault`，或者用 `lib.mkMerge` 按条件合并。

### 12.6 怎么问人

贴这几样，别人才能帮你：

1. 完整报错（最后 30 行 + `--show-trace` 的关键栈）。
2. 你的配置片段（脱敏）。
3. `nixos-version`、`nix --version`。
4. 你改了什么（最好是一个 commit diff）。
5. 已经试过什么。

别只贴一句 `nixos-rebuild 报错了`。NixOS 社区很愿意帮忙，但没人会猜。

## 十三、大神篇

### 13.1 读懂闭包

```bash
# 当前系统的闭包大小
nix path-info -Sh /run/current-system

# 某个包为什么被装进来
nix why-depends /run/current-system /nix/store/xxx-firefox-142.0

# 两次构建之间变了什么
nix store diff-closures ./result-old ./result-new
```

`diff-closures` 是升级神器。`nix flake update` 之后：

```bash
nixos-rebuild build --flake .#laptop
nix store diff-closures /run/current-system ./result
```

它会列出「哪些包升级了、闭包大了多少」，比看几千行日志直观得多。

`nix-tree` 可以交互式浏览依赖树：

```bash
nix run nixpkgs#nix-tree -- /run/current-system
```

### 13.2 远程部署

NixOS 的部署模型天然适合远程：

```bash
# 本地构建，推到远程激活
nixos-rebuild switch \
  --flake .#server \
  --target-host root@192.168.1.10 \
  --build-host localhost
```

`--build-host localhost` 表示在本机构建（利用本机缓存），只把闭包传过去。目标机需要开 SSH；如果登录的是普通用户而不是 root，加上 `--use-remote-sudo`。

第一次装远程机器用 `nixos-anywhere`：

```bash
nix run github:nix-community/nixos-anywhere -- \
  --flake .#server \
  root@192.168.1.10
```

它会自动分区、格式化、安装、配置 SSH。适合 VPS 和家里的小主机。

多机管理可以上 `colmena` 或 `deploy-rs`：

```bash
colmena apply --on @servers
```

### 13.3 CI：让服务器替你构建

GitHub Actions 里跑：

```yaml
- uses: cachix/install-nix-action@v31
- uses: cachix/cachix-action@v16
  with:
    name: 你的缓存名
    authToken: '${{ secrets.CACHIX_AUTH_TOKEN }}'
- run: nix flake check
- run: nix build .#nixosConfigurations.laptop.config.system.build.toplevel
```

这样每次 push 都会构建一遍，产物推进 Cachix。本地 `switch` 时直接下载，不用编译。配置坏了也能在 CI 里提前发现。

### 13.4 impermanence：无状态系统

思路：根文件系统每次启动都重置，只有 `/persist` 保留。

```nix
# 需要 nix-community/impermanence
environment.persistence."/persist" = {
  hideMounts = true;
  directories = [
    "/var/log"
    "/var/lib/nixos"
    "/etc/ssh"
  ];
  files = [
    "/etc/machine-id"
  ];
  users.me = {
    directories = [
      "Documents"
      ".ssh"
      ".config"
    ];
  };
};
```

配合 btrfs 快照，可以实现「重启即干净，数据不丢」。代价是配置要写得很细，漏一个目录就丢数据。新手别一上来就玩这个。

### 13.5 写自己的模块并发布

把你的模块抽出来，加一个 `flake.nix`：

```nix
{
  description = "my nixos modules";

  outputs = { self }: {
    nixosModules.default = import ./module.nix;
    nixosModules.hello = import ./hello.nix;
  };
}
```

别人用：

```nix
inputs.my-modules.url = "github:you/my-modules";
imports = [ inputs.my-modules.nixosModules.default ];
```

这就是 NixOS 生态的扩展方式。你写的每个模块都可以这样复用。

### 13.6 求值调试

```bash
# 看某个 option 的值
nix eval .#nixosConfigurations.laptop.config.networking.hostName

# 看类型
nix eval --raw .#nixosConfigurations.laptop.config.networking.hostName

# 进 REPL 探索
nix repl
:lf .
nixosConfigurations.laptop.config.services.openssh.enable

# 看某个包的元信息
nix eval --json nixpkgs#hello.meta --apply 'm: { inherit (m) description license; }'
```

`nix repl` 里 `:t` 看类型、`:p` 打印、`builtins.attrNames` 列属性，是理解 flake 结构最快的方式。

### 13.7 版本策略

- **stable（26.05 / 26.11）**：适合日常主力机，包旧一点，但稳定。
- **unstable**：滚动更新，包新，偶尔坏。我主力机跑 unstable，但会**每月只更新一次**，且更新前 commit。
- **混合**：系统 stable，个别包从 unstable 取：

```nix
let
  unstable = import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/nixos-unstable.tar.gz") {};
in {
  environment.systemPackages = [ unstable.neovim ];
}
```

更好的写法是把 unstable 作为 flake input，避免 `fetchTarball` 每次求值都联网。

## 十四、学习路线图

### 14.1 第一周：能用

- 装好系统，能联网、能打中文、能装软件。
- 记住 `nixos-rebuild switch`、`--rollback`、`nix search`。
- 把配置放进 git，每天 commit。
- 目标：**不再手改 `/etc`**。

### 14.2 第一个月：顺手

- 接上 Home Manager，dotfiles 全部声明化。
- 学会 `nix shell`、`nix run`、`nix develop`。
- 给常用项目写 devShell。
- 学会看 option 文档，能自己解决 80% 的报错。
- 目标：**换台机器，半小时恢复环境**。

### 14.3 半年：能改

- 用 flake 组织多主机。
- 会写 overlay、`writeShellApplication`、简单的 `mkDerivation`。
- 会读闭包、用 `diff-closures` 做升级评估。
- 能给自己的服务写 systemd module。
- 目标：**不再怕升级，因为随时能回滚**。

### 14.4 一年：能造

- 写并发布自己的 NixOS module / flake。
- 搭 CI + 自建缓存。
- 远程部署、`nixos-anywhere`、多机管理。
- 能给别人 review 配置。
- 目标：**你的配置仓库本身就是一个可复用的产品**。

### 14.5 资源清单

- 官方手册：<https://nixos.org/manual/nixos/stable/>
- 包搜索：<https://search.nixos.org/packages>
- 选项搜索：<https://search.nixos.org/options>
- Nix 语言教程：<https://nix.dev/tutorials/nix-language>
- NixOS & Flakes 中文书：<https://nixos-and-flakes.thiscute.world/zh/>
- Nix Pills（深入原理）：<https://nixos.org/guides/nix-pills/>
- 官方 Discourse：<https://discourse.nixos.org/>
- 中文社区：NixOS 中文论坛 / Telegram 群

## 十五、十条血泪教训

1. **新文件先 `git add`。** 否则 flake 看不见，报 `path does not exist`。
2. **`system.stateVersion` 装完就别改。** 它不是「系统版本」，是兼容性锚点。
3. **别手改 `/etc`。** 改了也会被下次 rebuild 覆盖，而且换机就丢。
4. **`nix-collect-garbage -d` 之前先确认能回滚。** 删完旧代就回不去了。
5. **`/boot` 给大一点，或者开 `configurationLimit`。** 内核塞满分区时 rebuild 会失败。
6. **代理要单独给 nix-daemon 设。** shell 里的 `https_proxy` 它看不见。
7. **升级前先 `nixos-rebuild build`。** 不要直接 `switch`，尤其是 `nix flake update` 之后。
8. **别同时用 `nix profile` 和 `home.packages` 装同一个软件。** PATH 会打架。
9. **闭源软件要 `allowUnfree`，但别全局无脑开。** 可以用 `allowUnfreePredicate` 精确放行。
10. **配置仓库是你的第二块硬盘。** 提交、推送、备份，一样都不能少。

## 结语

写到这里，信已经很长了。

NixOS 最难的地方，其实不是语法，也不是 flakes，而是**心态的转换**：从「我现在要改这台机器」变成「我要描述这台机器应该是什么样」。

刚开始你会觉得绕：为什么装个软件要改文件、要 rebuild、要等构建？但当你第一次在系统起不来的时候，从容地在启动菜单选上一代；第一次换电脑，`git clone` + 一条命令就恢复全部环境；第一次给项目配上 `nix develop`，队友不再问「你那边能跑吗」——你会明白这套设计在换什么。

它用「前期的麻烦」换「后期的确定性」。

如果你刚开始，别想着一次把配置写完美。先用起来，遇到问题再改。配置仓库会跟着你一起长，半年后回头看，第一版一定很丑——这很正常，我的也是。

有写错的地方，欢迎来信。

