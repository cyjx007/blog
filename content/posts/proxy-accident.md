---
title: "别急着给每台机器配代理：一次 ECONNRESET 和一次把浏览器搞挂的事故"
date: 2026-11-21T10:00:00+08:00
draft: false
slug: "proxy-accident"
tags: ["网络","代理","OpenWrt","Firefox","排障","OpenCode"]
categories: []
salutation: "见字如面，"
description: "三个云端模型同时 ECONNRESET，我以为是模型挂了，先加代理——模型恢复了，但 Firefox 被弄成外网全断。最后发现路由器早就在透明代理整个 LAN，笔记本一行代理变量都不该设。"
postscript: "文中路由器地址、账号和出口 IP 都已替换；完整排查记录在 .dsh/openwrt/ops/ops-20261117-opencode-proxy.md。"
---

## 写在前面

这事有个很典型的开头：

> 三个模型同时报同一个错，那一定是网络问题。

结论只对了一半。网络确实有问题，但**我做的修复不是修复，是在一条已经能用的链路上又叠了一层**。叠上去的那层没解决问题，反而把浏览器弄挂了。

## 一、现象：三个模型，同一句 ECONNRESET

OpenCode 里连着换三个云端模型：

- 一个免费档；
- 两个走 AI Studio key 的 Gemini；
- 与此同时，局域网网关上的模型正常。

前三个都在两分多钟后报同一句：

```
Error: ECONNRESET: The socket connection was closed unexpectedly.
```

日志里还有一条 `Failed to fetch models.dev: TimeoutError after '10s'`。

同一时间，局域网里的模型（`workbuddy/*`，地址在路由器上）完全正常。这个对照很有用：它说明**不是账号坏了，也不是模型下线**，而是「从这台笔记本到公网」这段有问题。

## 二、第一反应：加代理

路由器上跑着 mihomo，端口一应俱全：

```
7890(http) 7891(socks) 7892(redir) 7893(mixed) 7895(tproxy) 9090(API)
```

先做最简单的验证：在路由器本机 curl 一下。

```bash
curl -x 127.0.0.1:7893 https://www.gstatic.com/generate_204
# 204
```

说明 mihomo 本身是好的、节点是通的。

然后从笔记本上裸连：

```bash
curl -x 192.168.x.1:7893 https://www.gstatic.com/generate_204
# 000
```

第一反应是「端口没开或防火墙挡了」。其实不是——配置里有：

```yaml
authentication:
  - "user:password"
```

mihomo 的认证对**所有监听端口**生效，局域网客户端必须带账号密码。裸连只会拿到空响应，curl 报 `000`，非常容易误判成端口不通。

带上认证就通了：

```bash
curl -x http://user:password@192.168.x.1:7893 \
  https://www.gstatic.com/generate_204
# 204
```

于是我把代理写进了 `~/.config/opencode/env`：

```bash
export HTTPS_PROXY="http://user:password@192.168.x.1:7893"
export HTTP_PROXY="$HTTPS_PROXY"
export https_proxy="$HTTPS_PROXY"
export http_proxy="$HTTPS_PROXY"
export NO_PROXY="localhost,127.0.0.1,::1,192.168.x.1,192.168.x.0/24"
export no_proxy="$NO_PROXY"
```

模型恢复了。看起来问题解决了。

## 三、代价：Firefox 外网全断

几个小时后，浏览器打不开任何网页，弹出一个框：

> 代理服务器要求输入用户名和密码

取消之后，外网还是全挂。

链条是这样的：

1. `~/.config/opencode/env` 被 `~/.bashrc` 全局 source；
2. 变量进了 `systemd --user` 的环境；
3. Umbriel 启动的 GUI 程序全部继承；
4. **Firefox 会把环境变量里的代理当成「系统代理」**，但它不认 URL 里的 `user:password`；
5. 弹认证框，用户取消之后，既不走代理，也没有稳定回退直连。

