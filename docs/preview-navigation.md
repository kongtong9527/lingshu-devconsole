# 预览导航与内容块渲染（preview-navigation）

详情预览（`src/preview/`）的导航联动、listings 目录页/导航树/探索页、episodes 块与 `play` 动作的宿主侧约定。正文由 `devconsole/AGENTS.md` 对应节平移，文字零改动。

## 预览导航：tags / recommendations / chapter / link 块的内部跳转

详情预览（`src/preview/`）中，`tags`、`recommendations`、`chapter`、`link`（带 target 时）
内容块点击后应在 DevConsole 内部联动，而非跳转外站。实现在 `BlockRenderer.tsx`
（`onTagClick` / `onDetailClick` / `onChapterClick` / `onLinkClick` 回调，无回调时降级为
`<a target="_blank">`）与 `preview/index.tsx`（detail case 注入回调 + `toJumpPatch` 解析）：

- **结构化 `target` 优先**：内容项若带 `target`（`PageJumpTarget`），`toJumpPatch` 直接转成 `runWith` 的 `Selected` patch（list/search/detail/reading/categories），不解析 URL。
- **`link` 块（2026-08 扩展）**：默认语义是**外链**（浏览器打开，与其他块不同，不要
  注入无 target 的内部跳转）；仅当 `block.target` 存在时经 `onLinkClick` 内部导航
  （`runWith(toJumpPatch(target))`）。CSS `pv-link` 同时服务于 `<a>` 与 `<button>`，
  已做 button reset（background/border/padding/font/cursor）。manga_site_c 作者块依赖此行为。
- **无 `target` 时回退 URL 约定**（向后兼容）：
  - **`recommendations`**：点击 → `runWith({ action: 'detail', target: url })`。推荐项的 `url` 是详情页 URL，通用，对所有插件生效。
  - **`tags`**：点击 → 把标签 URL 的 **query string 原样作为 `category`** 调 `runWith({ action: 'list', category: query })`（`extractQuery` 提取 `?` 后部分）。因此：
    - 标签链接为 query 形式（如 `/search?tagIds=xxx`）的插件天然可用。
    - 标签链接为 path 形式（标签 id 在 path）的插件，需在 `tags.content[].url` 补一个 query（如 `?label=<id>`）才能正确还原筛选——这属于插件侧约定，见 `<项目根目录>/lingshu-skills/lingshu-plugin-dev/SKILL.md`。
  - **`chapter`**：点击 → `runWith({ action: 'reading', target: url })`（仅当插件支持 reading，否则渲染为外链）。
  - **`link`**：无 target → 外链（`<a target="_blank">`，link 块的默认语义）。

## recommendations 块块头：`title` 与 `viewMore`（2026-10）

`recommendations` 块新增两个**块级可选字段**（契约见 `runtime/src/types.ts` 的
`ContentBlock`；DevConsole 经 `lingshu-runtime` 取类型，宿主侧只消费不改契约）：

- **`title?`（块级区标题）**：`BlockRenderer` 的 recommendations case 恒渲染块头
  `block.title ?? '推荐'`——与 `text`/`tags`/`tagGroups` 块的 title 惯例一致（缺省即
  「推荐」，不是不渲染）。与 iOS `DetailView.swift` 的
  `SectionHeaderView(title: title ?? "推荐")` 同口径（块级 `title` 即覆盖，缺省「推荐」）。
- **`viewMore?`（块级「更多」跳转）**：与 `ExploreSection.viewMore` **同型同语义**
  （`PageJumpTarget`，写法同发现页分区：`{action:'list', url?, category?}` 等）。存在时
  块头右侧渲染「更多」按钮，点击经 `toJumpPatch(block.viewMore)` → `runWith(patch)` 进该
  推荐维度的完整列表页——**与发现页分区 `ExplorePreview` 完全同一个跳转机制**。
  **无 `viewMore` 就不渲染按钮**（禁死按钮，同 iOS `SectionHeaderView` 的
  `onMore` 可选口径 / `DiscoverView.swift:703` 注释）。
