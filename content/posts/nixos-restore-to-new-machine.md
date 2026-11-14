---
title: "换一台电脑，把 NixOS 恢复成现在这样"
date: 2026-11-14T19:25:00+08:00
draft: false
slug: "nixos-restore"
tags: ["NixOS","备份","恢复","换机","教程"]
categories: []
salutation: "见字如面，"
description: "电脑丢了、换了、盘坏了，但 GitHub 和家里路由器上的 OpenList 还在。这篇写怎么用现有备份，在一台新机器上把 NixOS、桌面、输入法、登录态和开发环境恢复到和原来一样。"
postscript: "文中的地址、token、口令一律用占位符代替。真实值只存在三处：本机明文（gitignore）、加密包、路由器 OpenList 的 recovery 目录。"
---

## 写在前面

上一篇《NixOS 使用指南》讲的是「怎么用」。这一篇讲一个更现实的问题：

**电脑没了，怎么在一天之内回到现在这样？**

这里的「没了」包括：笔记本丢了、进水了、硬盘挂了、想换新机器、或者单纯想把系统重装一遍。只要下面两样还在，就能恢复：

1. **GitHub 上的私有仓库**（配置、脚本、笔记）。
2. **家里路由器上的 OpenList**（凭据明文副本 + 登录态加密备份）。

如果这两样也没了，那就只能走下一篇《从零搭到我现在这样》，从头再来一遍。

先说清楚边界，免得你期待过高：

| 能恢复 | 怎么恢复 |
| --- | --- |
| 整个系统（内核、驱动、桌面、服务） | `nixos-install --flake`，一条命令 |
| 所有声明式配置（含桌面外观、快捷键） | git clone `nixos-config` |
| GitHub / Cloudflare / 路由器凭据 | OpenList `recovery/` 或加密包 |
| SSH key、git token、AI CLI key | 登录态备份或加密包 |
| Firefox / Thunderbird 登录态、Telegram 登录 | `userdata-backup.sh restore` |
| 工作区所有独立仓库 | `sync-repos.sh` |
| 博客、图床、路由器配置 | 各自仓库 / OpenList |

| 恢复不了 | 原因 |
| --- | --- |
| QQ 聊天记录（1.5G） | 太大，没进备份；只能手机扫码重新登录 |
| Thunderbird 邮件本体 | 邮件在 IMAP 服务器上，重新同步即可 |
| Firefox 书签 / 历史 | 靠 Firefox 账号同步，不在备份里 |
| 浏览器里没同步的密码 | 只在登录态备份里有一部分，别赌 |
| `/home` 下的临时文件、下载 | 没有全盘备份 |

所以真正的「恢复」不是「把所有字节搬回来」，而是「把**身份**和**环境**搬回来」。身份是凭据和登录态，环境是 NixOS 配置。

## 一、先盘点：你手里到底有什么

恢复之前，先别急着装系统。花十分钟把资产列清楚，后面会顺很多。

### 1.1 GitHub 上的仓库

我的工作区分两类：

**配置与笔记（私有）**

| 仓库 | 内容 |
| --- | --- |
| `cyjx007/nixos-config` | 整个系统配置（flake、模块、home-manager、硬件清单、文档） |
| `cyjx007/code` | 工作区：脚本、`.dsh/`、加密包、各项目的说明 |
| `cyjx007/blog` | 博客（Hugo + 主题 + 写稿台） |
| `cyjx007/hugo-theme-epistle` | 博客主题 |

**独立项目（clone 回来即可）**

`honk`、`navigator`、`horizon-digest`、`android-ad-cleaner`、`workbuddy2api-hub`、`mu300-linux`、`mu300-vpn-split-routing`、`legado` 等等。

`code` 仓库里的 `sync-repos.sh` 维护了完整清单：

```bash
# 只打印要执行的命令，不真的 clone
./sync-repos.sh -n

# 真的 clone 到 ~/code
./sync-repos.sh
```

**关键点**：`sync-repos.sh` 只 clone「内容不在 code 仓库里」的独立仓库。`nixos-config` 和 `code` 本身要先手动 clone，因为脚本自己就在 `code` 里。

### 1.2 OpenList 上的东西

