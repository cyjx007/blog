---
title: "NixOS 上没有 /usr/lib：第三方程序为什么启动就崩"
date: 2026-11-21T12:30:00+08:00
draft: false
slug: "nixos-binary"
tags: ["NixOS","动态链接","LocalSend","btop","nix-ld","排障"]
categories: []
salutation: "见字如面，"
description: "同一个程序，在别的发行版能跑，到 NixOS 就报 libz.so.1 找不到。不是库没装，是它根本不按 FHS 找库。这篇把 RPATH、LD_LIBRARY_PATH、nix-ld 的分工讲清楚，再给一套定位和修法的决策树。"
postscript: "案例来自 LocalSend 1.18.0 和 btop 1.4.8；具体版本写出来是因为修法依赖版本，升级后可能已经不需要 workaround。"
---

## 写在前面

LocalSend 装好之后，双击没反应。

从终端启动，只有一句：

```
error while loading shared libraries: libz.so.1: cannot open shared object file
```

`zlib` 当然装了。NixOS 上几乎每个包都依赖它。问题是：**这个程序去 `/usr/lib` 找，而 NixOS 根本没有 `/usr/lib`。**

这篇不打算只讲“怎么补这个库”，而是把这一类问题拆成三层：

- 链接时：RPATH / RUNPATH 写错了；
- 运行时：`dlopen` 找不到；
- 根本不在 Nix 体系里：外来二进制。

先判断是哪一层，再决定改哪里。

## 一、先理解 NixOS 为什么“没有库”

大部分发行版遵循 FHS：库在 `/usr/lib`，头文件在 `/usr/include`，程序按固定路径找。

NixOS 不这样。每个包在 `/nix/store/<hash>-<name>` 里，依赖关系写死在二进制里：

```bash
readelf -d $(which some-program) | grep -E 'RPATH|RUNPATH'
```

通常会看到一长串 `/nix/store/...` 路径。程序启动时，动态链接器按这些路径找库，不需要 `/usr/lib`。

这带来两个结果：

1. **打包正确的程序**，在 NixOS 上不需要任何环境变量；
2. **打包漏了依赖的程序**，不会“碰巧”从 `/usr/lib` 找到，而是直接报错。

LocalSend 就是第二种。

## 二、三个机制，别混着用

| 机制 | 什么时候起作用 | 适合谁 |
| --- | --- | --- |
| RPATH / RUNPATH | 链接时写进二进制 | 自己打包、`patchelf` |
| `LD_LIBRARY_PATH` | 运行时搜索 | 临时救急、wrapper |
| `nix-ld` | 给外来二进制兜底 | 官方没打包的 AppImage / 压缩包 |

### RPATH 是首选

打包时把依赖路径写进去，运行时就不需要任何环境变量。Nixpkgs 的 `autoPatchelfHook` 主要就是干这个。

### `LD_LIBRARY_PATH` 是补丁

它会在运行时**追加**搜索路径。适合：

- 上游包漏了一个依赖，短期修；
- 程序在运行时 `dlopen` 某个库，RPATH 管不到；
- 不想改 derivation。

缺点是它会传给子进程，放错位置可能污染别的程序。

### `nix-ld` 是最后一道门

`programs.nix-ld.enable = true` 会提供一个“外来二进制”的动态链接器，让不在 Nix store 里的程序也能找到一组指定的库。

它适合官方没打包的二进制，不适合修 nixpkgs 里已有的包——那种情况应该改包，而不是把整个系统的链接行为放宽。

## 三、定位：四步找到它到底在找什么

### 1. `ldd` 看缺谁

```bash
ldd $(which localsend_app)
# libz.so.1 => not found
```

### 2. `readelf` 看它原本想去哪找

```bash
readelf -d $(readlink -f $(which localsend_app)) | grep -E 'RPATH|RUNPATH'
```

如果输出里没有 `libz` 所在的 store 路径，说明打包时漏了。

### 3. `strace` 看它实际翻了哪些目录

```bash
strace -f -e trace=openat -o /tmp/trace \
  $(which localsend_app) 2>/dev/null
grep -i 'libz' /tmp/trace | head
```

这一步能区分“没写 RPATH”和“写了但路径不对”。

### 4. `nix-store` 看闭包里到底有没有

```bash
nix-store -q --references $(readlink -f $(which localsend_app)) | grep zlib
```

没有输出，就说明这个包的闭包里根本没有 zlib，不是搜索路径的问题。

## 四、修法决策树

### 情况 A：nixpkgs 包漏依赖 → `overrideAttrs` + wrapper

LocalSend 的修法：

