---
title: 从零搭建我的 Hexo + Butterfly 博客
date: 2026-09-04 13:53:22
categories:
  - 开发
tags:
  - Hexo
  - Butterfly
  - GitHub
  - Cloudflare
---
# 为什么开始写博客

折腾 Linux、网络和各种软件已经有一段时间了。

很多时候，一个问题折腾了几个小时，好不容易解决，过几天却又忘记当时到底是怎么解决的。

所以我决定搭一个属于自己的博客，把这些折腾过程记录下来。

它不一定是多么正式的技术文章，也不一定每篇都有标准答案。只要把自己遇到的问题、尝试过的方法以及最后的结果记录下来，就已经有意义。

于是，这个博客就从这里开始了。

# 为什么选择 Hexo

我希望博客足够简单。

不需要自己维护复杂的后端，也不想把大量时间花在网站本身的开发上。写完 Markdown 之后能够直接生成静态网页，对我来说就已经足够了。

Hexo 正好符合这个需求。

文章使用 Markdown 编写，Hexo 负责把 Markdown 转换成静态网页，最后把生成的网站部署出去。

整个流程可以简单理解成：
```
Markdown
   ↓
Hexo
   ↓
静态 HTML / CSS / JS
   ↓
Cloudflare Pages
   ↓
博客网站
```
# 创建 Hexo 博客

首先准备 Node.js 和 npm。

然后创建 Hexo 项目：
```
hexo init blog
cd blog
npm install
```
创建完成后，可以先运行：
```
hexo server
```
然后打开：

http://localhost:4000/

如果能够看到 Hexo 默认页面，就说明基本环境已经正常。

# 开始配置自己的博客

默认主题肯定不是我想要的样子，所以接下来就是慢慢修改配置。我把一些常用页面也加了进去。

# 关于页面

创建：
```
source/about/index.md
```
内容大致就是介绍自己，以及这个博客主要记录什么。

比如我的页面：
```
---
title: 关于
date: 2026-09-04 12:50:00
---
```
你好，我是 tanghuang。

这里主要记录 Linux、网络、电脑折腾以及一些技术笔记。

# 分类

分类页面：
```
source/categories/index.md
```
然后指定：
```
---
title: 分类
date: 2026-09-04 13:00:00
type: categories
---
```
分类本身并不是在这个页面里一个个填写的，而是在文章中指定。

例如：
```
categories:
  - Linux
```
这样文章就会出现在 Linux 分类下面。

# 标签

标签和分类不太一样。

例如：
```
tags:
  - CachyOS
  - Niri
  - Wayland
```
分类更像是文章属于哪个栏目，而标签更像是文章涉及了哪些关键词。

# 友情链接

Butterfly 还支持友情链接页面。

我使用：
```
source/_data/link.yml
```
来保存友链数据，再创建：
```
source/links/index.md
```
并设置：
```
---
title: 友情链接
date: 2026-09-04 13:00:00
type: link
---
```
这样就可以让 Butterfly 自动读取友链数据。

# 写第一篇文章

Hexo 写文章非常简单。

直接执行：
```
hexo new post "新的人生从第一篇博客开始"
```
然后编辑生成的 Markdown 文件。

文章开头可以设置：
```
---
title: 新的人生从第一篇博客开始
date: 2026-09-04 11:15:25
categories:
  - 随笔
tags:
  - 思考
  - 独立博客
  - 写作
---
```
剩下的内容就是正常写 Markdown。

这也是我这个博客真正意义上的第一篇文章。

# 使用 Git 保存博客

为了避免电脑上的博客配置丢失，同时也方便以后部署，我把整个 Hexo 项目放进 Git 仓库。

每次修改完成后：
```
git add .
git commit -m "更新博客"
git push
```
这样修改就会被保存到 GitHub。

以后换电脑，也可以直接把仓库重新拉下来继续写。

# 使用 Cloudflare Pages 部署

博客的源代码放在 GitHub 后，再让 Cloudflare Pages 连接这个仓库。

这样就形成了：
```
本地电脑
   ↓
git push
   ↓
GitHub
   ↓
Cloudflare Pages
   ↓
自动构建
   ↓
博客上线
```
以后写完文章，只需要 push 到 Github 然后 Cloudflare Pages 就会自动进行构建和部署。

所以以后基本不需要手动上传网页文件。

# 以后怎么写博客

以后写新文章时，只需要：
```
hexo new post "文章标题"
```
编辑生成的 Markdown 文件。

写完以后可以先本地预览：
```
hexo server
```
确认没有问题后：
```
git add .
git commit -m "新增文章：文章标题"
git push
```
整个过程就完成了。

# 我想记录什么

这个博客以后主要会记录几类内容：

  - Linux 和桌面环境
  - CachyOS、Niri 等系统折腾
  - 网络和代理
  - OpenWrt、IPv6、Cloudflare 等
  - 编程和开发
  - 软件使用过程中遇到的问题
  - 一些随笔和思考

有时候可能是一篇完整的教程，有时候可能只是记录一个自己踩过的坑。

我觉得这没有什么关系。

博客最重要的意义，也许不是让所有人都看到，而是让未来的自己还能找到曾经走过的路。

# 总结

从安装 Hexo，到选择 Butterfly，再到配置页面、分类、标签、友情链接，最后把博客放到 GitHub 和 Cloudflare Pages 上，这个博客终于真正开始运行起来了。

以后这里会慢慢留下更多东西。

代码、折腾、问题、解决方案，以及一些不一定有答案的思考。