家里的路由器上跑着 OpenList，路径大致是这样：

```text
/cloud/code/
├── recovery/                  # 明文凭据（仅局域网，用完要删）
│   ├── credentials/
│   │   ├── github-token.txt   # GitHub PAT
│   │   ├── secrets-passphrase.txt
│   │   └── router.json        # 路由器 SSH
│   ├── wifi/                  # 家里 Wi-Fi 的 SSID/PSK
│   ├── hardware/              # 本机硬件清单 + WMI 原始输出
│   └── README.md
├── userdata-backup/           # 登录态加密备份，保留最近 5 份
│   └── userdata-<host>-<时间>.tar.gz.enc
├── firmware/                  # 固件 zip
└── router-backups/            # 路由器整机备份
```

访问方式：手机或另一台电脑连家里 Wi-Fi，浏览器打开

```text
http://<路由器内网地址>:5244/cloud/code/recovery/
```

需要登录（和平时看固件用同一个账号）。**这是抹盘之后还能拿到 token 的唯一途径**，所以它必须放在「不依赖这台电脑」的地方。

### 1.3 加密包里的东西

`code` 仓库根目录有一个 `secrets-20261113.tar.gz.enc`（日期会变），AES-256-CBC / pbkdf2 200k。里面是：

```text
.dsh/github/token
.dsh/cloudflare/token
.dsh/openwrt/router.json
.dsh/tg-bot/env.group
.dsh/openwrt/plugins-bundle-*/
.dsh/openwrt/openlist-backup-*/
.dsh/openwrt/wb-docker/
yaml/                          # 代理/分流配置
telegrambot/.env
workbuddy2api-hub/accounts/
.dsh/ai-cli/
.dsh/tsukimi/
backups/recovery-20261113/wifi/
backups/recovery-20261113/hardware/
```

它和 OpenList 上的 `recovery/` 是**互补**关系：

- `recovery/` 是明文，方便「刚抹完盘、什么都还没有」时取。
- 加密包在 git 里，方便「有仓库但没路由器」时取。

两个都要有，但都不要长期留着明文。

### 1.4 恢复优先级

时间有限时，按这个顺序：

| 优先级 | 东西 | 没有会怎样 |
| --- | --- | --- |
| P0 | GitHub token | 私有仓库一个都 clone 不了，直接卡死 |
| P0 | 加密包口令 | 凭据包解不开 |
| P1 | `nixos-config` | 系统能装，但要手写几千行配置 |
| P1 | 硬件信息 | 装完可能没网、黑屏、输入法不对 |
| P2 | 登录态备份 | 所有 App 重新登录一遍，能用但很烦 |
| P3 | 独立项目仓库 | 用到哪个 clone 哪个 |
| P4 | 博客/图床 | 最后再说 |

**P0 的两样东西，请确保它们在手机密码管理器里各有一份。** 只放在路由器上，路由器坏了就一起完蛋。

## 二、准备阶段（装系统之前）

### 2.1 先拿到 token

用手机连家里 Wi-Fi，打开 OpenList，进 `recovery/credentials/`，把 `github-token.txt` 的内容复制出来。如果 OpenList 打不开，就从密码管理器里找，或者从另一台还能用的设备上的 `.dsh/github/token` 取。

拿到之后先别急着贴到命令行里（会进 shell 历史）。用环境变量：

```bash
read -rsp 'GitHub token: ' GH_TOKEN; echo
export GH_TOKEN
```

`read -s` 不回显，比直接敲安全一点。用完 `unset GH_TOKEN`。

### 2.2 记下新电脑的硬件

这一步在新电脑上做，**装系统之前**。如果是 Windows 预装机器：

```powershell
Get-CimInstance Win32_ComputerSystem | Select Manufacturer, Model
Get-CimInstance Win32_Processor | Select Name, NumberOfCores
Get-CimInstance Win32_VideoController | Select Name
Get-CimInstance Win32_PnPEntity |
  Where-Object { $_.Name -match 'Wireless|Wi-Fi|Bluetooth|Audio|Fingerprint|Camera' } |
  Select Name, DeviceID
Get-PhysicalDisk | Select FriendlyName, MediaType, Size
```