- **回调通道**：`BlockRenderer` 保持回调 prop 驱动，新增可选 prop
  `onViewMoreClick?: (target: PageJumpTarget) => void`（不直接读 store，便于单测）；
  `ArticlePreview.tsx` 透传、`preview/index.tsx` 的 detail case 注入（与 `onTagClick`
  同款通道），缺省动作按插件 `capabilities.detail` 取 detail/reading。
- **样式复用（两处观感一致）**：块头复用发现页分区块头同一套类
  `.pv-explore-section__head` / `__title` / `__more`（「更多」按钮同为
  `.dc-btn dc-btn--ghost`）；recommendations 块头用 `h4`（块内区标题），发现页分区块头
  仍为 `h3`（页面级分区）——**样式类共用，不另写一套等价类**。外层 `.pv-recommendations-block`
  仅作分组容器（无自身规则）。
- 推荐项卡片流保持现状：`item.url` / `item.target` / `item.coverUrl` 语义不变
  （target 优先、缺省回退 detail，见上文「预览导航」节）。
- 回归锁：`src/preview/__tests__/preview.test.tsx` 的 `BlockRenderer` describe 内
  「recommendations 块带 title / 无 title / 带 viewMore / 无 viewMore」四条。

## listings 预览（预设目录页 / 目录页筛选 / 探索页条目）

插件导出 `getListings()` 时，RunBar 出现 `listings` 动作（`server/src/plugin-service.ts`
探测 `capabilities.listings`），结果由 `src/preview/ListingsPreview.tsx` 渲染为
**目录页签列表**：每个页签对应一个 `{ name, category }`，点击「打开」即
`runWith({ action: 'list', category })` 就地复用 `ListPreview`（列表累加 +
「加载更多」）。无 category 的页签以默认列表（空 category）打开。

**（探索页条目，listings-first）**：`kind: 'explore'` 的叶子「打开」改走
`runWith({ action: 'explore', url })`（url = 该条目的 url 字段 = 探索页标识，
无 url = 默认探索页，`ExplorePreview` 渲染分区 feed）；叶子上展示「探索页：
getExplore(context) 聚合 feed，不消费目录页筛选」提示，**不渲染筛选组**
（`filters` 对 explore 条目无意义）。

**（标签索引条目）+ （分页标签索引）+ （页级筛选）**：
`kind: 'tags'` 的叶子「打开」改走 `runWith({ action: 'tags' })`（`TagsPreview` 双形态归一化：
legacy 裸 `TagGroup[]` 首字分组全量云，或 `TagResult` `{groups, pagination}` 分页云；分页云走
`tagsGroups/tagsPagination/loadMoreTags` 累加器 + 底部「加载更多标签」，与 `ListPreview` 的
`listItems/loadMore` 同构；RunBar `tags` 动作可输 `page/category`）。
**tags 叶子同样渲染筛选组并消费 `Listing.filters`**：选中项与 `Listing.category`
合并成组合串，经 `TagContext.category` 传给 `getTags`（与 `fetchList` 的
`context.category` 同口径）——`Selected.category` 一字段两用途，BFF `plugin-service.ts`
按动作透传，**没有独立的 `sort` 字段**（`TagContext.sort` 已退役：那曾是宿主为单站写死的排序档，
对无此能力的站是假能力；服务端排序现在就是一个普通的 `key:'sort'` 筛选组，换档重跑首页）。
无 `filters` 的 tags listing = 纯标签云、零筛选控件。
标签 chip 点击：结构化 `target` 优先（`toJumpPatch(tag.target)` 进标签视频列表），
缺省回退标签 url 作页面通道（`{action:'list',url}`，宿主优先 url）。
本地过滤/拼音排序仍是零请求显示层（与 iOS `TagsCloudView` 同款语义），与页级筛选正交。

