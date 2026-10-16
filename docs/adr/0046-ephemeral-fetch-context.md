# ADR-0046：一次性抓取上下文（与持久 headed sidecar 并列）

ADR-0045 的单一「持久 profile 沾光」路线解不了按窗口计数烧声誉的站点：anime_site_a 同一窗口第二次请求必 403，必须每次请求都是新窗口。决定加第二形态 `mode: 'persistent' | 'ephemeral'`（缺省持久零回退），`ephemeral` 按需起 headed browser、每次操作开全新类无痕上下文、用完关上下文即焚（无待复用时连进程一起关，见文末修订4），验证窗上下文留给下一次抓取复用一次（见文末修订）。

## 背景

- grill-with-docs 三轮共识（2026-09）：`client.ts:69~80` 只是手动验证窗，真痛点是自动抓取 `fetchHtmlViaBrowser`；证据以 DevConsole `/api/run` 的 `httpLog`（`GET 403 → BROWSER 200 → 第二次 BROWSER 403`）为准，不拿系统 Chrome 手感推 headed sidecar。
- 技术约束：`launchPersistentContext` 无真无痕，真隔离只能 `launch + newContext`，与「落盘沾光」互斥，故做并列形态而非替换。

## 决策

1. **调用级即焚（Q5=A）**：每次 `fetchHtmlViaBrowser` 调用新起即焚（同 run 内多次 `getHtml` 每次都焚），不做 run 级复用（同 run 第二次仍可能 403）。
2. **抓完关整个 browser + 保持串行（Q6=A）**：先求真干净可验收（慢 2~5s + 闪窗是明码代价）；`browser 常驻 + 只关 context` 留作优化（需另实测 TLS 会话是否真清）。
3. **UA 照透、cookie 不回填（Q7=A）**：换 UA 像 bot 农场；一次性 clearance 不可复用，回填只会让持久展示值撒谎。
4. **命名 `mode` 不叫 `incognito`（Q8=A）**：`persistentContext` 无真无痕 flag，用 `incognito` 是撒谎；`CONTEXT.md` 新增**一次性抓取上下文**词条。
5. **联动语义（Q9=A）**：挑战块「一次性窗口打开」= 验证窗 ephemeral + 下一次重试抓取也 ephemeral（`store.browserMode` 一次消费，不记忆）；ephemeral 验证不保留状态，单独开无意义。
6. **透传插件零改（Q10=A）**：`RunRequest.options.browserMode`（run 级）→ `plugin-service` 透传每次 `getHtml`；`POST /api/browser/open { url, mode }`；`client.ts run()/openVerifyWindow()` 加参。
7. **可观测头区分（Q11=A）**：`ephemeral` 打 `x-lingshu-browser: 'headed-ephemeral'`，`httpLog` 照记 `BROWSER`；`hasContext` 只反映持久；`closeBrowser()` 只关持久。
8. **失败不自动回退不循环（Q12=A）**：403 原文 resolve 交 `assertNotBlocked`，网络/无浏览器 reject `CHALLENGE`；重试按当前模式再来一次（防烧持久声誉）。

## 否决线（勿回退）

- 同持久上下文内 `newPage + 清 cookie` 冒充无痕（伪隔离，TLS 会话不清）。
- `incognito?: boolean` 命名（Chromium 特定 flag 语义，误导后人找 flag）。
- 失败自动回退持久（替用户烧持久 profile 声誉；anime_site_a 自动导航连带封首页见 ADR-0042）。
- 全局默认切 ephemeral（一个站的特例污染所有站；默认永为 persistent）。

## 后果

- 验收：同一 anime_site_a URL 连跑 3 次全 200（`headed-ephemeral ×3`），无残留。
- 存量零回归：缺省全走老路；simulator 保持纯 Node（`mode` 仅 DevConsole 透传，CLI 永不传）。
- 宿主行为全文见 `devconsole/docs/browser-channel.md`「一次性抓取上下文」一节。

## 修订（2026-09，真机反馈：Dock 堆积 + 验证传不过去）

首版「每次 launch 全新 browser + 验证窗与抓取各用独立上下文」真机翻车两处，如实记录：