如果是空机器，进 live 环境再查也行：

```bash
lspci -nn | grep -E 'VGA|3D|Network|Audio'
lsusb
lsblk -o NAME,SIZE,MODEL,TYPE
```

重点记四样：**无线网卡、显卡、磁盘、有没有指纹**。这四样决定配置里哪几行要改。

### 2.3 做启动 U 盘

```bash
# Linux
sudo dd if=nixos-26.11-graphical.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

Windows 用 Rufus，选 **DD 模式**，不要 ISO 模式。

### 2.4 确认新机器能上网

装系统过程中要下载几百 MB 到几 GB。最好插网线；只有 Wi-Fi 的话，确认记得住密码（或者先从 OpenList 的 `wifi/` 里翻出来）。

## 三、装系统：复用现有 flake

这一节和「从零装」最大的区别是：**你不需要写配置，只需要把仓库放上去，改硬件相关的几行。**

### 3.1 分区

先进 root shell，后面从分区到安装都是 root 操作（也能避免 git 仓库属主不一致的 `dubious ownership` 报错）：

```bash
sudo -i
```

和原机器保持一致，这样 `hardware-configuration.nix` 的结构可以直接套：

```bash
# 确认盘符，写错就是别人的数据没了
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

新电脑磁盘更大也没关系，`@home` 会自动占满剩余空间。

### 3.2 把仓库 clone 到安装盘

```bash
nix-shell -p git

git clone "https://x-access-token:${GH_TOKEN}@github.com/cyjx007/nixos-config.git" \
  /mnt/etc/nixos/nixos-config

# 立刻把 token 从 remote URL 里去掉，别留在 .git/config
cd /mnt/etc/nixos/nixos-config
git remote set-url origin https://github.com/cyjx007/nixos-config.git
```

这一步只需要读权限。`flake.nix` 里的 inputs（nixpkgs、home-manager、umbriel、noctalia）都是公开仓库，不需要 token。

### 3.3 生成并替换硬件配置

```bash
nixos-generate-config --root /mnt
# 产出 /mnt/etc/nixos/hardware-configuration.nix

cp /mnt/etc/nixos/hardware-configuration.nix \
   /mnt/etc/nixos/nixos-config/hosts/laptop/hardware-configuration.nix

# 关键：flake 只认 git 跟踪的文件，新拷进去的必须 add
cd /mnt/etc/nixos/nixos-config
git add hosts/laptop/hardware-configuration.nix
```

**这是整个恢复过程中唯一必须改的文件。** 它包含磁盘 UUID、内核模块、CPU 微码。新电脑的盘和旧电脑不一样，所以必须重新生成，不能直接用仓库里那份。

生成后检查三处：

```bash
grep -A3 'fileSystems' /mnt/etc/nixos/nixos-config/hosts/laptop/hardware-configuration.nix
grep -E 'kernelModules|kernelParams|updateMicrocode' \
  /mnt/etc/nixos/nixos-config/hosts/laptop/hardware-configuration.nix
```

- `fileSystems` 的挂载点要和上面分区一致（`/`、`/boot`、`/home`、`/nix`）。
- 如果是 AMD CPU，确认 `hardware.cpu.amd.updateMicrocode`；Intel 是 `hardware.cpu.intel.updateMicrocode`。
- 无线网卡如果换了型号，内核模块可能不同，但通常自动检测得到。

### 3.4 改主机文件里跟硬件相关的几行

打开 `hosts/laptop/default.nix`，只改这几处：

```nix
networking.hostName = "laptop";        # 想改名就改，记得 flake 里也一致

# 显卡：先用核显，稳
services.xserver.videoDrivers = [ "modesetting" ];

# 无线/蓝牙固件：Realtek 这类网卡必须开
hardware.enableRedistributableFirmware = true;

# 指纹：新机器有指纹才开
# services.fprintd.enable = true;
```

如果新机器是 NVIDIA 双显卡，先**不要**打开文件末尾那段 `hardware.nvidia`，等系统起来、确认核显能进桌面之后再加。BusID 一定要用 `lspci` 重新查：

```bash
lspci | grep -E 'VGA|3D'
# 输出里的 01:00.0 就是 PCI:1:0:0
```