**（目录页筛选）**：listing 可携带 `filters: CategoryGroup[]`（本目录页
专属筛选组，与 `getCategories` 同型同编码）。有 filters 时页签卡内渲染筛选控件
（共享组件 `src/preview/FilterGroupEditor.tsx` + 纯逻辑 `filterState.ts`，与
`CategoriesPreview` 复用同一套 state 组合编码），用户选择后经
`mergeListingCategory(listing.category, 筛选串)` 合并再进 list——同名 key 后者
覆盖。**筛选状态不持久化**（每次进入重置，与搜索页的持久化已启用筛选刻意区分）；
各页签筛选状态按 index 独立存于组件 state，切页签不互相污染。

**共享 key 分组的 React 渲染 key + 编码去重（2026-08，manga_site_a 案例）**：`CategoryGroup`
合法地可让多组共享同一个 key（摸摸分类 6 组共用 `tagIds`、跨组单选互斥）。① 渲染
`FilterGroupEditor` 时**禁止用 `key={g.key}`**（重复 key 会让 React 把多个组当成同一
实例、内容串组）；三处调用点（`ListingsPreview`/`ListPreview`/`CategoriesPreview`）
统一用 `key={`${g.key}:${i}`}`。② `categoryFromState` **必须按 key 去重**（同一 key 只
输出一次、取最后出现的非空值）——不去重会输出 `tagIds=12&tagIds=12&…` 重复参数，
角标/预览重复计数（用户反馈「选 3 个显示 6」）。去重与插件 `parseQueryString` 后者
覆盖语义等价，安全；iOS `FilterState.categoryString`/`filterCount` 同款去重。

「预设目录页」不是「预设筛选态」：listings 只进 `list` 动作，不经过搜索流程的
筛选表单（筛选只在搜索模式，见 iOS `DiscoverView` 对应实现）；目录页筛选是
「目录页属性」，在页签内渲染。

**筛选组联动（kvs_site_a 分类页）**：子组经 `dependsOn`/`visibleWhen`/
`optionsWhen`/`clearPolicy` 随父值联动，求值器收敛在 `filterState.ts`
（`isGroupVisible`/`resolvedLinkedItems`/`visibleGroups`/`applyLinkageClear`，
与 iOS `FilterState` 同算法、同案单测）。三处预览（`ListingsPreview`/`ListPreview`/
`CategoriesPreview`）只渲染可见组（`categoryFromState` 同步跳过隐藏组），`onChange`
一律经 `applyLinkageClear` 清子；`FilterGroupEditor` 收 `groups` 全量、映射命中按单节
扁平渲染。父按 key 寻址（联动 key 同数组内唯一）、父限 select/sort、`items` 为父空
回落集——校验矩阵与运行期容差。

**（页面通道 / 导航树渲染，已实现）**：`Listing` 可带 `url`（页面通道）、
`kind`、`children`（可嵌套导航树）。`ListingsPreview` 已按导航树消费：
- listing 带 `url`（非 category）：「打开」走 `runWith({ action:'list', url })`；
  缺 `url` 回退 category（filters 合并串随行，url 叶子同样携带）。
- listing 带 `children`：递归渲染分组树（可折叠，任意深度），只有叶子是可点击目录页。**调试台刻意保留折叠树、不跟随 iOS 的「分级页签」**——预览要暴露插件声明的完整层级，跟着用户口径改反而会掩盖插件写错层级的问题。
- listing 带 `kind`（series/search 等）：树上结点渲染 kind 角标，未知 kind 降级为普通项。
- `PageJumpTarget { action:'list', url }` 与 `ListItem.target`：`toJumpPatch`
  已支持 url 形态（url 优先、category 回退）；`ListPreview`/`ExplorePreview`
  条目点击优先结构化 target（递归列表，缺省回退详情/reading）。
- url 全程透传：`Selected.url` → `apiRun` options.url → server `RunRequest.options.url`
  → runtime `PluginContext.url`；RunBar 的 list/search 提供 url 输入框。
- channel 全程透传：`toJumpPatch` 有才带 `target.channel` → `Selected.channel`
  → options.channel → `PluginContext.channel`（无则不传，旧插件回退 URL 正则零改动）。