```nix
programs.localsend = {
  enable = true;
  openFirewall = true;
  package = pkgs.localsend.overrideAttrs (old: {
    nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [ pkgs.makeWrapper ];
    postFixup = (old.postFixup or "") + ''
      wrapProgram $out/bin/localsend_app \
        --prefix LD_LIBRARY_PATH : ${pkgs.zlib}/lib
    '';
  });
};
```

这里用 `--prefix` 是安全的：只加一个 zlib 目录，不会盖住别的库。

### 情况 B：运行时 `dlopen` → wrapper，但别改 RPATH

btop 是另一种：

- 它编译时带了 `-DBTOP_GPU=ON`；
- 但 NVML 是运行时按 soname `dlopen("libnvidia-ml.so.1")`；
- NixOS 上这个库只在 `/run/opengl-driver/lib/`，不在默认搜索路径；
- `dlopen` 失败后，btop 静默当作“没有 GPU”。

这种情况 RPATH 也救不了，因为程序在运行时才决定加载谁。

修法是套一层 wrapper，**复用缓存里的二进制**：

```nix
btop = final.symlinkJoin {
  name = "btop";
  paths = [ prev.btop ];
  nativeBuildInputs = [ final.makeWrapper ];
  postBuild = ''
    wrapProgram $out/bin/btop \
      --suffix LD_LIBRARY_PATH : /run/opengl-driver/lib
  '';
};
```

### 为什么这里必须 `--suffix`

`/run/opengl-driver/lib` 里不只有 NVIDIA 的库，还混着 mesa 的 `libEGL_mesa.so`、`libgallium-*.so`。把它放在搜索路径最前面，可能让别的程序加载到不该加载的 mesa 库。

所以：

- LocalSend 补 zlib → `--prefix`；
- btop 补驱动目录 → `--suffix`。

不是风格差异，是路径内容不同。

### 为什么不用 `overrideAttrs`

btop 也可以用 `overrideAttrs` 改 `postFixup`，但那会改变 derivation 的 hash，走不了二进制缓存，btop 要在本地重编。

`symlinkJoin` 只是加一个 wrapper，原二进制不动，缓存照用。

### 情况 C：完全外来二进制 → `nix-ld` 或 FHS 环境

如果程序不在 nixpkgs 里：

```nix
programs.nix-ld.enable = true;
programs.nix-ld.libraries = with pkgs; [
  zlib
  openssl
  # 按报错逐个补
];
```

或者临时用一个 FHS 环境：

```bash
nix shell nixpkgs#buildFHSEnv
# 或者为自己的程序写一个 buildFHSEnv 包装
```

AppImage 还有 `appimage-run`，它本身就是一层 FHS 包装。

### 情况 D：只想跑一次 → 不要改系统

```bash
nix shell nixpkgs#some-package
nix run nixpkgs#some-package
```

临时命令不要写进 `configuration.nix`，否则半年后会忘记它为什么在那里。

## 五、两个容易误判的点

### 1. `ldd` 能过，不等于运行时没问题

`dlopen` 的库不会出现在 `ldd` 的输出里。btop 的 NVML 就是典型：`ldd` 一切正常，运行时才发现 GPU 框没有。

判断方法：看程序文档、`strings`、或者 `strace` 里有没有 `openat` 那个 soname。

### 2. 缺库不一定是“没装”

NixOS 上更常见的是“装了，但没写进闭包”或者“装了，但不在搜索路径”。

先看 `nix-store -q --references`，再看 `readelf`，最后才考虑装包。

## 六、一张速查表

| 现象 | 优先检查 | 常见修法 |
| --- | --- | --- |
| 启动即报 `cannot open shared object file` | `ldd`、`readelf -d` | `overrideAttrs` + wrapper |
| 启动正常，某个功能没有 | 是否运行时 `dlopen` | wrapper + `LD_LIBRARY_PATH` |
| 只有某个用户的会话里坏 | 环境变量继承 | 检查 `systemd --user` 环境 |
| 外来二进制 | 是否在 Nix store 里 | `nix-ld` / `buildFHSEnv` / `appimage-run` |
| 改了包但没生效 | 是否 switch 到新 generation | `readlink -f $(which ...)` |

## 最后

NixOS 的“没有 `/usr/lib`”经常被当成缺点，但它其实把问题变得**可定位**了：

- 依赖有没有写进闭包，一查就知道；
- 搜索路径对不对，`readelf` 一看就知道；
- 是链接期还是运行期，`ldd` 和 `strace` 能分开。

真正麻烦的不是报错，而是像 btop 那样**不报错**——找不到库就安静地少一个功能。所以每次装完新东西，除了“能启动”，还要确认“该有的功能都在”。

一句话总结：**先问这个库应该在什么时候被找到，再决定是改包、改环境，还是改运行方式。**