写错 BusID 的后果是黑屏，得进 live 环境改回来。

### 3.5 安装

```bash
nixos-install --flake /mnt/etc/nixos/nixos-config#laptop
```

它会问你 root 密码。装完：

```bash
reboot
# 拔 U 盘
```

### 3.6 首启

第一次登录用你原来的用户名（`tanghuang`）。密码如果忘了，进 live 环境 `nixos-enter` 重置，或者在安装时设一个临时的，进去再 `passwd`。

首启先做三件事：

```bash
# 1. 确认系统起来了
nixos-version
systemctl --failed

# 2. 确认能上网
nmcli device status
ping -c1 nixos.org

# 3. 确认配置能自举（这一步必须成功，否则后面都是空中楼阁）
cd ~/nixos-config 2>/dev/null || cd /etc/nixos/nixos-config
sudo nixos-rebuild switch --flake .#laptop
```

如果第 3 步成功，说明「环境」已经恢复了。接下来恢复「身份」。

## 四、恢复凭据与身份

### 4.1 解加密包

口令从 OpenList 的 `recovery/credentials/secrets-passphrase.txt` 拿，或者从密码管理器拿。

```bash
cd ~/code    # 还没 clone 的话见 4.5
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -in secrets-20261113.tar.gz.enc -out /tmp/secrets.tar.gz

# 包里顶层是 secrets/，用 --strip-components=1 直接还原到工作区根
tar -xzf /tmp/secrets.tar.gz --strip-components=1 -C ~/code
rm -f /tmp/secrets.tar.gz
```

包里的路径是相对工作区根的（`.dsh/github/token` 这种），不是相对家目录。不带 `--strip-components=1` 会解成 `~/code/secrets/.dsh/...`，脚本就找不到 token 了。

解完确认：

```bash
ls -l ~/code/.dsh/github/token ~/code/.dsh/openwrt/router.json
```

### 4.2 配好 git 凭据

`nixos-config` 的 `home/base.nix` 里已经声明了一个 credential helper，它会依次读：

```text
~/.config/git/github-token
~/code/.dsh/github/token
```

所以只要把 token 放到第一个位置，git 就能自动认证，remote URL 保持干净：

```bash
install -d -m700 ~/.config/git
printf '%s' "$GH_TOKEN" > ~/.config/git/github-token
chmod 600 ~/.config/git/github-token
```

验证：

```bash
git ls-remote https://github.com/cyjx007/nixos-config.git HEAD
```

不报 403 就说明通了。

**不要**把 token 写进 remote URL，也不要用 `git config credential.helper store`（它会把明文存到 `~/.git-credentials`，而且不受 Nix 管理）。

### 4.3 恢复 SSH key

如果加密包或登录态备份里有 `~/.ssh`，直接恢复。没有的话重新生成：

```bash
ssh-keygen -t ed25519 -C "laptop-$(date +%Y%m%d)"
cat ~/.ssh/id_ed25519.pub
```

然后把公钥贴到：

- GitHub → Settings → SSH and GPG keys
- Forgejo（如果家里有）→ Settings → SSH keys

`nixos-config` 里已经配了 `AddKeysToAgent yes`，带口令的 key 只需输一次。

### 4.4 恢复登录态

登录态备份在 OpenList 的 `userdata-backup/` 下，保留最近 5 份。恢复命令：

```bash
cd ~/code
./.dsh/tools/userdata-backup.sh restore
```

它会：

1. 从路由器取最新一份 `.tar.gz.enc`。
2. 用 `.dsh/SECRETS-PASSPHRASE.local.txt` 里的口令解密。
3. 列出要写回的内容，问你 `y/N`。
4. 写回 `$HOME`，并 `dconf load` 恢复 tsukimi 账号。

**恢复前先退出** Firefox、Thunderbird、Telegram、tsukimi，否则数据库文件可能被占用。

