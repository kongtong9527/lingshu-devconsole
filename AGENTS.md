# DevConsole 开发准则

DevConsole 是灵枢的可视化调试台（React + Fastify）。本文件是 **DevConsole 宿主侧** 行为约定与已知问题的索引——「宿主如何消费插件返回的数据」这类与 DevConsole 实现强相关、而与单个 `.plugin.js` 无关的内容，细节均拆分在 `devconsole/docs/`：**本文件只保留一行红线摘要，踩坑全文进对应文档**（分层原则见 `docs/adr/0034-agent-docs-split-structure.md`）。

> 插件侧（`.plugin.js`）的问题与约定见 `<项目根目录>/lingshu-skills/lingshu-plugin-dev/SKILL.md`，不要写回这里。

## 工具自迭代原则

当 DevConsole 无法满足插件调试需求时，按根 `AGENTS.md`「工具自迭代优化」原则，**允许且应当直接优化 DevConsole**（不要通过改插件来绕过宿主缺陷）。

## 文档索引

| 主题 | 文档 |
| --- | --- |
| 预览导航联动 / listings 目录页·导航树·探索页 / episodes 块与 play | [`devconsole/docs/preview-navigation.md`](docs/preview-navigation.md) |
| 列表项卡片 DSL 预览（ADR-0050） | [`devconsole/docs/card-dsl.md`](docs/card-dsl.md) |
| HLS 播放链路 / Cloudflare 挑战 / canPlayType 优先级 / 清晰度切换（ADR-0029） | [`devconsole/docs/video-playback.md`](docs/video-playback.md) |
| 账号面板（ADR-0005）/ `$lib.ui` 直问用户桥（ADR-0006） | [`devconsole/docs/interaction.md`](docs/interaction.md) |
| 桌面浏览器通道 / headed sidecar / 可见手过（ADR-0045） | [`devconsole/docs/browser-channel.md`](docs/browser-channel.md) |
| 构建与类型检查 / 契约类型来自 runtime `dist` / **插件目录解析（`pluginsDir()`）** / 测试夹具 `caps()` | [`devconsole/docs/build-and-typecheck.md`](docs/build-and-typecheck.md) |
| 图片渲染三态（`LazyImage`，由 CONTEXT.md 词条平移） | [`devconsole/docs/rendering.md`](docs/rendering.md) |

## 红线速查

### 构建与类型检查（详见 `docs/build-and-typecheck.md`）

- **类型检查不在 `test` 里（勿只看测试全绿）**：`vite`/`vitest` 都走 esbuild、不做类型检查；新增 `Capabilities`/`Selected` 等必填字段漏了照样跑绿（2026-10：40 条基线错误静默存在）。`npm run -w devconsole typecheck` 会**先构建 runtime**（契约类型来自 `@lingshu/runtime` 的 `dist`，见 [`runtime/docs/program-api.md`](../runtime/docs/program-api.md)）再查前端 + BFF，已前置进 `build`；测试夹具的能力集一律用 `src/__tests__/fixtures.ts` 的 `caps({...})`，勿手写全字段字面量。
- **插件目录禁回退 monorepo 相对路径（勿回退）**：解析统一走 `server/src/plugin-service.ts` 的 `pluginsDir()`（`?dir=` / `--plugins-dir` / `LINGSHU_PLUGINS_DIR` / `<cwd>/plugins` 依次取第一个存在的）；母仓用符号链接 `devconsole/plugins → ../lingshu-plugins`（已 gitignore、发布不带），测试缺语料整组 `skipIf` 跳过（母仓 CI 设 `LINGSHU_REQUIRE_PLUGIN_CORPUS=1` 变硬失败，详见 `docs/build-and-typecheck.md`）。

### 预览导航与块渲染（详见 `docs/preview-navigation.md`）

