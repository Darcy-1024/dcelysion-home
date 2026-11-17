# 博客双域选路阶段 B 本地交接

日期：2026-10-11（Asia/Shanghai）。执行范围：主页本地实现、验证和交接；没有提交、推送、部署、恢复入口、改变 DNS/账户或执行 Sites。博客仓库只读。实施前主页 `git status --short` 仅有原有未跟踪 `.tmp/`，该目录未修改；本仓库及 F:\ 根目录没有 AGENTS.md，遵循任务提供的个人协作指令。

## 交付状态

阶段 B 本地实现和验证完成。生产 `BLOG_ROUTE_ENABLED = false`，“进入博客”原注释入口继续隐藏；线路控件在同一个注释块内，没有新增替代入口。主页不会自动跳转。壁纸、音乐、天气、动画、媒体 URL 和媒体存储/生命周期代码未修改。

阶段 A 早期 handoff 的“未发布/探针404”是历史记录。本阶段按启动任务提供的后续发布结果，使用 a1398fb11606ac095ef69217e98a092c56c104a0 的双端同产物输入；只读核对了博客 `cache/release-a1398fb1-routes.json` 中已有成功探针证据，未重复线上验收。后台 MDX 发布链仍暂停，Sites 未启用。阶段 B 的浏览器证据是本地夹具，不是新的生产验收。

## 文件与行为

- `src/lib/blog-route.ts`：独立模块、固定白名单 origin、探针验证、选择规则、会话状态和浏览器单例。
- `src/components/Home.svelte`：默认 href 数据、onMount 订阅和卸载释放、隐藏入口与真实手动控件接线。未安装博客锚点点击处理器；使用普通 `<a target="_blank" rel="noopener noreferrer">`。
- `src/lib/blog-route.test.ts`：12 项专项测试，包括多种失败子场景。
- `scripts/verify-blog-route-browser.mjs`：本地浏览器夹具。仅在 esbuild 内存编译时移除入口注释并启用开关，输出到已忽略的 `.validation/blog-route-b/`；正式源码默认配置不变。脚本不被 src/pages 导入，生产 dist 不引用夹具。

默认 Cloudflare `https://blog.dcelysion.cn/`，候选 EdgeOne `https://blog-eo.dcelysion.cn/`。每端固定 `GET /__route/probe-v1.bin`，完整 32768 字节，SHA-256 `9ab5674dfb044ce308d393fc756a895a5808b8651dc9b5c6c506886369559d26`。无随机 query、无 no-cors；`credentials: omit`、`redirect: error`、`cache: no-store`。

响应必须 200、application/octet-stream（允许 MIME 参数）、未压缩；存在 Content-Length 时必须精确匹配。流读取至 EOF 才结束计时，累计上限 32768，长/短/错误 hash 均失败；异常正文取消读取。hash 不计入测速耗时，但仍受整轮截止约束。

两端同时启动，共用 2500ms 截止。到截止只取消尚未完成正文的请求，立即使用已经 hash 验证成功的结果；未结束 hash 的侧视作本轮失败，晚到结果不能更新选择。两端成功时 EO 耗时 <= CF 的80%才选 EO；单端成功选该端，双失败保留 CF。网络恢复、可见性变化不会重测。

会话键 `dcelysion.blog-route.v1`，组合契约/配置版本 `probe-v1-32k-policy-v1`。保存 auto/manual、source、automaticSource、pending/ready 和 measured；只读取合法白名单 source，不读取缓存 URL。配置版本不同或非法记录失效。旧 pending 刷新降级 CF 并消费自动尝试，必须显式重测。读写存储异常退化到同窗口内存。根域/home 域、不同标签或博客两域之间不共享 sessionStorage。

一个浏览器模块单例持有订阅和轮次；重复挂载仅一轮，最后订阅卸载才清定时器和请求。手动选择和重测使旧 generation 失效；迟到正文/hash 不能覆盖手动结果或新轮次。选择“自动”复用最后自动推荐，不隐式发起新测速；“重新测速”明确回到 auto 并启动新轮。挂载后的自动任务在后续任务中开始，不卡住同步渲染或视频启动。

## 本地验证

| 检查 | 真实结果 |
| --- | --- |
| `node --import tsx --test src/lib/blog-route.test.ts` | 12/12 通过；20%边界、单侧失败/超时、双失败、状态/MIME/hash/短长/压缩响应、缺EOF、完整流计时/hash排除、整轮hash截止、存储读写异常、旧pending/版本失效、重复挂载/最后卸载、手动/重测竞态、生产disabled |
| `node_modules/.bin/astro.cmd check` | 0 errors / 0 warnings / 0 hints |
| `node_modules/.bin/astro.cmd build` | 成功，1页静态构建；未部署 |
| `git diff --check` | 通过；Windows Git 的 LF→CRLF 提示不是校验失败 |
| 浏览器夹具（已安装 Edge，无头临时独立上下文） | 下列6组通过；浏览器 pageerror 0 |

