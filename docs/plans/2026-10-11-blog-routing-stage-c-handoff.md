# 博客双线路阶段 C：主页禁用状态发布与验收

日期：2026-10-11（Asia/Shanghai）。主页阶段 C 已完成正式发布及两域定向验收。博客入口仍隐藏，生产 `BLOG_ROUTE_ENABLED = false`，没有隐藏测速流量。入口恢复由用户之后决定。

## 提交与发布

- 发布源码提交：`04f38218d0d7c7037a59f45924170a5456fbdbd2`，`feat: prepare disabled dual-route blog navigation`。
- 推送目标：现有私有仓库 `Darcy-1024/dcelysion-home` 的 `main`；`git push origin main` 成功，`git ls-remote` 确认远端为上述完整提交。
- 仅提交 Home.svelte、blog-route.ts、blog-route.test.ts、本地夹具脚本与阶段 B handoff；本交接文档以单独文档提交推送，未改变发布源码或重新部署。
- 项目没有 `.github` 自动部署链；Git 推送与 Cloudflare 发布分开完成。
- 既有 Wrangler 4.127.1 上传本地静态 `dist`：`versions upload --message '04f3821: disabled blog routing stage C' --keep-vars`。上传2个变化文件，68个资源已存在。
- 使用已连接的 Cloudflare 官方 MCP 创建正式 deployment，并读回最新 deployment 确认100%流量。没有修改 DNS、域名绑定、兼容日期或订阅。
- Worker：`dcelysion-home`；account：`25d4e6f2e01c0cde639588a28d13814d`。
- Version：`2907a3cf-e72b-457c-97e5-c3dcec7b44fb`（version 6）；deployment：`717844c5-05d8-4e19-9ac7-fbfd15325976`。
- 正式部署时间：`2026-10-11T14:49:59.219543Z`（北京时间22:49:59）。deployment annotation 引用完整源码提交；该 version 为100%流量。
- 自动审批最初拒绝推送，核实仓库为当前账号拥有 ADMIN 权限的私有仓库、读取协调对话后仍要求本对话直接授权。用户在本对话明确回复“授权推送和正式部署”后，推送与正式部署成功；没有剩余授权阻断。

## 两主页域线上验收

验收时间：`2026-10-11T14:52:12.156Z`（北京时间22:52:12）。Edge临时无头上下文、1280×900、reduced motion；没有拦截或替换主页/探针响应。

| 检查 | https://dcelysion.cn | https://home.dcelysion.cn |
| --- | --- | --- |
| 主页 HTTP | 200 | 200 |
| HTML 与本地发布产物 | 去掉唯一已知 Cloudflare analytics 注入后逐字相等 | 同左 |
| 全部5个生成 JS/CSS | 200，字节数与SHA-256全部匹配 | 同左 |
| Astro hydration | 完成，island ssr 标记已移除 | 同左 |
| 博客锚点、线路控件、两博客域链接 DOM | 0 | 0 |
| `/__route/probe-v1.bin` 浏览器请求 | 0 | 0 |
| 主标题、海报、Logo、头像 | 可见/图片成功加载，截图已检查 | 同左 |
| 音乐面板 | 真实点击打开、关闭成功 | 同左 |
| 应用 pageerror | 0 | 0 |

两域控制台各记录一次已有 `static.cloudflareinsights.com/beacon.min.js/...` 的 `ERR_TIMED_OUT`。请求失败记录唯一对应平台统计脚本；未发现本次引入的应用错误。不声称整个控制台完全无错误，不为此修改统计配置。

共同 HTML SHA-256（仅排除上述平台脚本）：`ebeb081c7c64593cf2bc7b6e84e2ae123ad8c991a2a8d8432c5632091e570f7e`。