- **列表项卡片 DSL 预览（ADR-0050，勿回退）**：有 card 走 `CardPreview` 布局预览，无卡走老行；未知节点跳过、根非法整卡回退（**判定必须 import `@lingshu/runtime` 的 `shouldFallbackCard`，禁自写副本**——曾三端口径不一，未知 root 一处回退一处渲空卡，由 `contracts/conformance/card-root.json` 抓出）；节点点击无 target 冒泡整卡、有显式 target 拦截（invoke 留桩禁用+warn，actionBar 跟整卡，写侧 target 预览内无动作不炸——写侧验证走 runtime/iOS，勿在预览补调写侧，详见 `docs/card-dsl.md`）。
- **DSL 图片填充/定比必须与 iOS 同构（勿回退）**：`image.resizeMode` 缺省与非法值一律 `cover`、只有 `'contain'` 判等；图元素必须填满盒（`width/height:100%` + `object-fit` 居中，盒由 `aspect` 定比，`W:H` 须正有限数否则 16:9）——`.pv-card__img` 缺样式会让写侧从左上角裁、看不见真实裁剪，裁剪缺陷反复漏到 iOS（详见 `docs/card-dsl.md`）。
- **老卡标签行/封面角标（勿回退）**：`tags`/`badges` 只活在无 `card` 老行（有卡走 DSL 预览），归一化收敛 `ListItemMeta.tsx`（禁各预览自写一套）；标签无路由禁冒泡整卡、角标禁点；**`relative` 时间口径必须与 iOS 逐档一致（恒「…前」，勿回落 `toLocaleDateString()`）**——预览和 App 不一致等于预览骗人（详见 `docs/preview-navigation.md`）。

- **link 块默认外链**（与其他块不同，不要注入无 target 的内部跳转）；仅当 `block.target` 存在时经 `onLinkClick` 内部导航。
- **无 target 回退 URL 约定**：`recommendations` → detail；`tags` → query string 原样作 `category`（path 型标签需插件侧补 query）；`chapter` → reading（仅插件支持时）。
- **共享 key 分组**：渲染 `FilterGroupEditor` 禁止 `key={g.key}`（三处调用点统一 `key={`${g.key}:${i}`}`）；`categoryFromState` 必须按 key 去重（否则 `tagIds=12&tagIds=12&…` 重复参数，角标/预览重复计数）。**分节单组（sections）**：渲染一个 widget、节标题分组展示，节内选项身份按节下标 + 叶子 id（勿只用叶子 id）。**多选 tag 样式（display:'tags'）**：check 组芯片云三态循环（未选→包含→排除→未选），与复选框同状态同编码。**筛选组联动（ADR-0063）**：只渲染可见组、切换经 `applyLinkageClear` 清子（勿绕过求值器自写显隐/清空，详见 docs/preview-navigation.md）。
- **listings 语义**：listings 只进 `list` 动作（不经过搜索筛选表单）；预设目录页 ≠ 预设筛选态；explore 条目不渲染筛选组。
- **标签索引条目（ADR-0037 + ADR-0038 分页 + ADR-0062 页级筛选，勿回退）**：`kind:'tags'` 叶子走 `tags` 动作（`TagsPreview` 双形态归一化 + 分页累加与加载更多 + RunBar `page/category`），**同样渲染筛选组**——选中项合并进 `Selected.category`、经 `TagContext.category` 回 `getTags`；**没有独立的服务端排序字段/控件**（`TagContext.sort` 已退役，那是单站硬编码的假能力；排序就是普通筛选组），本地显示排序与之正交（详见 `docs/preview-navigation.md`）。
- **落地筛选（两来源，ADR-0066）**：`filters` 存在 `Selected` 但**不出现在 apiRun options**（服务端不消费，便于前端合并 category）；**结果自声明的 `ListResult.filters`（`store.listFilters`）优先，缺省回退跳转携带的 `Selected.filters`**——后者是「抓到页面才知道」的选项，别为它另造控件/编码（详见 `docs/preview-navigation.md`）。
- **video 块 `target.play` 优先于 `url`**：同时带两者一律走懒解析（url 可能是出流入口而非媒体直链，硬播会 `MEDIA_ERR_SRC_NOT_SUPPORTED`）；既无 url 也无 target.play 时渲染缺地址提示，不冒充能力。
- **text 块标题区与换行**：可选 `title`（简介等独立文本区，标题区样式与 tags 同语言，缺省裸段落）；`.pv-text` 恒 `pre-wrap`（`\n` 不缩为一行，详见 docs/preview-navigation.md）。
- **recommendations 块块头**：块级 `title` 缺省「推荐」；仅块级 `viewMore`（同 `ExploreSection.viewMore`）渲染「更多」按钮（无则不渲染，禁死按钮），块头与发现页分区共用同一套 CSS 类（详见 docs/preview-navigation.md）。