如果口令文件还没恢复，先手动解：

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -in userdata-xxx.tar.gz.enc -out data.tar.gz
tar -xzf data.tar.gz
# 看 MANIFEST.txt 确认内容，再 cp -a home/. ~/
```

这份备份里有什么：

| 内容 | 说明 |
| --- | --- |
| `~/.ssh` | 私钥 |
| `~/.gitconfig` | git 身份和配置 |
| `~/.config/git/github-token` | PAT |
| `~/.config/ai-cli` | AI CLI 的 key |
| `~/.config/opencode` | opencode 配置 |
| `~/.config/rime-webdav` | 词库同步配置 |
| `~/.config/keepassxc` + `密码.kdbx` | 密码库 |
| `~/.local/share/kwalletd` | KDE 钱包 |
| Firefox | cookies / 密码 / 证书 / prefs |
| Thunderbird | 账号 / 密码 / 地址簿 / 日历 |
| Telegram | `key_datas` + 各账号 `*s`（只登录态，不含缓存） |
| tsukimi | dconf 里的服务器和账号 |

Telegram 恢复后如果旧机器还在用，会互相顶下线，去「设置 → 设备」把旧会话踢掉。

### 4.5 clone 其余仓库

```bash
cd ~/code
./sync-repos.sh
```

它会把 `blog`、`hugo-theme-epistle`、`honk`、`navigator` 等十几个仓库 clone 回来。已经存在的目录会跳过。

如果 `code` 本身还没 clone：

```bash
git clone "https://x-access-token:${GH_TOKEN}@github.com/cyjx007/code.git" ~/code
cd ~/code
git remote set-url origin https://github.com/cyjx007/code.git
```

## 五、逐项验收：确认「和原来一样」

装完不等于恢复完。下面这份清单，建议一条条跑。

### 5.1 系统层

```bash
nixos-version
uname -r
systemctl --failed
nixos-rebuild list-generations | head

# 配置仓库状态
cd ~/nixos-config && git status --short && git log --oneline -3

# store 占用
du -sh /nix/store
```

预期：没有 failed unit，`git status` 干净，`/nix/store` 在 10–20G 量级。

### 5.2 桌面层

```bash
echo $XDG_SESSION_TYPE          # wayland
echo $XDG_CURRENT_DESKTOP
pgrep -a umbriel
pgrep -a noctalia

# 截图 / 录屏（如果配了 portal）
grep -r . /etc/xdg/xdg-desktop-portal 2>/dev/null | head
```

预期：能进图形会话，面板、Dock、通知都在，快捷键和原来一致。

### 5.3 输入法

```bash
fcitx5-diagnose | head -40
fcitx5-remote                   # 2 = 已激活
```

然后实际打一段中文，确认：

- 候选框能弹出（不是白框）。
- 候选词顺序正常（词库恢复了）。
- 在 Firefox、终端、Electron 应用里都能输入。

第一次切到 rime 会编译词库，等 30–60 秒，别以为卡死了。

### 5.4 开发与工作区

```bash
cd ~/code
ls
./.dsh/github/gh.mjs GET /user | head -5

cd ~/nixos-config
nix flake check                 # 可能要几分钟
nixos-rebuild build --flake .#laptop
```

预期：`gh.mjs` 能返回你的账号信息，`nix flake check` 不求值报错。

### 5.5 备份链路

这一步最容易被忽略：**新机器要能继续备份，而不是只会恢复。**

```bash
cd ~/code

# 演练：只打包，不上传
./.dsh/tools/userdata-backup.sh -n

# 演练：凭据包
./.dsh/tools/secrets-pack.sh -n

