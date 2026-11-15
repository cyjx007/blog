---
title: "三次实测：声音断续、AV1 卡顿、eMMC 寿命"
date: 2026-11-15T16:05:00+08:00
draft: false
slug: "three-measurements"
tags: ["NixOS","排障","PipeWire","硬解","eMMC","OpenWrt"]
categories: []
salutation: "见字如面，"
description: "三件「一看就知道是配置写错了」的事，最后都被测量推翻：蓝牙音频断续其实是 rtkit 把 wireplumber 反复杀掉，Firefox 卡顿是两个开关必须成对，路由器 eMMC 的寿命账要拿 /sys 里的数字算。"
postscript: "三件事的原始记录分别在 nixos-config/docs/media-playback.md 和 .dsh/openwrt/ops/ops-20261115-f50pro-emmc.md，这里的数字都是当场测的。"
---

## 写在前面

有三件事，我一开始都觉得「肯定是配置写错了，改一行就好」：

1. 蓝牙耳机听歌断断续续。
2. B 站 1080p 一播风扇就转。
3. 家里路由器用 eMMC 当系统盘，早晚要写坏。

三个猜想都很合理，三个都是错的。

这篇记的是**测量怎么把猜想推翻**的过程。它可能比结论更有用——因为结论只适用于我这台机器，方法适用于所有机器。

## 案例一：蓝牙音频断续，凶手是 rtkit

### 现象

蓝牙耳机（SBC-XQ）听歌，每隔十几秒「咔」一下，像丢包。

### 第一个猜想：优先级不够，上 rtkit

音频线程需要实时调度，否则被别的进程抢占就会 underrun。NixOS 里开这个是一行：

```nix
security.rtkit.enable = true;
```

改完 `nixos-rebuild switch`，重启，症状变了：**输出设备列表在反复重建**，顶栏的音频设备一直在切换，声音彻底没了。

### 查证：wireplumber 在死循环里

```bash
journalctl --user -u wireplumber -n 100
```

看到的是每 3–5 秒一次的：

```
wireplumber[...]: Terminated
systemd[...]: wireplumber.service: Main process exited, code=killed, status=9/KILL
```

五分钟 **13 次**，退出码 137（= 128 + 9，SIGKILL）。

SIGKILL 只有几个来源，逐个排除：

| 可能 | 怎么排除 | 结果 |
| --- | --- | --- |
| systemd watchdog | `systemctl --user show wireplumber -p WatchdogUSec` | `0`，没开 |
| 内核 OOM | `cat /sys/fs/cgroup/.../memory.events` 的 `oom_kill` | `0` |
| 内存不足 | 手动前台跑 `wireplumber` | 一样被杀，退出码 137 |

手动前台跑也被杀，说明不是 systemd 的事。而这一切是在开了 rtkit 之后才出现的——rtkit 的作用正是把音频线程提到 `SCHED_RR` 实时优先级。

**结论**：这台机器上 rtkit + wireplumber 的组合会触发某个杀进程的逻辑（大概率是实时优先级下的看门狗/安全机制），表现为反复 SIGKILL。关掉即恢复。

```nix
# 注意：不要开 security.rtkit.enable。2026-11-15 实测，开了之后 wireplumber
# 拿到 SCHED_RR 实时优先级，随即被反复 SIGKILL（5 分钟 13 次，每 3-5 秒一次），
# 音频设备列表跟着反复重建，表现为「输出设备一直切换」。关掉后即恢复稳定。
```

我把这段注释直接写进了配置里，因为半年后我一定会再想「加个 rtkit 是不是更好」。

### 第二个猜想：加大缓冲

回到断续本身。PipeWire 的缓冲由 `quantum` 决定：

| quantum | 时长（48 kHz） |
| --- | --- |
| 2048 | 42.7 ms |
| 4096 | 85.3 ms |

蓝牙链路抖动时 42.7 ms 不够，那就翻倍：

```nix
services.pipewire.extraConfig.pipewire."10-clock"."context.properties" = {
  "default.clock.quantum" = 4096;
  "default.clock.max-quantum" = 4096;   # 不抬这个，4096 会被默认上限 2048 截断
};
```

实测：断包次数 **0**。看起来成了。

### 但它是假的

过了半小时我想确认「到底改了什么生效」，于是用 `pw-top` 看实际参数：

```
S   ID  QUANT   RATE    WAIT    BUSY   FORMAT
R   45   2048  48000   ...     ...    S16LE 2 48000
```

**QUANT 一直是 2048。**

原因：蓝牙 A2DP 的包大小是固定的，`bluez_output` 永远自己请求 2048 帧，全局 metadata 里的 `default.clock.quantum` 根本不跟随。

也就是说：

- 对蓝牙：**完全无效**。
- 对内置扬声器 / 有线：把延迟从 42.7 ms 抬到 85.3 ms，看视频开始对不上口型。

那断包为什么真的没了？因为重启之后我还顺手做了别的（换了个位置、少了 2.4G 干扰）。**「改了之后好了」不等于「因为改了才好」。**

