<div align="center">

<img src="public/assets/brand/dcelysion-portal-v3-dark.png" alt="DcElysion" width="260" />

# DcElysion Home

**东方未晞的个人主页 · 唯有那份炫目，未曾忘却**

通往博客与日常足迹的门户——路过时，也可以换张风景、听一首歌。

[访问主页](https://dcelysion.cn/) · [阅读博客](https://blog.dcelysion.cn/) · [开发与维护](docs/development.md) · **简体中文** / [English](README.en.md)

![Astro](https://img.shields.io/badge/Astro-静态站点-BC52EE?logo=astro&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-交互组件-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-类型支持-3178C6?logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
[![License: MIT (code)](https://img.shields.io/badge/代码许可-MIT-2EA44F)](LICENSE)

</div>

![DcElysion 桌面主页](docs/images/home-desktop.webp)
*打开主页时的全屏动态壁纸与个人卡片*

---

## 不仅仅是一块指路牌

很多人点进个人主页，往往只是为了找一个去往博客或社交账号的链接。

但在做 **DcElysion Home** 的时候，我总觉得它不该只是一块冷冰冰的“路牌”。在顺着卡片去往博客、哔哩哔哩，或是通过 QQ 与邮箱联系我之前，如果有人愿意在这里多停留几分钟——看一会儿随时间变化的问候语与动态壁纸，查一查窗外的天气，或者点开歌单听完一首歌——这个页面才算真正有了温度。

## 留白处的陪伴：壁纸、音乐与此刻

打开主页，最先铺开的是全屏动态壁纸。如果看腻了当前这一张，随手点一下切换，就能从横屏或竖屏图库里随机换一片风景。

页面里的音乐默认是安静的，绝不会在刚点进来时突然出声打扰。只有当你主动展开歌单、挑中喜欢的曲子，它才会在后台静静播放——哪怕收起面板去逛别的角落，音乐也不会中断。至于你偏爱单曲循环还是随机播放、习惯多大的音量，播放器都会默默记住，留到你下次再来。

![音乐面板与歌单](docs/images/music-desktop.webp)
*选好歌后收起面板，音乐依然会在背景里静静陪伴*

天气面板也遵循着同样的“不打扰”原则。它只根据网络出口 IP 大致估算你所在的城市，不需要索取任何精确定位权限。你当然也可以手动去查远方另一座城市的阴晴风况，不过主页上的时钟与问候语，始终会守着你设备所在的本地时间。

![天气面板：手动查询北京](docs/images/weather-desktop.webp)
*无需定位权限的天气面板，也可以随时看看远方城市的阴晴*

如果是用手机点进来，主页会自动换上专门为竖屏挑选的壁纸。轻点底部的音乐入口，歌单便会从屏幕下沿柔和地滑出；随手收起，视线又会重新回到个人卡片上。

<p align="center">
  <img src="docs/images/home-mobile.webp" alt="手机端主页" width="45%" />
  &nbsp;&nbsp;
  <img src="docs/images/music-mobile.webp" alt="手机端音乐面板" width="45%" />
</p>
<p align="center"><em>专为竖屏挑选的壁纸与底部抽屉式歌单（截图摄于 2026-11-17 在线页面）</em></p>

---

## 藏在背后的克制与工程细节

虽然从视觉上看有不少动态壁纸、音频与中文字体，但这个主页在底层其实做得很轻：

- **纯粹的静态架构**：由 Astro 构建页面骨架、Svelte 处理交互组件，彻底剥离了数据库、登录系统与自建后端，日常开发与维护也完全独立于博客仓库。
- **按需加载与省流感知**：音乐模块直到页面空闲或你第一次点开歌单时才会请求；字体按字符范围切分；音视频与封面的预取都会主动照顾页面的可见性与浏览器的省流偏好（Data Saver）。
- **哪怕网络不好也依然体面**：动态壁纸无法播放时会自动退回静态海报；天气接口请求失败时会保留上一次的可用缓存并提供重试，绝不牵连其他功能。至于去往博客的入口，页面会在后台探测候选线路，失败了也只是安稳地留在默认地址，不会擅自替访客跳转页面。
- **照顾键盘与动效偏好**：所有弹出面板都支持 `Esc` 关闭、焦点返回与 `Tab` 焦点锁定；如果系统开启了“减少动态效果（`prefers-reduced-motion`）”，页面也会随之收敛动效。

### 首屏有多轻

首屏核心代码（HTML + CSS + JS）加起来仅 **~46 KB**（gzip），配合按需分包的中文字体，冷启动几乎无感：

| 资源 | 传输体积（gzip） | 说明 |
| :--- | :--- | :--- |
| **HTML** | 约 6 KB | 单页静态输出 |
| **JavaScript** | 约 31 KB | Svelte 运行时与主页组件 |
| **CSS** | 约 9 KB | 全局样式 |
| **音乐模块** | 约 2 KB | 页面加载后空闲时，或首次打开歌单时才按需请求 |
| **字体** | 约 117 KB | MiSans 常用包 112 KB + 霞鹜文楷子集 5 KB（完整 MiSans 共 8.93 MiB、切分为 46 个分包，仅下载当前用到的部分） |

<sub>*注：以上数据来自 2026-11-19 本地 `pnpm build` 构建产物的 gzip 估算，不含壁纸、头像、Logo 等图片与视频流。*</sub>

---

## 本地运行与开发

环境需要 **Node.js ≥ 22.23.0** 与 Corepack，包管理器版本固定为 **pnpm 11.22.0**。

```sh
git clone https://github.com/Darcy-1024/dcelysion-home.git
cd dcelysion-home
corepack pnpm install --frozen-lockfile
corepack pnpm dev --port 4322
```

启动后打开 [http://localhost:4322/](http://localhost:4322/) 即可预览。日常维护常用命令如下：

| 命令 | 用途 |
| :--- | :--- |
| `corepack pnpm check` | 运行 Astro 与 TypeScript 类型检查 |
| `corepack pnpm test` | 运行天气、音乐、媒体与博客选路等专项测试 |
| `corepack pnpm build` | 生成 `dist/` 生产环境静态文件 |
| `corepack pnpm preview --port 4323` | 在本地预览构建结果 |

### 目录结构

```text
dcelysion-home/
├─ src/
│  ├─ pages/index.astro        # 页面入口与 <head> 元信息
│  ├─ components/
│  │  ├─ Home.svelte           # 主页核心界面与交互：壁纸、个人卡片、天气与音乐面板
│  │  ├─ AlbumCover.svelte     # 专辑封面组件（缺图时优雅降级为占位图）
│  │  └─ Icon.svelte           # 图标组件
│  ├─ lib/                     # 天气、音乐、媒体、问候语、博客选路等逻辑（含 *.test.ts 测试）
│  ├─ data/home.json           # ← 个人资料、社交链接、壁纸与歌单配置都在这里
│  └─ styles/                  # 全局样式；misans.css 为字体分包自动生成文件
├─ public/assets/              # 壁纸、头像、字体与品牌图（个人与第三方素材，不随 MIT 授权）
├─ scripts/                    # 博客资料同步、字体分包与浏览器回归脚本
├─ resources/fonts/            # MiSans 源字体，不进入最终构建产物
└─ docs/                       # 开发指南、素材说明、页面截图与维护记录
```

---

## 换成你自己的主页

如果你想基于这套代码搭建自己的个人主页，主要只需改动以下几处：

1. **个人资料与媒体清单**：编辑 [`src/data/home.json`](src/data/home.json)，替换显示名、简介、头像、社交链接、博客候选地址、壁纸与歌单。
2. **站点域名与部署配置**：同步修改 [`astro.config.mjs`](astro.config.mjs) 中的站点地址，以及 [`wrangler.jsonc`](wrangler.jsonc) 中的 Cloudflare Worker 名称与自定义域名。
3. **品牌素材与字体子集**：替换 `public/assets/` 下的个人品牌图、备案信息与媒体文件；由于显示名使用的霞鹜文楷为按需提取的字体子集，修改名字字符后请参考[字体维护说明](docs/development.md#字体与验收维护)重新生成。

### 部署上线

构建产物位于 `dist/`，可以托管到任何支持静态文件的平台。本项目使用 Cloudflare Workers 静态资源托管，改好配置后登录并部署即可（Git 推送与线上部署相互独立）：

```sh
corepack pnpm exec wrangler login
corepack pnpm deploy
```

关于博客资料同步、媒体加载策略、浏览器回归测试的更多细节，可以查阅[开发与维护指南](docs/development.md)。

---

## 数据、素材与许可边界

天气数据由访客浏览器直接请求第三方接口，自动城市仅按网络出口 IP 估算，不申请设备精确定位权限；音频、封面与动态壁纸加载自所配置的媒体域名；页面中邮箱的 Base64 编码仅用于前端展示防抓取，并非加密。

> [!IMPORTANT]
> **源代码**以 [MIT License](LICENSE) 开源，你可以自由使用、修改和分发代码本身。
> **仓库内的素材不在 MIT 许可范围内**：MiSans 与霞鹜文楷字体遵循各自随附的开源字体许可；头像、Logo、壁纸、音乐及其他第三方素材的权利归各自权利人所有，仓库公开不代表这些素材获准自由再分发或商用。Fork 或复用时请务必替换为你自己有权发布的素材，具体范围见[素材与许可说明](docs/ASSETS.md)。
