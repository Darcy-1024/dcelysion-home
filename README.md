<div align="center">

<img src="public/assets/brand/dcelysion-portal-v3-dark.png" alt="DcElysion" width="260" />

# DcElysion Home

**东方未晞的个人主页 · 唯有那份炫目，未曾忘却**

一张会流动的壁纸，一首陪伴此刻的音乐，一个通往博客与日常的小小入口。

[访问主页](https://dcelysion.cn/) · [阅读博客](https://blog.dcelysion.cn/) · [开发与维护](docs/development.md)

![Astro](https://img.shields.io/badge/Astro-静态站点-BC52EE?logo=astro&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-交互组件-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-类型支持-3178C6?logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)

</div>

![DcElysion 桌面主页](docs/images/home-desktop.webp)

## 在这里，可以做什么

| | 体验 |
| --- | --- |
| 🌸 沉浸式首页 | 全屏动态壁纸、半透明玻璃面板、波纹头像和逐字简介，搭配 MiSans 与霞鹜文楷。 |
| 🖼️ 换个风景 | 一键切换随机壁纸，桌面与手机分别使用适合横屏、竖屏的图库。 |
| 🎵 听一首歌 | 打开歌单，选择曲目、拖动进度、调整音量；支持列表循环、随机播放和单曲循环。 |
| 🌤️ 看看天气 | 查看天气、温度、湿度和风况；支持手动查城市，问候与时钟跟随设备时间。 |
| ✨ 认识站长 | 个人介绍、QQ、邮箱、哔哩哔哩和博客入口，集中在一页。 |
| 📱 随手打开 | 桌面与手机自适应布局，移动端面板从底部展开。 |

## 音乐，让页面多一点陪伴

播放器按需加载，不会自动播放。打开歌单即可选曲，收起面板后仍可继续聆听；音量与播放模式会记住上一次的偏好。

![音乐面板与歌单](docs/images/music-desktop.webp)

## 天气与此刻

天气面板支持自动估算城市，也可以手动查询。问候与时钟使用设备时间，切换天气城市不会改变它们。

![天气面板：手动查询北京](docs/images/weather-desktop.webp)

## 小屏幕，也有完整的体验

竖屏壁纸、紧凑的个人卡片和底部音乐面板，让手机上也能轻松浏览、换图与选歌。

<p align="center">
  <img src="docs/images/home-mobile.webp" alt="手机端主页" width="320" />
  &nbsp;
  <img src="docs/images/music-mobile.webp" alt="手机端音乐面板" width="320" />
</p>

> 截图来自 2026-11-17 的在线页面。天气、时钟与动态壁纸会随访问时刻变化；天气示例使用手动查询的北京。

## 实现上的小细节

- **独立的静态站点**：Astro 构建页面，Svelte 负责交互，不需要登录系统、数据库或自建后端。日常开发不依赖博客仓库。
- **按需加载**：音乐模块延迟加载，字体按字符范围分包；媒体预取考虑页面可见性与省流偏好。
- **稳妥的降级**：动态壁纸无法播放时显示海报；天气请求失败时保留可用缓存或提供重试，不阻断其他功能。
- **键盘与动效支持**：面板支持 Esc 关闭、焦点返回与 Tab 焦点限制，响应减少动态效果偏好。
- **博客线路选择**：为博客入口探测候选线路，失败时保留默认地址；不自动跳转页面。

## 本地运行

需要 **Node.js ≥ 22.23.0** 与 Corepack；包管理器版本固定为 **pnpm 11.22.0**。

```sh
git clone https://github.com/Darcy-1024/dcelysion-home.git
cd dcelysion-home
corepack pnpm install --frozen-lockfile
corepack pnpm dev --port 4322
```

打开 [localhost:4322](http://localhost:4322/)。

| 命令 | 用途 |
| --- | --- |
| `corepack pnpm check` | Astro 与 TypeScript 检查 |
| `corepack pnpm test` | 天气、音乐、媒体与博客选路等专项测试 |
| `corepack pnpm build` | 生成 `dist/` 静态文件 |
| `corepack pnpm preview --port 4323` | 预览构建结果 |

## 换成自己的主页

主要内容集中在 [`src/data/home.json`](src/data/home.json)，可修改显示名、简介、头像、社交链接、博客地址、壁纸和歌单。

```text
src/
├── components/       页面与交互组件
├── data/home.json    个人资料、壁纸与音乐配置
├── lib/              天气、音乐、媒体加载、问候与博客选路
├── pages/            Astro 页面入口
└── styles/           全局样式与字体分包声明
public/assets/        图片、字体、品牌与海报资源
scripts/              资料同步、字体处理与浏览器验证
docs/                 开发说明与历史记录
```

复用时请替换个人联系方式、品牌图片、备案信息、媒体地址及博客线路配置，并使用自己有权发布的素材。名称使用的文楷为字体子集，增加字符时请参考[字体维护说明](docs/development.md#字体与验收维护)。

### 部署

产物为 `dist/`，可托管到支持静态文件的平台。本项目使用 Cloudflare Workers 静态资源：先将 [`wrangler.jsonc`](wrangler.jsonc) 中的 Worker 名称和域名改为自己的配置，再登录并部署。

```sh
corepack pnpm exec wrangler login
corepack pnpm deploy
```

域名及静态站点地址还需同步调整 [`astro.config.mjs`](astro.config.mjs)。Git 推送与线上部署是独立步骤。博客资料同步、媒体加载策略、浏览器回归与历史验证见[开发与维护指南](docs/development.md)。

## 数据与素材说明

天气由访客浏览器请求第三方服务，自动城市按网络出口 IP 估算，不请求设备精确位置权限。音频、封面和动态壁纸会请求配置的媒体域名；可用性与加载速度取决于对应服务和网络。邮箱的 Base64 编码仅用于展示处理，不是加密。

MiSans 与霞鹜文楷的许可文件随资源保留。图片、头像、壁纸、音乐和其他第三方素材的权利属于各自权利人；仓库公开不表示这些素材获准自由再分发或商用。本仓库尚未设置统一的开源许可证，公开可见不等于授予任意使用许可。详见[素材与许可说明](docs/ASSETS.md)。