**落地列表页筛选（2026-08，manga_site_a 案例）**：`PageJumpTarget.list` 可携带可选
`filters: CategoryGroup[]`（型）。`toJumpPatch` 透传 `target.filters` 到
`Selected.filters`；`ListPreview` 读到筛选组时渲染筛选栏（复用
`FilterGroupEditor` + `filterState` 的 `categoryFromState`/`mergeListingCategory`，
含「应用筛选/重置」按钮），组合后 `runWith({ action:'list', url, category: 合并串, filters })`
重进 list——**filters 存在 Selected 但不出现在 apiRun options（服务端不消费，便于前端
合并 category）**。适用范围：页面通道跳转落地页自带的筛选（如 manga_site_a 每日更新落地页
星期筛选），与 listing 目录页筛选同型同编码；别把落地页筛选塞进 getExplore 分区内联。

**列表页自声明筛选（2026-10 video_site_c 案例）**：筛选组还有第二个来源——
**list 结果自带** `ListResult.filters`，用于「只有抓到页面才知道」的选项
（video_site_c 工作室页题材滑块按工作室不同、只渲进 SSR HTML，卡片上根本没有）。
`readListResult` 顺带读出 `filters` → `store.listFilters`（`run`/`goBack` 更新、
`loadMore` 保留、`setPlugin`/`setAction` 清空），`ListPreview` 两个来源的**优先级**：

```
resultFilters（结果自声明，非空时） > selected.filters（跳转携带）
```

即「页面实际长什么样」优先于「跳转时以为的样子」；两者都空 = 无筛选栏（零回归）。
应用筛选的出口不变（`mergeListingCategory` 合并 → 同 `url` 重跑 → `filters` 随 patch 带回），
**不是**第三个控件体系——渲染、编码、联动全部走既有那一套。
渲染时机上，筛选组随第一页结果**后到**，故筛选栏会在加载完成后出现（不是缺陷）。

**（video 播放占位 / ReadingPage content，已实现）**：
- `video` 块「无 `url` + `target.play`」：`BlockRenderer` 的 video case 渲染
  「封面/占位 + «解析播放»」（`VideoLazyBlock`，含加载态、错误+重试），点击懒调
  `play` 动作就地出流（与 episodes 块的懒解析模式一致）。
- **`target.play` 优先于 `url`（2026-08，B站案例）**：video 块同时带 `url` 与
  `target.play` 时一律走懒解析（`url` 可能是出流入口/页面地址而非媒体直链，硬播会
  `MEDIA_ERR_SRC_NOT_SUPPORTED`）；只有无 `target.play` 时才把 `url` 当直嵌媒体
  内联播放（video_site_a 短剧/manga_site_a 等直嵌形态不变）。
  既无 url 也无 target.play 时不冒充能力，渲染缺地址提示。
- `ReadingPagePreview` 优先按 `content` 渲染图文块（`BlockRenderer` 逐块渲染），
  无 content 回退 pages 逐张成图（漫画兼容）。

## episodes 块预览与 play 动作（播放页解析）

详情 `episodes` 块（线路 × 剧集）由 `src/preview/EpisodesBlock.tsx` 渲染：

