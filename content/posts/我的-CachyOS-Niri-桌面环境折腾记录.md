---
title: "我的 CachyOS + Niri + Noctalia 桌面环境折腾记录"
date: 2026-09-04T16:20:00+08:00
draft: true
slug: "我的-CachyOS-Niri-桌面环境折腾记录"
tags: ["CachyOS","Niri","Noctalia","Wayland","Linux桌面"]
categories: []
---

## 为什么又开始折腾 Linux 桌面

Linux 最大的乐趣之一，大概就是：

> 这个东西明明已经能用了，但我就是想把它改成自己喜欢的样子。

我一直喜欢折腾 Linux 桌面环境。

从传统的 GNOME、KDE，到后来接触 Wayland，再到现在使用 CachyOS + Niri + Noctalia，我越来越喜欢这种可以自己组合桌面环境的感觉。

这次的目标其实也很简单：

**一个好看、简洁、流畅，而且尽可能符合自己使用习惯的桌面。**

于是现在的桌面逐渐变成了：

```text
CachyOS
   ↓
Wayland
   ↓
Niri
   ↓
Noctalia
   ↓
自己修改配置和主题
```

## 为什么选择 CachyOS

CachyOS 本质上还是 Arch Linux 生态的一部分，但它在性能优化、内核、软件包以及桌面体验方面做了很多自己的调整。

对我来说，最重要的不是某个跑分能高多少，而是：

* 软件比较新
* Arch 软件生态完整
* AUR 很方便
* 系统比较适合自己折腾
* 可以自由选择桌面环境

安装完成以后，我没有选择传统的 GNOME 或 KDE 作为最终桌面，而是开始尝试 Niri。

## Niri 是什么

Niri 是一个 Wayland 原生的平铺窗口管理器。

和传统的桌面环境相比，它的窗口管理方式很不一样。

Niri 是横向滚动的布局。

窗口不会不断压缩到越来越小，而是沿着屏幕方向排列。

刚开始使用的时候需要适应一下，但习惯以后感觉非常舒服。

尤其是在键盘操作比较多的时候，窗口管理效率很高。

## Noctalia

只有窗口管理器显然还不够。

我还需要：

* 状态栏
* 启动器
* 壁纸
* 通知
* 锁屏
* 系统菜单
* 各种桌面组件

于是开始使用 Noctalia。

现在整个桌面的大部分 UI 都由 Noctalia 提供。

这样组合起来：

```text
Niri
负责窗口管理

Noctalia
负责桌面 Shell

CachyOS
负责底层系统
```
三个东西各司其职。

## 一键桌面主题推荐

这里先推荐一个基于 Niri 和 Noctalia V5 的 Arch / CachyOS 上的 Material You 桌面配置 NyxNiri。

https://github.com/ech678/NyxNiri

### 特性

  - 壁纸选择器（Super+W）— 静态和动态壁纸统一选择，支持搜索和分类。
  - 色彩联动 — Noctalia V5 直接从壁纸取色；动态壁纸由 mpvpaper 配合 ffmpeg 抽帧。
  - 明暗同步 — GTK 3/4、XDG Portal、Kitty、浏览器一起跟随主题切换。
  - 护眼模式（Super+N）— 暖色温、关模糊、纯色不透明窗口。
  - Scratchpad（Super+~）— 随时呼出的 Kitty 持久浮动终端。
  - Orbit 启动器（Super+A / Super+鼠标前侧键）— 矢量星环；应用、工具、网页、AI/搜索轮盘，全 TOML 自定义。
  - Shell 和终端 — Fish 代理/缓存别名，Kitty 光标轨迹，Windows 风格快捷键。
  - NyxMellow — 动态 fcitx5 皮肤：mellow 圆角 + Noctalia Material You 配色。
  - 配置预设 — 每个应用多套风味变体（如 kitty 透明）；一条命令切换，把当前配置存为私有预设，或直接在 $EDITOR 里改。

### 安装

独立在线安装
```
curl -fsSL --connect-timeout 10 https://raw.githubusercontent.com/ech678/NyxNiri/main/install.sh | bash
```
从 Git 仓库安装（推荐）
```
# 浅克隆：只拉最新快照；要完整历史去掉 --depth 1
git clone --depth 1 https://github.com/ech678/NyxNiri.git ~/NyxNiri
cd ~/NyxNiri && ./install.sh
```
系统包安装（AUR）
> 即将支持——paru -S nyxniri-git，更新由 pacman 管理。

## 修改配置

想自己折腾的话默认配置当然不是最终答案。

真正开始有意思的部分，是修改配置。

