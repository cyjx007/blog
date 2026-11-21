---
title: "给笔记本装上独显和 Steam：三处「配置写了但没生效」"
date: 2026-11-21T11:00:00+08:00
draft: false
slug: "gpu-steam"
tags: ["NixOS","NVIDIA","Steam","MangoHud","Wayland","游戏"]
categories: []
salutation: "见字如面，"
description: "从「nvidia.ko 根本没加载」到「F12 只截了张图」，这台 GTX 1650 Ti 笔记本折腾了一晚上。三处故障的共同点是：配置看起来都对，实际生效的是另一层东西。"
postscript: "驱动侧细节在 nixos-config/docs/gpu.md，游戏侧在 docs/steam.md；文中的命令都在 GTX 1650 Ti Mobile + UHD 630 上实测过。"
---

## 写在前面

这台笔记本是双显卡：Intel UHD 630 带内屏，NVIDIA GTX 1650 Ti Mobile 平时闲着。

目标有两个：

1. 平时用核显省电，需要时用独显渲染；
2. 能跑 Steam，Windows 游戏走 Proton。

装完之后回头看，真正卡住的都不是「大问题」，而是三个**分层**：

- 驱动层：`hardware.nvidia.enabled` 不是你以为的那个开关；
- 输入层：F12 先被合成器拿走了；
- 库加载层：btop 找不到 `libnvidia-ml.so.1`，所以干脆不显示 GPU。

## 一、驱动：写对三段，还差一次重启

### 26.11 的只读开关

按旧文档，开独显大概是：

```nix
hardware.nvidia = {
  enable = true;
  modesetting.enable = true;
  prime.offload.enable = true;
};
```

第一次 switch 完，`lsmod | grep nvidia` 什么都没有，`nouveau` 还在。

NixOS 26.11 起，`hardware.nvidia.enabled` 变成了**只读选项**，它的值等于「`services.xserver.videoDrivers` 里有没有 `"nvidia"`」。只写 `hardware.nvidia.prime` 不会加载任何东西。

所以真正要写的是：

```nix
services.xserver.videoDrivers = [ "modesetting" "nvidia" ];

hardware.nvidia = {
  modesetting.enable = true;
  prime.offload.enable = true;
  prime.offload.enableOffloadCmd = true;
  prime.nvidiaBusId = "PCI:1:0:0";
  prime.intelBusId = "PCI:0:2:0";
};
```

### 纯 Wayland 的第二个坑

这台机器 `services.xserver.enable = false`，只跑 Wayland。

nixpkgs 里把 `nvidia` / `nvidia_modeset` / `nvidia_drm` 加进 `systemd-modules-load` 的那段代码，外面套着 `lib.optionals config.services.xserver.enable`。没有 X server，这三个模块就不会被自动加载。

于是还要手写：

```nix
boot.kernelModules = [ "nvidia" "nvidia_modeset" "nvidia_drm" ];
```

改完不要急着 switch 完就用。`nouveau` 已经占着 GPU，热切换不了，**必须重启**。

重启后按顺序验证：

```bash
lsmod | grep nvidia          # nvidia / nvidia_modeset / nvidia_drm / nvidia_uvm
nvidia-smi                   # 能列出 GTX 1650 Ti，Idle
ls /dev/dri/by-path/         # 同时有 00:02.0（Intel）和 01:00.0（NVIDIA）
```

也可以用 Nix 侧自检，不用开机：

```bash
nix eval --json .#nixosConfigurations.laptop.config.hardware.nvidia.enabled
nix eval --json .#nixosConfigurations.laptop.config.boot.blacklistedKernelModules
find -L result/kernel-modules -name 'nvidia*.ko*'
```

### 为什么选 offload，不选 sync

三种 PRIME 模式：

| 模式 | 谁渲染 | 代价 |
| --- | --- | --- |
| `sync` | 全部交给独显 | 省电全没了，笔记本续航崩 |
| `reverseSync` | 独显渲染、核显输出 | 配置复杂，内屏接在 Intel 上时容易翻车 |
| `offload` | 核显负责显示，独显按需渲染单个程序 | 画面要拷回核显，损失一点带宽 |

内屏物理上接在 Intel，合成器又是 wlroots，`offload` 改动最小、回滚最容易，所以选它。