浏览器结果 `.validation/blog-route-b/browser-result.json`，截图 `.validation/blog-route-b/fixture.png`，均为忽略的本地证据。六组：

1. 在探针完成前点击原锚点，立即以默认 CF 打开新标签。
2. 从 4390 端口主页向 4391/4392 两个不同 origin 真实跨域读取；无 Cookie、带实际 Origin，完整字节和 SHA-256 通过；EO 优势达到阈值后更新 href，一轮恰好两请求。
3. Cloudflare/自动按钮真实更新 href 与 aria-pressed，自动复用不发新请求；Enter、中键、Ctrl 点击正确打开新标签。
4. 显式重测期间手动选 CF，旧结果不能覆盖；刷新复用该手动选择。
5. 移除两个本地服务的 CORS 头后，浏览器真实拒绝读取，双失败降级 CF；没有 no-cors 绕过。
6. 读取正式 dist 并确认 hydration 已完成：博客入口/控件 DOM 数为0、probe 请求数为0、无夹具脚本引用。

夹具将固定生产探针 URL 在测试 fetch 包装中映射到本地服务；未访问真实生产探针。媒体/天气外部请求在夹具浏览器中阻断以避免无关流量；此夹具不作为媒体播放验收，既有媒体通过证据复用而未重跑无关测试。

可复现命令（工作目录 F:\DcElysion-home；无需新依赖）：

```powershell
node --import tsx --test src/lib/blog-route.test.ts
& .\node_modules\.bin\astro.cmd check
& .\node_modules\.bin\astro.cmd build
$env:BLOG_ROUTE_BROWSER_RUNTIME = '<已安装的 Playwright 运行时目录>'
node scripts/verify-blog-route-browser.mjs
git diff --check
```

环境过程：Corepack 尝试下载项目 pnpm 时 DNS ENOTFOUND，改用已安装项目 Astro CLI 完成同等 check/build；首次测试夹具样本错误，按阶段 A 公开计数器 SHA-256 样本修正，最终契约测试通过；TypedArray 测试类型错误已修复。沙箱中的 Edge 子进程启动失败，通过自动审批在正常 Windows 权限执行同一脚本；中键标签没有触发 page popup 事件，改为监听 browser context 的 page 事件后验证通过。没有安装浏览器或修改系统设置。

## 精确恢复位置（留给用户后续操作）

1. `src/components/Home.svelte` 的 `BLOG_ENTRY_START` 到 `BLOG_ENTRY_END` 标记之间（当前约325–336行）：只删除包围 `<a>` 与 `.blog-route-controls` 的一对 `<!--` / `-->`，保留标记说明。整个入口和控件一起恢复，不只恢复单个按钮。锚点已经用 `href={blogUrl}`，按钮已经调用同一个 blogRouter，无需另写点击逻辑。
2. `src/lib/blog-route.ts:2`：把 `BLOG_ROUTE_ENABLED = false` 改为 `true` 才允许探测。仅取消注释不会自动开流量；仅打开开关会产生隐藏后台测速，因此实际恢复时两项同步更改。
3. 仍以用户恢复入口的决定为准。本阶段不代为执行上述两步；恢复后运行 check/build 和对应本地交互验证，按另行授权提交/发布。旧会话已经 ready/pending降级时，开关开启不会强制重新测速；可显式“重新测速”或使用新标签验证首次一轮。

若更换任何端点/样本/策略，更新白名单、契约常量和 `BLOG_ROUTE_VERSION`，补相应证据；不得直接把缓存 URL 作为可导航地址。

## 限制和下一阶段输入

- 本阶段只有本地结果，主页线上尚未包含这些改动。Git发布和平台部署需要后续授权。
- 两端可用性输入复用 a1398fb1 既有证据，未重复实测当前互联网延迟；本地延迟是受控值，不能作为访客实际快慢或费用估算。
- JS关闭时，恢复后的锚点仍以SSR Cloudflare href导航；当前继续隐藏，没有新增 noscript 入口。实际浏览器验证覆盖JS开启的正式hydration和夹具交互，未另跑整页JS关闭验收。
- 两端最多约64KiB正常响应体/轮；失败端在读流中限制接受量，不承诺网络栈在取消前绝无额外传输。测得值只用于当前标签之后的点击，无法保证目标之后始终更快或可达。
- 当前只支持博客首页 href，不支持传入任意路径或外部目标；不修改博客地址栏、已开标签或大媒体线路。
- 下一阶段需用户决定入口恢复时间，并携带此handoff、阶段A最终发布证据及届时双端版本/探针状态。后台MDX链、Sites、DNS迁移、新收费继续保持各自边界。