我开始一点一点调整：

  - 快捷键
  - 状态栏
  - 壁纸
  - 主题
  - 颜色
  - 字体
  - 窗口行为
  - 启动器
  - 通知
  - 锁屏

有些修改很简单。

有些则需要直接研究配置文件。

这也是我比较喜欢 Linux 的地方。

如果某个东西不好用，我可以去找配置文件，然后自己改。

## 输入法

Linux 桌面另一个经常需要折腾的东西就是输入法。

我使用 fcitx5。

理论上安装好以后就可以输入中文，但在 Wayland 环境下，不同应用的兼容情况还是会有区别。

有时候 GTK 应用正常。

有时候 Qt 应用正常。

有时候某个应用的输入法候选框又会出现奇怪的问题。

例如之前就遇到过 Telegram 深色模式下候选文字显示不清楚的问题。

这种问题往往不是简单地“输入法坏了”。

还需要考虑：
```text
应用
↓
GTK / Qt
↓
Wayland
↓
fcitx5
↓
主题
```
多个组件之间的配合。

## 登录界面

后来又开始折腾登录界面。

一开始使用的是 SDDM，后来尝试使用 greetd + Noctalia Greeter。

整体结构变成：
```text
开机
 ↓
greetd
 ↓
Noctalia Greeter
 ↓
Niri
 ↓
Noctalia
```
这样从登录界面到进入桌面，视觉上也更加统一。

配置文件主要涉及：
```text
/etc/greetd/config.toml
```
通过配置默认 session，让登录以后直接进入 Niri。

## NVIDIA

我的电脑还有 NVIDIA 独显。

Linux + NVIDIA + Wayland 本身就是一个值得单独写一篇文章的话题。

使用过程中也遇到过驱动、GPU、游戏性能等各种问题。

例如有时候：
```text
CPU 没跑满
GPU 也没跑满
但是游戏帧率就是上不去
```
这种问题就不能简单地归结为“显卡性能不够”。

还需要考虑：
```text
NVIDIA 驱动
Wayland
游戏
Proton
Gamescope
Vulkan
GPU 选择
```
这些因素之间的关系。

## 游戏

桌面环境折腾到最后，自然还是要拿来玩游戏。

Steam 在 Linux 上已经比以前方便很多。

原生 Linux 游戏可以直接运行，而 Windows 游戏则可以通过 Proton。

对于不同类型的游戏，我也会考虑到底有没有必要使用 Gamescope。

有些原生游戏并不需要额外套一层 Gamescope。

有些游戏则可以利用 Gamescope 提供的功能。

所以并不是：

> Linux 游戏 = 必须 Gamescope

而是应该根据具体情况决定。

## 我最喜欢的地方

现在这套桌面最让我满意的地方，其实不是某个具体软件。

而是它越来越像“我的电脑”。

整个系统里的每一个部分，都是自己一点一点调整出来的。

## 折腾过程中遇到的问题

当然也不是一路顺利。

Linux 桌面最有意思的地方之一，就是：

> 你永远不知道下一个问题会从哪里冒出来。

可能是：
```text
配置文件语法错误
```
也可能是：
```text
Wayland 下某个程序表现异常
```
或者：
```text
NVIDIA 驱动问题
```
甚至可能只是：
```text
一个 CSS / 主题颜色
```
导致某个文字看不清楚。

但解决问题的过程本身，就是折腾的一部分。

很多时候我会先查看日志，然后检查配置，再尝试最小化问题。

慢慢地也开始形成自己的排错习惯：
```text
发现问题
 ↓
确认现象
 ↓
查看日志
 ↓
检查配置
 ↓
搜索源码
 ↓
修改
 ↓
重新测试
```
而不是直接不停地乱改配置。

## 现在的桌面

目前我的桌面大概是这样：

![Screenshot from 2026-09-04 16-03-33.png](https://cloudflare-imgbed-auw.pages.dev/file/1788509064013_Screenshot_from_2026-09-04_16-03-33.png)

它并不是某个官方推荐的“最佳配置”。

甚至可能还有很多地方并不完美。

但这并不重要。

因为它是我自己折腾出来的。

## 写在最后

Linux 桌面折腾其实是一件很奇怪的事情。

有时候花两个小时，只是为了让一个按钮换一个颜色。

有时候为了一个快捷键，可以翻半天配置文件。

有时候一个问题解决以后，最大的收获甚至不是问题本身，而是终于知道 Linux 的某个组件到底是怎么工作的。

也许这就是我一直喜欢折腾 Linux 的原因。

它不像一台只能按照说明书使用的机器。

它更像一个可以不断修改的系统。

今天是 CachyOS + Niri + Noctalia。

以后可能又会换成别的东西。

但至少现在，这就是我喜欢的桌面。

而折腾还没有结束。