# 确认 git push 的 pre-push 钩子还在
git config --get core.hooksPath
ls -l .dsh/githooks/pre-push
```

如果 `core.hooksPath` 是空的，说明新 clone 没带本地 git 配置。补上：

```bash
git config core.hooksPath .dsh/githooks
```

### 5.6 对照表

| 项 | 恢复方式 | 验收命令 |
| --- | --- | --- |
| 系统 | `nixos-install --flake` | `nixos-version` |
| 桌面 | flake 里的 `modules/desktop` | `pgrep umbriel` |
| 输入法 | flake 里的 `ime.nix` + 词库 | `fcitx5-diagnose` |
| 凭据 | 加密包 / OpenList | `git ls-remote` |
| SSH | 登录态备份 | `ssh -T git@github.com` |
| 浏览器登录态 | `userdata-backup.sh restore` | 打开网页看是否已登录 |
| Telegram | 同上 | 看是否直接进账号 |
| 工作区 | `sync-repos.sh` | `ls ~/code` |
| 博客 | `sync-repos.sh` + CF 自动部署 | push 一篇试试 |

## 六、新电脑硬件不一样怎么办

「换一台电脑」最麻烦的不是软件，是硬件。这一节按部件说。

### 6.1 无线网卡

Realtek RTL8821CE、RTL8852 这类网卡需要额外固件：

```nix
hardware.enableRedistributableFirmware = true;
```

Intel AX200/AX210 一般开箱可用。装完没网先看：

```bash
lspci -nn | grep -i network
dmesg | grep -i -E 'firmware|rtw|iwlwifi'
ip link
```

如果固件缺失，`dmesg` 会明确告诉你缺哪个 `.bin`。把型号记下来，加到 `HARDWARE.md`。

### 6.2 显卡

**Intel / AMD 核显**：

```nix
hardware.graphics.enable = true;
services.xserver.videoDrivers = [ "modesetting" ];
```

**NVIDIA 独显（Optimus）**：

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

三条铁律：

1. **先用核显把系统跑起来**，再动 NVIDIA。
2. BusID 必须 `lspci` 现场查，不能抄旧机器的。
3. 改完先 `nixos-rebuild build`，再 `switch`，并且保留一个能进 TTY 的后路。

**AMD 独显**：通常 `amdgpu` 开箱可用，`hardware.graphics.enable = true` 即可，不需要 PRIME。

### 6.3 指纹、摄像头、声卡

```nix
# 有指纹才开
services.fprintd.enable = true;

# 摄像头一般 uvcvideo 开箱可用，不用配
# 声卡一般 snd_hda_intel 开箱可用
```

指纹模块需要 `fprintd-enroll` 录指纹，而且不是所有型号都支持。装完先：

```bash
lsusb | grep -i fingerprint
fprintd-list $USER
```

没有设备就别开，开了也只是多一个失败的服务。

### 6.4 HiDPI 与多屏

新机器如果是 2K/4K 屏，先别急着开分数缩放。wlroots 系合成器对分数缩放的支持取决于版本，稳妥做法：

```bash
wlr-randr                                  # 看输出和可用分辨率
```

在 Umbriel 配置里改输出分辨率和缩放，或者临时：

```bash
wlr-randr --output eDP-1 --mode 2560x1600 --scale 1.5
```

字体发虚通常是缩放和字体 hinting 的组合问题，不是 NixOS 的锅。

### 6.5 磁盘布局不同

如果新机器是双盘（比如 NVMe + SATA），`hardware-configuration.nix` 会生成多个 `fileSystems` 条目。你只需要确认：

- `/` 指向正确的分区。
- `/boot` 指向 EFI 分区（`vfat`，有 `boot.loader.efi.canTouchEfiVariables`）。
- 如果有第二块盘想挂到 `/data`，加一条 `fileSystems."/data"`，然后 `mkdir /data` 再 rebuild。

不要手动 `mount` 完就以为完事——**没写进配置的挂载，重启就没了**。

## 七、排障：恢复时最常见的 12 个问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `git clone` 报 403 | token 没传对 / 过期 | 重新从 OpenList 取；确认 `x-access-token:` 前缀 |
| `nixos-install` 找不到 flake | 路径或主机名错 | `--flake /mnt/etc/nixos/nixos-config#laptop`，`#` 后面必须存在 |
| 装完没网 | 缺固件 | `hardware.enableRedistributableFirmware = true`，看 `dmesg` |
| 装完黑屏 | 显卡驱动/BusID 错 | 启动菜单加 `nomodeset` 进 TTY，改回核显 |
| 输入法不出候选 | profile 被覆盖 / 词库没编译 | 看 `~/.config/fcitx5/profile`，等首次编译 |
| 中文变方块 | 字体没生效 | `fc-match "Noto Sans CJK SC"`，检查 `fonts.packages` |
| `nixos-rebuild` 报 hash mismatch | 缓存/源码变了 | 按报错更新 hash，或 `nix flake update` |
| 磁盘满 | store 或 `/boot` 满 | 删旧代 + `nix-collect-garbage -d` |
| 登录态恢复后 App 打不开 | 文件属主/权限错 | `chown -R $USER: ~/.config/xxx` |
| Telegram 提示会话失效 | auth key 被旧设备顶掉 | 手机确认登录，或重新扫码 |
| `gh.mjs` 401 | token 权限不足 | 重新生成 PAT，勾选 repo |
| 部署博客后 404 | CF 还在构建 / 构建失败 | 等 1 分钟；看 CF Pages 的部署日志 |

