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
scripts/          写稿 / 发布 / 预览 的脚本
写新信.cmd        双击 → 输入标题 → 记事本打开
发布.cmd          双击 → 构建检查 → 提交 → 推送 → 等上线
预览.cmd          双击 → 本地 http://127.0.0.1:1313
themes/epistle/   主题（从 fork 同步，勿直接改）
hugo.toml         站点配置
```

## 写一封信（最简单的方式）

**双击 `写新信.cmd`**，输入标题，回车。脚本会：

1. 在 `content/posts/` 生成 `标题.md`，front matter 都填好（日期、slug、草稿状态）
2. 告诉你上线后的地址
3. 用记事本打开它

写完存盘，再**双击 `发布.cmd`**：先本地构建一遍（YAML 写错会拦住），然后提交、推送，
最后盯着 Cloudflare 部署，成功了会把网址打出来。

想在本地先看效果就双击 `预览.cmd`。

### 也可以敲命令

```powershell
.\scripts\new-post.ps1 "标题" -Tags "Linux,Hugo" -Salutation "见字如面，"
.\scripts\publish.ps1
.\scripts\preview.ps1
```

Front matter 长这样（`new-post.ps1` 自动生成）：

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

### 不装任何东西：在浏览器里写

打开 <https://github.com/cyjx007/blog/new/main/content/posts>，文件名写 `标题.md`，
把上面的 front matter 粘进去，提交（Commit changes）。Cloudflare 会自己构建。
适合改错字、补一句话这种小修改。

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