- **形态**：线路 tab（`role="tablist"` + 线路按钮，含集数角标）+ 剧集网格 + 播放器区。切换线路只换剧集网格，已解析的播放保持在播放器区。
- **就地播放**：点剧集 → 组件内持 `statuses`（按播放页 URL 缓存 loading/error/done 三态）→ 直接 `apiRun({ action:'play', target: url })`（**不**经 `runWith`，避免切走详情预览），成功后在块内渲染 `VideoPlayer`。缓存存活期 = 详情预览会话（重新 run detail 即清空）；`PlayUrlResult.url` 常带时效鉴权（auth_key ~1h），不落盘。
- **错态与重试**：error 态就地展示错误 + 重试按钮；无 `pluginId`（渲染上下文缺失）时点击不发起请求。
- **条目级封面（剧集/章节封面，`coverUrl?`）**：`EpisodeItem.coverUrl?` / chapter 项 `coverUrl?` 任一项有图即走横向缩略图行（左 16:9 图 120×68 + 右标题，复用推荐块 LazyImage 代理链路，与块级 `poster` 共用同一传输/加密上下文）；同块内无图项用纯色占位保持行高对齐；全块无图回退原形态（episodes 文字宫格 / chapter 纵向文字列表）。`chapter` 与 `episodes` 有图行同构复用同一行语言。
- **BFF 侧**：`plugin-service.ts` 探测 `capabilities.play`（`typeof plugin.fetchPlayUrl === 'function'`），`RunRequest.action` 联合含 `'play'`，派发到 `executeRun` 的 `play` 分支；RunBar 动作选择器自动出现 `play`（调试直达，结果由 `PreviewDispatcher` 的 `play` case 渲染播放器 + 原始 JSON）。
- **判断边界**：播放页解析链路本身（播放页 → 播放器配置 → 解析接口/加密）属插件侧职责（SKILL「线路 × 剧集与播放页解析」）；解析出的流播不了（HLS 代理/key.bin/canPlayType）属 `devconsole/docs/video-playback.md`「HLS 视频播放宿主侧处理」。

## text 块标题区与换行保留（2026-09）

- `text` 块可选 `title`：带标题时 `BlockRenderer` 渲染标题区（`.pv-text-block` 包裹 + `.pv-text__title` 区标题，与 tags 区标题同语言，简介等独立文本区用它统一样式）；缺省保持裸 `.pv-text` 段落（旧插件零改动）。
- 换行保留：`.pv-text` 用 `white-space: pre-wrap`——`content` 内 `\n` 不缩为一行，长行仍自动换行。渲染不断行分裂（单个 `<p>`，`\n` 留在 textContent）。

## 老卡标签行与封面角标（列表项 `tags` / `badges`，非卡片 DSL）

`ListPreview`（列表）与 `ExplorePreview`（探索分区卡）的老卡行渲染 `src/preview/ListItemMeta.tsx`
（归一化 + 默认样式收敛一处，有 `card` 的项走 `CardPreview`、新字段忽略）：

- **标签行**：标题下方单行横滑（`.pv-list-tags`，空/缺省不挂载，最多前 6 个）；可导航项
  渲染为按钮（`stopPropagation` 拦截，不冒泡整卡行），`tagJumpPatch`（`target` 优先内部导航、
  无则非空 `url` 包装为 `{ action:'list', url }`）经 `runWith` 跳列表；无路由项纯 `<span>` 展示。
- **角标**：封面相对容器（`.pv-list-item__cover-wrap`）四角绝对定位（`.pv-cover-badges`，
  `pointer-events:none` 纯展示）；文本经 `formatText`（时长/次数/时间戳统一格式化），
  底经 `badgeBackground`（底色 × opacity，只淡底）；无封面不挂载。
- **`relative` 时间与 iOS 逐档同口径（勿各写一套）**：`formatText` 的 `relative` 档 =
  刚刚 / N分钟前 / N小时前 / N天前(<30 天) / N个月前(<12 月) / N年前，**任何跨度都不回落
  `toLocaleDateString()`**——2026-10 iOS 侧改档前，>24h 两边都出绝对日期，用户报「列表里
  看不到几天前」；预览与 App 不一致等于预览骗人（iOS 实现与回归锁见 `ios/docs/card-dsl.md`
  「数字」条 / `LingshuTests/RelativeTimeFormatTests`）。
- **样式默认**：标签缺省单色（`defaultTagStyle`，与 iOS `defaultListTagColors` 同值），
  插件带色（`colorOf` 解析，复用卡片 DSL 颜色语义）则覆盖；随机/分组配色由插件显式声明各标签颜色；图标沿 DSL gap 只显文字（以 iOS 为准）。
- **判断边界**：字段契约属插件侧（`lingshu-skills/lingshu-plugin-dev/references/data-model.md`
  「列表标签与封面角标」）；iOS 侧见 `ios/docs/session-and-navigation.md` 同名节。