平时桌面仍然跑在核显上，只有 `nvidia-offload <命令>` 才把某个程序甩到独显。

## 二、怎么确认「现在到底谁在画」

这是最容易自欺欺人的一步。

`vulkaninfo --summary` 会把 i915、NVIDIA、llvmpipe 全部列出来，顺序还会随环境变量变。它只能回答「系统里有哪些卡能用」，回答不了「当前这个程序跑在哪块卡上」。

看 GL 的 vendor 才准：

```bash
glxinfo -B | grep -i "OpenGL vendor"
# Vendor: Intel (0x8086)

nvidia-offload glxinfo -B | grep -i "OpenGL vendor"
# Vendor: NVIDIA Corporation
```

`nvidia-offload` 是 `enableOffloadCmd` 生成的 wrapper，在 `/run/wrappers/bin/`，负责设置 `__NV_PRIME_RENDER_OFFLOAD=1` 和 `__GLX_VENDOR_LIBRARY_NAME=nvidia`。

### nvidia-smi 里几个容易被误读的字段

```
|   0  NVIDIA GeForce GTX 1650 Ti  Off | 00000000:01:00.0 Off |            N/A |
| N/A   35C    P8          4W /  50W  |      4MiB /  4096MiB   |  0%   Default |
```

| 字段 | 看起来像 | 实际含义 |
| --- | --- | --- |
| `Disp.A = Off` | 显卡没工作 | 正常，内屏接在 Intel 上 |
| `Fan = N/A` | 风扇坏了 | 笔记本风扇走 EC，不走显卡 |
| `P8` | 性能很低 | 空闲降频，一干活跳 P0 |
| `Memory-Usage = 4MiB` | 显存几乎没用 | 只算进程占用，不含驱动预留 |
| `Reserved = 381MiB` | 显存泄漏 | 驱动自己预留的，正常 |

`Processes` 里平时会挂一个 `umbriel` 占 1 MiB，那是合成器 probe `/dev/dri/card*` 留下的，不代表它在独显上渲染。还是看 `glxinfo` 的 vendor。

## 三、Steam：一条启动选项解决

Steam 客户端本身是 X11 程序，走 XWayland，不需要额外设置。Windows 游戏在「设置 → 兼容性」里勾上「为所有其他产品启用 Steam Play」，选 Proton 9 或 Experimental。

真正要让游戏用独显，是在每个游戏的「属性 → 启动选项」里写：

```
nvidia-offload %command%
```

再加上帧率显示和调度：

```
nvidia-offload gamemoderun mangohud %command%
```

验证方法：游戏运行时另开终端跑 `nvidia-smi`，应该能看到游戏进程占着显存和 GPU 利用率。

非 Steam 游戏（比如 F1 2020）加到库里之后，启动选项同样这么写。它的截图目录不是 appid，而是快捷方式 appid 左移 32 位算出来的 19 位大数——这个在 Steam 的「截图管理器 → 在文件夹中显示」里能直接看到，不用自己算。

## 四、MangoHud：F12 只截了张图

MangoHud 装好后，我在游戏里按 F12，什么都没出现，`~/Pictures` 里多了一张截图。

原因：**F12 在本机是 Umbriel/Noctalia 的截屏键**，合成器先吃掉了，MangoHud 根本收不到。

MangoHud 0.8.x 的默认键位是「右 Shift + F12」切换叠加，不是单按 F12。所以有两条路：

```bash
# 游戏运行时另开终端
mangohudctl toggle no_display
mangohudctl set no_display 1
mangohudctl reload-cfg
```

或者直接按右 Shift + F12。

### 4 GB 显存该看什么

这台卡只有 4 GB 显存，配置是按「笔记本 + 小显存」写的：默认隐藏，F12 呼出（实际要按右 Shift），F2 开关 CSV 日志。

| 指标 | 回答什么问题 |
| --- | --- |
| `vram` | 显存爆没爆；爆了会突然掉成幻灯片 |
| `frame_timing` + `fps_metrics=avg,0.01` | 平均 60 帧但 1% low 只有 25，就是卡顿感来源 |
| `gpu_load_change` | 是否跑满；长期 95%+ 只能降画质或分辨率 |
| `gpu_temp` / `cpu_temp` / `throttling_status` | 是否热降频 |
| `core_load` | 单核 100% 而 GPU 不满 = CPU 瓶颈（老游戏常见） |
| `gpu_name` | 显示 NVIDIA 才说明 offload 生效 |

