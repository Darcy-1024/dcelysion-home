# 媒体加载优化本地验收记录

日期：2026-10-09。仅本地实现与验证，未提交、推送、部署；未运行 sync:blog，未修改博客或 Cloudflare。保留了执行前 Home.svelte 的循环打字机和时间显示改动，以及 global.css 的按钮边框改动。

## 文件与行为

- src/components/Home.svelte：响应式海报、立即启动视频、可见性/省流/减少动态生命周期、候选图片复用、音乐动态导入与禁用/重试状态。
- src/lib/media.ts / media.test.ts：可取消 load 后 idle、固定图片候选、可清理视频监听和播放竞态。
- src/lib/music.ts / music.test.ts：首曲/封面不播放预载、20秒/5秒下一曲预取、受控备用提升、模式/错误/版本隔离。
- src/styles/global.css：只添加视频出画面显隐规则，保留原样式编辑。
- README.md：同步实际策略及 preload 可能完整下载 FLAC 的取舍。
- docs/plans/2026-10-09-media-lazy-loading.md：合并追加修订，移除旧冲突策略。

## 本地命令

最终 corepack pnpm check：0 errors / 0 warnings / 0 hints。
corepack pnpm test：41/41；音乐24项、媒体5项、天气8项、问候4项。
corepack pnpm build：通过，纯静态输出。git diff --check：通过（仅 Git 的 LF/CRLF 工作区提示）。
沙箱 Corepack 无法解析 registry.npmjs.org；同命令在正常权限环境执行成功，未归因于源码。

## 生产预览实测

地址 http://127.0.0.1:4323/，使用 Codex 内置浏览器；Edge 扩展连接报告 nodeRepl.fetch request failed，未继续重复该连接。

- 1280×720：desktop 海报 currentSrc 为 /assets/wallpapers/elysia-desktop.webp；视频 desktop/elysia-gate-2560x1344.mp4，muted=true、paused=false、readyState=4、currentTime=11.307697；无横向溢出。
- 打开面板前，浏览器资源库存观察到独立 music.*.js、一个 d12.avif 随机候选、首曲 hane FLAC 及封面；面板首次打开显示等待播放、0:00 / 3:27。生产 HTML 无 music 模块提前 modulepreload。
- 点击首曲播放后显示正在播放；关闭（Esc）返回入口焦点，重开进度为12.3秒且继续播放。
- 通过原进度条跳到3:05，随后接近末尾观察到 touhou-suimusou 音频和封面请求；羽根仍显示正在播放，进度206.7秒。自然结束后東方萃夢想显示正在播放、进度2.9秒、时长5:38，消费同一预取曲目。
- 换壁纸后展示已预取的 DesktopWallpaper/d12.avif，video DOM数量为0；随后只安排一个新候选。
- 390×844刷新：仅移动海报有 resource 标记，mobile/elysia-gate-952x1344.mp4 静音播放（readyState=4、paused=false）。移动随机候选为 MobileWallpaper/m26.avif；无桌面视频/海报 resource 标记，无横向溢出。
- 640px仍用移动资源，641px切到桌面资源；旧视频释放。最终构建又核对了手机对应视频、首曲初始不播放和实际点击播放。
- Shift+Tab由面板关闭按钮回到music-volume；Tab返回关闭按钮。Esc/关闭后背景恢复交互与入口焦点。
- 最终手机播放截图：docs/media-preview-mobile.png。

## 证据限制

- 内置浏览器的只读DOM接口不提供 performance 时间线（performance 未定义），也未暴露清缓存/网络拦截；资源库存有实际 resource 来源，但不包含HTTP状态、Range次数、传输字节或开始时刻。因此未声称严格冷缓存、视频请求早于load的实测时间线或每种媒体只有一条HTTP请求。立即启动通过实现路径及假视频测试验证。
- 隐藏/saveData恢复、背景失败、迟到媒体事件、未完成候选提升、随机固定候选和单曲复用主要由模拟状态机测试覆盖；系统 reduced motion 和真实后台切换未实机操纵。
- 模块网络失败重试、视频真实自动播放拒绝与加载失败未做浏览器故障注入。模块并发Promise与卸载guard经源码核对，未宣称独立故障注入测试通过。
- 浏览器真实音频证据为播放事件驱动UI和增长的播放进度，不是人工听音；双音频数量/仅一个实际播放由FakeAudio身份与竞态测试验证。
- preload=auto可下载完整下一曲，取消无法撤销已传输字节；不承诺无缝播放。