于是撤掉：

```nix
# 也不要加 quantum = 4096：蓝牙 A2DP 的包大小固定，bluez_output 永远自己请求
# 2048（实测 pw-top 里 QUANT 一直是 2048，全局 metadata 设 4096 也不跟随），
# 对蓝牙完全无效；但会让内置扬声器/有线的延迟从 42.7ms 涨到 85.3ms。
```

只留下「不要开 rtkit」那半句，因为那是真踩出来的。

### 这个案例教我的

1. **`pw-top` 是唯一可信的证据**，配置文件里写了什么不算。
2. 进程被 SIGKILL 时，先问「谁有权发 SIGKILL」，再逐个排除。
3. 一次只改一个变量。我同时改了 rtkit 和 quantum，结果花了半小时才拆开。

## 案例二：B 站一播就卡，两个开关必须成对

### 现象

B 站 1080p，风扇立刻起飞。`about:support` 里 `HARDWARE_VIDEO_DECODING = available`，说明硬件支持。

### 第一个猜想：没开 VA-API

Firefox 的硬解开关是 `media.ffmpeg.vaapi.enabled`，默认 `false`。打开它。

还是卡。

### 第二个猜想：格式不对

Firefox 自己的解码走 **RDD 进程**（Remote Data Decoder），和 mpv 那套完全无关。B 站和 YouTube 现在默认发 **AV1**，而这台机器的 UHD 630（Comet Lake）**没有 AV1 解码单元**——只能软解。

于是：

```
media.av1.enabled = false      # 关 AV1 → 退回 VP9 / H.264
media.ffmpeg.vaapi.enabled = true
```

**这两个必须成对。** 只关 AV1 不打开 VA-API，等于「请回了能硬解的格式，但还是不用硬解」。

### 实测数据

同一条视频（B 站 1080p，BV1wRsV6gEP4）：

| 配置 | 解码进程 CPU | 主进程 CPU | 结论 |
| --- | --- | --- | --- |
| AV1 关 + VA-API **关** | **15.8%** | 21.4% | 软解 |
| AV1 关 + VA-API **开** | **1.2%** | 11% | **硬解** |

解码进程 CPU 掉了 92%。

### 怎么自己验证

```bash
ps -eo pcpu,comm | rg -i 'rdd|firefox' | sort -rn | head -3
# 硬解：RDD 个位数；软解：RDD 15%+
```

硬解生效时，RDD 进程的特征是：加载了 `iHD_drv_video.so`、打开 `/dev/dri/renderD129`。同时独显全程 `suspended`，`nvkm` 中断 0 次/3 秒（`i915` 4000+ 次/3 秒）——这也顺便证明了「独显根本没参与」。

### 几个坑

- 这两个是**浏览器用户级设置**（`prefs.js`），不在 nix 配置里。换机 / 新建 profile 要重设。
- 遇到花屏、绿块、画面卡死 → 把 `media.ffmpeg.vaapi.enabled` 改回 `false`。
- `about:support` 里 `HARDWARE_VIDEO_DECODING_VULKAN` 显示 `user disabled / blocklisted` 是**正常的**，那是 Firefox 新的 Vulkan 解码路径，被这台机器的驱动组合拉黑了，不用管。
- 4K 别指望浏览器，直接 `mpv 'URL'`（走 `vaapi-copy`，已验证）。

### 这个案例教我的

「硬件支持」和「实际在用」之间隔着两层开关，而且这两层互相依赖。**验证要看解码进程，不是看设置页。**

## 案例三：路由器 eMMC 到底扛不扛得住

### 起因

家里那台 F50 Pro 路由器（OpenWrt 25.12.5）跑着 OpenList、Forgejo、几个容器，**系统盘、docker 盘、数据盘是同一块 eMMC**。

常听到的说法是「eMMC 能当系统盘、不能当数据盘」。问题是它没有第二个盘位。

### 先测硬件

| 项 | 值 | 来源 |
| --- | --- | --- |
| 型号 | `2Y18CG`，生产 10/2025 | `/sys/block/mmcblk0/device/` |
| 容量 | 122159104 KiB（≈128 GB 级） | `/proc/partitions` |
| 持久分区 | 40 GiB（`mmcblk0p84`） | — |
| 总线 | 8-bit，`clock 52 MHz`，`mmc high-speed` | **不是 HS200/HS400，最弱的一档** |
| 顺序写 | **39.0 MB/s**（O_DIRECT 512 MB） | 实测 |
| 顺序读 | **41.8 MB/s** | 实测 |
| 健康 | `life_time=0x01`、`pre_eol_info=0x01` | 一年只用掉 0–10% |

注意那个 39 MB/s——不是传说中 eMMC 的 300/100，**是 40 MB/s 封顶**。这就是为什么拉一个 `forgejo:17` 镜像要 4 分 27 秒。

### 再算磨损账

不看规格书，直接看这台机器实际写了多少：