多卡时 MangoHud 会把没在渲染的 Intel 也列出来（0%、0°C、0W）。配置里加 `gpu_list=1` 就只显示 NVIDIA。

## 五、电源：PPD 管三档，gamemode 自动切

这台机器的电源模式由 power-profiles-daemon（PPD）管，Noctalia 的「电源」面板就是它。

`intel_pstate` 下 governor 始终是 `powersave`，三档实际改的是 EPP：

| 面板 | `powerprofilesctl` | EPP |
| --- | --- | --- |
| 省电 | `power-saver` | `power` |
| 平衡 | `balanced` | `balance_performance` |
| 性能 | `performance` | `performance` |

给 gamemode 配两个钩子，游戏开始时切性能、退出时切回平衡：

```nix
programs.gamemode.settings.custom = {
  start = "${pkgs.power-profiles-daemon}/bin/powerprofilesctl set performance";
  end = "${pkgs.power-profiles-daemon}/bin/powerprofilesctl set balanced";
};
```

这里踩过一个坑：曾经写过 `powerManagement.cpuFreqGovernor = "performance"`。它会在开机时把 governor 钉死，之后 PPD 写 EPP 会被内核拒绝：

```
EBUSY: 设备或资源忙
```

表现就是面板点了没反应。

更坑的是，**从配置里删掉那行不等于自动还原**。`cpuFreqGovernor` 只是「开机/switch 时设一次」，删掉之后内核还保留上一次的值，必须重启或手动改回去。

## 六、btop 不显示 GPU：一次 dlopen 失败

`nvidia-smi` 一切正常，但 btop 里只有 cpu / mem / disks / net / proc，没有 GPU 框。

nixpkgs 的 btop 是带 `-DBTOP_GPU=ON` 编译的，二进制里也确有 `nvmlInit` 和 `libnvidia-ml.so.1` 的符号。问题在于它是**运行时按 soname `dlopen`**：

- 普通发行版里这个库在 `/usr/lib`；
- NixOS 上只在 `/run/opengl-driver/lib/`，不在默认搜索路径；
- `dlopen` 失败后 btop 静默当作「没有 GPU」。

对照实测，只差一个环境变量：

| 命令 | 结果 |
| --- | --- |
| `btop` | 无 GPU 框 |
| `LD_LIBRARY_PATH=/run/opengl-driver/lib btop` | `GTX 1650 Ti 0% 383M/4.0G 35°C 4.8W` |

修法是给包套一层 wrapper，**复用缓存里的二进制，不重新编译**：

```nix
btop = final.symlinkJoin {
  name = "btop";
  paths = [ prev.btop ];
  nativeBuildInputs = [ final.makeWrapper ];
  postBuild = ''
    wrapProgram $out/bin/btop --suffix LD_LIBRARY_PATH : /run/opengl-driver/lib
  '';
};
```

关键是用 `--suffix`，不能用 `--prefix`：`/run/opengl-driver/lib` 里混着 mesa 的 `libEGL_mesa.so`、`libgallium-*.so`，放到搜索路径最前面有污染别的程序的风险。

> 为什么不用 `overrideAttrs`：那会改变 derivation 的 hash，走不了二进制缓存，btop 要本地重编。`symlinkJoin` 只加一个 wrapper，其余原样。

Intel 核显仍然不显示，是因为 btop 的 Intel 后端读 `/sys/class/drm/card1/device/gt_cur_freq_mhz`，这台机器的 i915 没导出这个文件。想看核显得 `sudo intel_gpu_top`。

## 最后

这次折腾最值得记的不是哪条配置，而是三句话：

1. **只读选项要去看它的值从哪来**，不是去猜为什么写了不生效；
2. **验证要看实际执行的那一层**——GL vendor、解码进程、`lsmod`，不是设置页；
3. **「没有报错」不等于「在工作」**——btop 找不到库就安静地不显示，F12 被合成器吃掉也不会有提示。

游戏现在能跑，桌面还是核显在带，电也还是那么省。这套组合不是性能最强的，但它是我能在一台笔记本上长期用下去的配置。