Thunderbird 也一样，因为它从同一个会话继承了变量。

而真正讽刺的是：**路由器本来就在透明代理整个 LAN，这些变量纯属多余。**

### 回滚清单

```bash
# 1. 删掉 env 里的全部代理变量，只留需要的 key
# 2. 清掉 systemd user 环境
systemctl --user unset-environment \
  HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy

# 3. Firefox：删掉 user.js / prefs.js 里的 network.proxy.*，
#    恢复「使用系统代理设置」
# 4. Thunderbird：prefs.js 里显式写 network.proxy.type = 0
```

## 四、复测：透明代理其实一直在工作

把变量全部撤掉之后，用 `--noproxy '*'` 强制直连：

```bash
curl --noproxy '*' -o /dev/null -w '%{http_code}\n' https://www.google.com
# 200

curl --noproxy '*' -o /dev/null -w '%{http_code}\n' https://github.com
# 200
```

再看 DNS：

```bash
getent ahostsv4 www.google.com
# 198.18.0.7
```

`198.18.0.0/16` 是 fake-ip 段。客户端拿到假地址，直连它，路由器在转发链里接走。

路由器侧的 nft 规则：

```bash
nft list set inet nikki proxy_dport
# elements = { tcp . 0-65535, udp . 0-65535 }
```

关键规则是「目标不是 `198.18/16` 才 return」，反过来就是：**只要目标是 fake-ip，全端口都会被 redirect 到 mihomo**。

所以完整链路是：

```
DNS 被 hijack → 返回 198.18.x.x → 客户端直连假 IP
→ 路由器 nft 把全端口 redirect 到 mihomo → 出网
```

### 我之前错在哪

我看到的配置是：

```yaml
tun:
  auto-route: false
  auto-redirect: false
```

就以为「LAN 客户端不会被透明代理」。

实际上：

- `auto-route` 管的是**路由表注入**；
- `auto-redirect` 管的是 **tun 自己的重定向**；
- 真正让 LAN 流量进 mihomo 的，是 nft 的 `proxy_dport` + DNS hijack。

这是两套机制。把「tun 不接管」误读成「LAN 不走代理」，是整件事的起点错误。

## 五、还有一个小坑：拿 403 端点测延迟

排查过程中试过用 mihomo 的 API 测节点延迟：

```bash
curl 'http://127.0.0.1:9090/proxies/节点名/delay?url=...'
```

我拿的是：

```
https://generativelanguage.googleapis.com/v1beta/models
```

这个地址不带 key 会返回 403，而 mihomo 的 delay 接口只认 2xx，于是**所有节点都显示失败**。

差一点就把「全部节点不通」当成结论。后来换成 `generate_204` 才正常。

> 测通断用的 URL，本身必须是「不带参数也能返回 2xx」的。

另外，那一组「谷歌服务」当时选中的是一个美国节点，对 `generativelanguage.googleapis.com` 确实不通（TLS 直接被掐）。换成 URLTest 的「美国自动」就正常了。这一处和代理变量无关，是节点选择问题。

## 六、留下的判断

这件事之后，我给自己定了四条：

1. **先测「不用代理能不能通」**。`curl --noproxy '*'` 是一行命令，能省掉一整晚。
2. **不要在已经能用的兜底链路之上，再叠一层需要认证的代理**。出问题时两层都会看起来像坏了，排查成本翻倍。
3. **不要往全局 shell 环境里 export 带认证的 `HTTP(S)_PROXY`**。GUI 会继承，而 Firefox/Thunderbird 对 URL 里的账号密码支持很差。
4. **看到 `ECONNRESET` 先怀疑链路，不要先怀疑模型**。三个模型同时挂，基本可以排除单个服务的问题。

现在这台笔记本的代理设置是：**没有设置**。DNS 指路由器，剩下的交给 nft。

一条已经工作的透明代理，最好的状态就是让人忘记它的存在——包括忘记自己曾经想再配一层。
