---
title: "Cloudflare Tunnel 到底能干什么"
slug: "Cloudflare-Tunnel-到底能干什么"
date: 2026-09-04T15:55:44+08:00
draft: false
categories: ["网络"]
tags: ["Cloudflare", "Tunnel", "IPv4", "IPv6", "网络"]
---
## 我为什么开始研究 Cloudflare Tunnel

之前折腾自己的随身 Wi-Fi 网络时，我遇到了一个很现实的问题。

我的设备并没有一个方便直接使用的公网 IPv4 地址，但有公网 IPv6 地址。

我的随身 Wi-Fi 运行着 OpenList 服务：

```text
设备
  ↓
OpenList
  ↓
端口 5244
```

在 IPv6 网络环境下，可以直接通过 IPv6 地址访问。

但是如果网络环境只有 IPv4，就出现了问题。

这时候我开始研究 Cloudflare Tunnel。

## Cloudflare Tunnel 是什么

简单来说，Cloudflare Tunnel 可以让运行在内网中的服务，通过一个主动建立的出站连接连接到 Cloudflare。

传统的访问方式大概是：

```text
用户
  ↓
公网 IP
  ↓
路由器端口
  ↓
内网设备
  ↓
服务
```

这要求你通常需要能够从公网访问到自己的设备。

而 Tunnel 的思路不太一样：

```text
内网设备
   │
   │ cloudflared 主动建立连接
   ↓
Cloudflare
   ↑
   │
用户访问域名
```

也就是说，服务端不一定需要直接暴露一个公网 IP。

## 它最有用的地方

我觉得 Cloudflare Tunnel 最方便的地方，就是：

> **可以把一个本来只能在内网访问的服务，通过域名提供给外部访问。**

例如我的电脑上运行：

```text
127.0.0.1:8080
```

或者：

```text
192.168.0.1:5244
```

只要 Tunnel 配置正确，就可以让：

```text
https://example.com
```

访问到这个内部服务。

中间不需要直接把 `8080` 或 `5244` 暴露到公网，也不需要考虑你本地有没有 IPv6 环境。

## 它和普通端口转发有什么区别？

传统端口转发：

```text
公网
 ↓
公网 IP:5244
 ↓
路由器
 ↓
192.168.0.1:5244
```

需要考虑：

* 有没有公网 IPv4、IPv6
* 路由器能不能做端口转发
* 运营商有没有封端口
* 防火墙
* NAT

而 Tunnel：

```text
内网服务
 ↓
Tunnel
 ↓
Cloudflare
 ↓
域名
```

由内网设备主动向 Cloudflare 建立连接。

因此即使设备处于 NAT 后面，也可能可以使用。

客户端和你的服务器之间不需要直接建立传统意义上的端到端连接。

Cloudflare 在中间充当了入口。

所以对于没有公网 IPv4 的设备来说，这一点非常有用。

如果我的目的只是：

> “让别人通过一个域名访问我的 OpenList”

那么 Tunnel 很合适。

## 我现在对 Tunnel 的理解

折腾之前，我最初理解的是：

> Cloudflare Tunnel = 把内网端口映射到公网。

后来发现其实更准确的说法是：

> **Cloudflare Tunnel 是一种让内部服务通过 Cloudflare 对外提供访问的连接方式。**

它最大的价值并不是“帮我获得一个公网 IP”。

而是：

```text
没有公网 IPv4 IPv6
        ↓
设备仍然可以主动连接 Cloudflare
        ↓
Cloudflare 成为公网入口
        ↓
通过域名访问内部服务
```

这对于家庭服务器、NAS、开发环境以及各种折腾设备来说，都非常方便。

### 总结

Cloudflare Tunnel 对我来说最有价值的几个场景就是：

1. 没有公网 IPv4 时对外提供服务
2. 不想开放公网端口
3. 想通过域名访问内网服务
4. 内网设备位于 NAT 后面
5. 想把多个内部服务统一放到域名下面

不过它也不是万能的。

如果只是想访问一个网页或者 Web 服务，Tunnel 非常方便。

如果需要完整的网络互通，则应该考虑 VPN、Tailscale、WireGuard 等其他方案。

对我来说，Cloudflare Tunnel 最大的意义就是：

> **以前需要考虑公网 IP、端口转发、IPv4、NAT 的问题，现在可以先把服务接到 Cloudflare，再通过域名访问。**

而这也是我折腾网络过程中，又一个从“听说过”变成“真正用过”的东西。