### episodes / play（详见 `docs/preview-navigation.md`）

- 点剧集**不经 `runWith`**，块内直接 `apiRun({ action:'play', target: url })`（避免切走详情预览）；`PlayUrlResult.url` 常带时效鉴权（auth_key ~1h），**不落盘**。
- 错态就地展示错误 + 重试；无 `pluginId`（渲染上下文缺失）时点击不发起请求。
- **剧集/章节封面**：任一项有 `coverUrl` 即走横向缩略图行、无图项纯色占位，全块无图才回退宫格/列表（详见 docs/preview-navigation.md）。

### 账号与 `$lib.ui`（详见 `docs/interaction.md`）

- 登录态按 plugin id 写 `localStorage`（key `devconsole-account:<pluginId>`）；「退出登录」只清宿主侧展示，**不清理 server 共享 cookie jar**。
- `login`/`setting-action` 不进 RunBar 动作选择器（经「账号」「设置」tab 表单提交）。
- **⚠️ Fastify SSE 必须 `reply.raw.flushHeaders()`**：`hijack()` 后 `writeHead` 不保证立即刷头，客户端 EventSource 会卡等 header（实测 Node 24 + Fastify 4 复现）。
- **单用户假设**：所有活跃 SSE 连接都收到 prompt，按 promptId 路由 respond；无连接时 input/confirm 会使 run 挂起（dev 场景前端始终在线）。

### 视频播放（详见 `docs/video-playback.md`）

- **媒体直通必须流式转发**：纯直通响应（mp4/HLS 分片/普通图片）流式透传并原样转发 `Range` 头与 `206`/`content-range`/`accept-ranges`；只有需要重写/变换的响应才整体缓冲（`needsBuffer`）。
- **`#EXT-X-KEY` 的 URI 保留为原始 CDN URL（不经过代理）**，由 hls.js 直连（Cloudflare 挑战下代理拿不到密钥）。
- **VideoPlayer：`Hls.isSupported()` 检查在 `canPlayType` 之前**（Chrome macOS 对 mpegurl 返回 `"maybe"` 误导原生播放）；`enableWorker: false` 避免 Vite dev 下 Web Worker 问题。
- 诊断序列：`MANIFEST_PARSED → KEY_LOADED → FRAG_LOADED → canplay`；`video._hls` falsy 却报 `MEDIA_ERR_SRC_NOT_SUPPORTED` = 宿主优先级问题，按「工具自迭代优化」修复 DevConsole。
- **清晰度菜单 >1 档才显示**（两档也显示；「≤2 档不显示」为早期笔误，勿回退）；`data.levels` 保留原始下标映射，**切勿对 levels 数组本体排序**（UI 排序只动 label 顺序）。
- **挑战响应必须识别标记**：代理遇 Cloudflare 挑战页跳过一切变换并打 `x-lingshu-challenge` 头，永不缓存挑战 HTML 当媒体（详见 `docs/video-playback.md`）
- **海报代理必须透传 referer**：视频与海报同 CDN 且验 Referer 时，海报也必须带块/结果的 `referer` 进代理，否则能播但海报黑（详见 `docs/video-playback.md`）

### 桌面浏览器通道（详见 `docs/browser-channel.md`）

- **L3 在线只走 headed sidecar**：禁止前端 fetch 中继（CORS 死）与常驻无头 sidecar（已知无解）；`$lib.browser.getHtml` 由 server per-run 注入、同上下文同 UA、被动触发（详见 `docs/browser-channel.md`）
- **一次性抓取按窗口计数站才用**：`mode:'ephemeral'` 类无痕上下文即焚、cookie 不回填、验证窗已是目标页时零新请求直接读、CHALLENGE 下保持武装；勿用 `incognito` 命名持久上下文内的伪隔离（详见 `docs/browser-channel.md`）

## 完整排查记录

HLS 播放（Cloudflare 反爬、Chrome 原生 HLS 误判）的完整排查过程、修改文件清单与关键教训见 `docs/hls-video-debug-log.md`。