1. **Dock 冒出一堆 Chrome**：每次 launch 都是独立浏览器进程，macOS 每个进程一个
   Dock 图标；验证窗常驻不关，点几次攒一排。改为常驻**一个** headed browser
   （一个 Dock 图标）+ 每次操作开全新 `newContext`（类无痕，关上下文即焚）。
2. **验证永远过不去**：验证窗与抓取分属不同上下文时，在 A 窗口过验证、重试却在
   全新 B 上下文里抓，B 没验证过仍 403，死循环。改为验证窗上下文暂存为待复用，
   下一次一次性抓取在**同一上下文**里发、抓完即焚；连续打开不堆积（只留最新
   一个）；用户手动关窗 = 放弃验证，下次走全新上下文。

修订后决策 2 改为「browser 常驻复用 + 关上下文即焚」，决策 5 改为「同一上下文
复用一次」，决策 7 的 `closeBrowser()` 改为一次性与持久全关；其余不变。
`browser 常驻是否稀释隔离度`（同进程 TLS 会话）留作观察项：若 anime_site_a 在共享
browser 下第二次仍 403，再回退到按次 launch（Dock 代价换隔离度）。

## 修订2（2026-09，真机仍 403：复用还在发第二次请求）

修订版「复用同一上下文再导航一次」在 anime_site_a 上仍 403——复用导航本身就是
「同一窗口的第二次请求」，正好撞上最初观察到的反爬计数。改为：验证窗里已是
目标页时**零新请求直接读已加载内容**（验证打开是全流程唯一一次请求）；
读出来是挑战页则按 403 上报（正文嗅探，与 anime_site_a `isBlockedResponse` 正文分支
同构，`page.content()` 无状态/头可依）并把窗口留着，用户过完验证直接重试；
`store.browserMode` 在 CHALLENGE 结果下保持武装（武装到抓到非挑战内容为止）。
目标不同才在同一上下文内导航一次（尽力而为）。误伤逃生：持久验证窗与手动
关窗均可绕过正文嗅探的误判。

## 修订3（2026-09，真机：403 + 真内容被两边同时误判）

`BROWSER(headed-ephemeral)` 403 + 完整真首页（`<title>anime_site_a.me…`）：站点对
半信任客户端回"403 状态 + 完整正文"，而正文含 Cloudflare `challenge-platform`
隐形信标（正常页全含、四 fixture 实证）——宿主正文嗅探与插件
`isBlockedResponse` 用同一特征串，同时误判，验证死循环。修复分两边：

- 宿主：正文嗅探剔除 `challenge-platform`（无区分度）；真挑战页恒含
  `Just a moment` / `Attention Required`，不受影响。
- 插件（`anime_site_a.plugin.js`）：加真内容否定门（标题含本站名即真内容，
  挑战页标题恒定不会命中）+ `assertNotBlocked` 对"403 + 真内容"放行照解。
  副作用是好事：Node 403 + 真内容直解，常态连浏览器都不用。
- 技能包：`references/pitfalls.md` 新增通用条目（特征串配真内容否定门），
  回归三断言见 `runtime/src/__tests__/anime_site_a-403-content.test.ts`。

## 修订4（2026-09，真机：Dock 还是两个图标）

修订版「browser 常驻复用」只保证了一次性侧内部单进程，但两种通道各是一个
浏览器进程：anime_site_a 正常流程（首次 run 默认持久抓取 → CHALLENGE → 点一次性
窗口）必然先起持久进程、再起一次性进程，Dock 两个图标；且一次性 browser
无窗口空转也不退，关了窗口图标还在。改为：

- 切模式互关：开一次性窗先关持久，开持久窗先关一次性整侧（clearance 在落盘
  profile，关了回去重起即回，只多一次 launch）。
- 空闲即关：一次性侧无待复用验证窗时连 browser 一起关（空闲 Dock 归零）；
  留窗待验证期间常驻（Dock 一图标）。
- 自关保护：程序化关上下文带 `ownClosedCtx` 标记，close 监听凭标记跳过空闲关
  （防"关旧验证窗建新窗"时旧窗 close 事件误杀刚取到的共享 browser）；只有
  用户手动关窗才触发空闲关进程。
- 代价：新鲜抓取不再复用进程（每次按需 launch + 抓完即关）；开窗→重试仍是
  单进程（launch 一次）。回归见 `browser-channel.test.ts`（双向互关、手动关窗、
  自关不误杀）。