```bash
a=$(awk '{print $7}' /sys/block/mmcblk0/stat); sleep 90
b=$(awk '{print $7}' /sys/block/mmcblk0/stat)
echo "block: $(( (b-a)/2/90 )) KB/s"
```

结果 **23 KB/s**（`/sys/block/mmcblk0/stat` 与 `/sys/fs/cgroup/io.stat` 两边对得上）：

```
23 KB/s × 86400 ≈ 2.0 GB/天 ≈ 730 GB/年
```

按 128 GB × 1000 P/E = 128 TB 原始寿命：

| 写放大 | 推算寿命 |
| --- | --- |
| 3× | 约 58 年 |
| 10× | 约 17 年 |

和 `life_time` 一年只走 0–10% 吻合。

**结论：磨损不是瓶颈。**

### 那风险在哪

风险在**结构**，不在寿命：

1. **单点 + 不可换**：`/`、`/mnt/mu300-disk`、docker root 是同一个 ext4。OpenWrt 配置、6 个容器、OpenList 4.2 G、Forgejo 仓库、所有备份，一次坏块或一次 fsck 失败全没；焊死的盘，坏了整机报废。
2. **无电池 + 脏断电**：`commit=60` 意味着断电最多丢 60 秒写入。ext4 journal 保一致性，但反复脏断电会累积坏块；正在写 FTL 映射表时掉电有小概率直接变砖。
3. **唯一副本**：登录态加密包之前只在这块焊死的 NAND 上。
4. **写满即系统级故障**：`/` 和 docker 共用一个 39.3 G，某容器日志失控写满 → 系统一起挂。
5. **高温**：机内 52–58 °C。NAND 在 55 °C 下断电存放的 retention 只有一年左右，这机器不适合当冷归档。

顺手确认了「能不能挂别的盘」：**物理上不行**。`/sys/bus/usb/devices` 是空的（没有 USB host），没有 SD 槽，只有 `mmc0`（eMMC）和 `mmc2`（SDIO WiFi）。

### 已经做对的三件事

| 动作 | 效果 |
| --- | --- |
| `commit=60`（ext4 从 5 秒刷一次元数据改成 60 秒） | 写入从 **46 KB/s 降到 24.5 KB/s**，砍掉近一半 |
| swap 放 **zram**（752 MB，常年只用 2–3 MB） | 没有 swap 落在 eMMC 上，这是最伤盘的用法 |
| 日志轮转（`rotate-app-logs.sh` + compose 的 `max-size`） | 没有失控的 `json.log` |

### 谁在写

按容器 cgroup 的 `io.stat`，开机 3 小时累计：

| 容器 | 写入 |
| --- | --- |
| forgejo | **228 MB** |
| wb-proxy | 6 MB |
| tg-bot | 2 MB |
| homepage / dozzle / it-tools | ~0 |

Forgejo 一家占九成以上：`gitea.db-wal`（4.2 MB）在反复 checkpoint。这是 SQLite 的固有行为，不是配错，改不动也不值得改。

### 处置

磨损既然不是问题，那就只处理「单点」：

| 动作 | 结果 |
| --- | --- |
| 冷数据搬离路由器 | `router-backups` 2.4 G + `firmware` 837 M → 笔记本 `~/backups/f50pro/`，**129 个文件 sha256 逐一比对一致**后才删 |
| 删除后占用 | 7.0 G / 39.3 G（18%）→ **3.8 G（10%）** |
| 加密包本机留一份 | `~/backups/f50pro/userdata-backup/`，5 份 5.5 MB |
| 体检加趋势 | `post-reboot-check.sh` 每次把 `life_time`/`pre_eol`/占用追加到 `emmc-health.log` |

搬走冷数据的理由**不是磨损**（冷数据不写），是：缩小「一次全丢」的面、缩短 fsck 和备份时间、给 `/cloud` 留余量。

`pre_eol_info` 变 `0x02`（用掉 80%）就该准备迁移了。现在还是 `0x01`。

### 这个案例教我的

「eMMC 不耐写」是个正确的废话。真正该问的是：**这台机器上，一次故障会带走多少东西？**

答案是「全部」，那就和磨损无关了，得靠外置副本。

## 三件事的共同点

回头看，三次都是同一个流程：

1. **先量化**。断包次数、RDD 的 CPU、`life_time` 的斜率。没有数字的时候，所有猜想都同样合理。
2. **一次只改一个变量**。案例一里我同时改了 rtkit 和 quantum，代价是半小时的误判。
3. **验证要看运行时，不看配置**。`pw-top` 里的 QUANT、`ps` 里的 RDD、`/sys/block` 里的写字节数——配置文件写了什么不算数。
4. **把「为什么」写进注释**。半年后我不会记得「为什么这里不能开 rtkit」，但那行注释会。

最后一条尤其重要。NixOS 的配置是声明式的，好处是可复现，坏处是**它不会告诉你哪一行是踩过坑才写成这样的**。

此致
