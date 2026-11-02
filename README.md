# Tang's Blog

一个写在信纸上的技术博客：Linux、CachyOS、网络与折腾。

- 站点：<https://blog.tanghuang.dpdns.org/>
- 生成器：Hugo（0.147.x）
- 主题：[`cyjx007/hugo-theme-epistle`](https://github.com/cyjx007/hugo-theme-epistle)（`themes/epistle/` 是它的同步副本）
- 托管：Cloudflare Pages（`main` 分支推送即构建）

## 目录

```
content/
  posts/          每篇文章 = 一封信（含 _index.md 作为「信匣」页）
  about.md        关于
  links.md        友情链接
themes/epistle/   主题（从 fork 同步，勿直接改）
hugo.toml         站点配置
```

## 写一封新信

```bash
hugo new posts/2026-11-02-某件事.md
```

Front matter：

```yaml
---
title: "标题"
date: 2026-11-02T21:00:00+08:00
draft: false
slug: "标题"          # 决定 /posts/<slug>/，中文也可以
salutation: "见字如面，"   # 可选
postscript: "又及：……"     # 可选
tags: ["Linux"]
categories: ["折腾"]
---
```

超过 600 字会自动叠三折；纸色墨色按 `date` 自动算，不用管。

## 本地预览

```bash
hugo server --port 1313
```

## 构建

```bash
hugo --gc --minify
```

Cloudflare Pages 的构建命令就是 `hugo --gc --minify`，输出目录 `public`。

## 两个注意点

1. **URL 不要变**：`hugo.toml` 里 `disablePathToLower = true` + 每篇写死 `slug`，是为了保住 Hexo 时代的
   `/posts/<原文件名>/` 旧链接。删掉 `slug` 会让 URL 变小写、旧链接 404。
2. **主题改动在 fork 里做**：改完 `hugo-theme-epistle` 仓库后，把 `layouts/`、`static/` 覆盖到
   `themes/epistle/`，一起提交。不要只改 `themes/epistle/`，否则 fork 会落后。