几个值得展开的：

**「装完黑屏」** 是最吓人的，但通常最好解决。开机在 systemd-boot 菜单按 `e`，在 `linux` 那行末尾加 `nomodeset`，按 `F10` 启动，进 TTY 后把显卡配置改回核显，rebuild，重启。

**「登录态恢复了但 App 打不开」** 多半是权限。`cp -a` 一般保留属主，但如果用 root 解包再拷，文件会变成 root 所有。统一修：

```bash
sudo chown -R "$USER:$USER" ~/.config ~/.local ~/.ssh
chmod 700 ~/.ssh
chmod 600 ~/.ssh/id_*
```

**「`nixos-rebuild` 很慢」** 先看是不是在本地编译。正常的包应该从缓存下载。如果大量 `building`，检查 `substituters` 和网络；如果是 umbriel/noctalia，确认 Cachix 公钥配了。

## 八、收尾：把「恢复」变成「可重复」

恢复完成不等于结束。做完下面五件事，下次换机会更轻松。

### 8.1 更新硬件清单

把新机器的型号、网卡、显卡、磁盘写进 `hosts/laptop/HARDWARE.md`，并提交。下次装系统前不用再猜。

### 8.2 重新打包 secrets

新机器上可能改了 token、加了 key。重新打一份：

```bash
cd ~/code
./.dsh/tools/secrets-pack.sh
# 生成 secrets-<今天>.tar.gz.enc
```

旧的加密包删掉，只保留最新一份。然后把新包同步到 OpenList 的 `recovery/`。

### 8.3 轮换 token

如果旧电脑丢了，假设 token 已经泄露。去 GitHub → Settings → Developer settings → Personal access tokens，**删掉旧的，建新的**。然后：

```bash
# 更新本机
printf '%s' "$NEW_TOKEN" > ~/.config/git/github-token
chmod 600 ~/.config/git/github-token
# 更新工作区
printf '%s' "$NEW_TOKEN" > ~/code/.dsh/github/token
chmod 600 ~/code/.dsh/github/token
```

同理，Cloudflare token、路由器密码、Wi-Fi 密码，能换的都换。

### 8.4 清理 OpenList 上的明文

`recovery/` 是「过渡期」用的，不是长期存储。新机器凭据都恢复好之后：

- 删掉 `recovery/credentials/`。
- 删掉旧的 `secrets-*.enc` 副本。
- 确认 OpenList 没有暴露到公网。

### 8.5 记录本次差异

新机器和旧机器一定不完全一样：网卡型号、屏幕分辨率、磁盘大小、BusID。把这些差异写进 `HARDWARE.md` 或一个 `docs/` 文件里，并在配置里加注释说明「这行是给哪台机器的」。

**配置仓库的价值，不在于它现在能跑，而在于半年后你还能看懂它为什么这么写。**

## 结语

换机恢复这件事，最反直觉的一点是：

**真正救你的不是备份文件，而是「声明式配置 + 可重复的恢复脚本」。**

如果系统是手装的，就算你有全盘备份，换台硬件不同的机器也要重来一遍。而 NixOS 把「系统」变成了「一份能重新求值的配置」，你只需要替换硬件那一小块，剩下的自动长回来。

所以平时值得投入的，不是「多备份几个 G」，而是：

- 把配置写进仓库，别手改 `/etc`。
- 把凭据放进加密包，别只留在脑子里。
- 把恢复步骤写成脚本，别只写在自己记得住的地方。
- 定期演练一次 `-n`（dry run），确认脚本还没坏。

真到那一天，你会庆幸自己做过这些。

此致