| 文件 | 字节 | 两域共同 SHA-256 |
| --- | ---: | --- |
| client.Cj4vjyUA.js | 45041 | 6180009a13f3a5739ff68d7c683a4fea6eae0785e9ae08911cf6c8d39744b53c |
| client.svelte.Bpw2WbRM.js | 889 | 164a4ad72bdc35fa6aef3356b6be08f7a22ed00d2b1966eda5448b70d12e7843 |
| Home.C2dK3wXJ.js | 31992 | 361160e93ceb09ad3b8becd8306274db743c26bbf6b3eccb65b5a3527f128c75 |
| index.BIOGiBe4.css | 18222 | e983d76c88c71cb48139db7d84f43ca01ca18c55c9727f13042cca94eeeaf7df |
| music.DfL0jkx_.js | 5183 | 23bc83228b56ce787cdd62edbfb862880ec11aeab4601cd4d64309a9603f049e |

原始本地证据在忽略目录 `.validation/blog-route-c/live-result.json`，两域截图同目录；临时验收脚本 `.validation/verify-stage-c.mjs`。这些文件、dist 和原有未跟踪 `.tmp/` 均未提交。

## 复用与新增验证

复用阶段 B 的12项专项测试、Astro check（0 errors/warnings/hints）及六组本地浏览器夹具通过结果，不重复运行整套测试。阶段 C 新增源码/提交范围审查、`git diff --check` 和 staged diff 检查通过；用已安装 Astro CLI重新构建成功，以确保此次上传的dist来自审核源码；新增 Cloudflare 实际部署/100%流量回读、Git远端核验、两域线上产物比对及上述浏览器检查。

生产功能关闭，因此此次没有在线测得访客选路、EO阈值或开启态交互。开启态继续沿用 B 的本地受控证据；不能把本次线上零请求验收当成线上测速结果。没有扩展媒体播放/完整生命周期验收；媒体、天气、壁纸、音乐和动画源码逻辑未修改。

博客双端阶段 A 已上线同一公开产物，阶段 C 只读复用 `F:\DcElysion-blog\cache\release-a1398fb1-routes.json` 中的既有成功证据，最近验收提交 `a1398fb11606ac095ef69217e98a092c56c104a0`。探针32768字节、SHA-256 `9ab5674dfb044ce308d393fc756a895a5808b8651dc9b5c6c506886369559d26`。没有重复访问双端探针、重建/部署博客或更改博客仓库。B handoff 中“未提交/部署”是当阶段历史记录，本文件记录后续发布结果。

## 回退与后续恢复位置

发布前实际100% version：`93bcd849-bce2-4713-9913-ea8fae80a016`；此前 deployment：`3a6663a1-c419-4bb2-abd8-5df72f1066ad`。需要回退时，向该 Worker deployments API创建 `strategy: percentage`，versions为 `[{version_id: '93bcd849-bce2-4713-9913-ea8fae80a016', percentage: 100}]`；或使用项目 Wrangler 的显式 version rollback。回退后重新核验实际流量与公开产物，不动博客DNS、媒体或数据库。本阶段没有执行回退。发布前 Git HEAD：`0fdcf82d028d24af9bf024aadfed7cd935c1759c`，需要源码回退时用独立 revert 提交，勿覆盖任务外工作区。

用户未来恢复时同步修改两处：

1. `src/components/Home.svelte:325–336` 的 `BLOG_ENTRY_START` / `BLOG_ENTRY_END` 标记之间：只移除包围锚点与全部线路控件的那一对 `<!--` / `-->`，保留标记注释；入口和控件一起恢复。
2. `src/lib/blog-route.ts:2`：`BLOG_ROUTE_ENABLED = false` 改为 `true`。只开启开关会产生隐藏测速，实际恢复必须与入口一起修改；本次未执行这两步。

恢复时再按新改动完成 check/build、相应交互验证和发布授权。阶段 B 已描述会话隔离与显式重测规则；无需增加替代入口或自动跳转。

Sites、后台 MDX 构建/发布链、新收费、DNS迁移和账号订阅均不属于本次，未执行。现有暂停边界保持。
