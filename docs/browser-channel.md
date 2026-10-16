# DevConsole 浏览器通道（browser-channel，ADR-0045）

L3 全站挑战（anime_site_a）在 DevConsole 的在线抓取通道约定。插件侧只做显式
`$lib.browser.getHtml`（直连优先 + 最多 1 次重抓，挑战由宿主抛 `CHALLENGE`
结构化错误，见 anime_site_a 插件 `request()`）；本页只记宿主侧。

## 为什么只能是 headed sidecar

- **前端 fetch 中继不可行（CORS/SOP）**：DevConsole 前端 origin 是
  `localhost`，跨源 `fetch('https://anime_site_a.me/...')` 无
  `Access-Control-Allow-Origin` 即被拦，读不到 body（iOS 能做是因为 WK 内
  先建同源上下文；扩展 content-script 无基建）。勿回退。
- **新标签页手过沾不到 Node 重试的光（跨网络栈）**：clearance 绑 TLS 指纹
  （ADR-0042 背景 2：全套 cookie + 同 UA + 齐头经 curl 重放仍 403）。iOS 能
  沾光是因为可见 Sheet 与隐藏链同 WK 网络栈；桌面系统标签页与 Node undici
  跨栈，沾不到。勿回退。
- **常驻无头 sidecar 已知无解**：WAF 分辨自动/人手加载（ADR-0043 真机实证），
  隐藏自动仍 403 且烧 profile 声誉。勿回退。

## 行为约定

- 技术选型：`playwright-core` + `channel:'chrome'`（不绑 chromium 下载），
  `headless:false` + `persistentContext(userDataDir)`；无 Chrome 回退报错
  指引安装。抓取在 page 上下文 `page.content()`。
- 被动触发：平时不起浏览器；`err.code==='CHALLENGE'` + url → 预览区切
  「需要验证后访问」+ 三按钮（打开验证窗口 / 在浏览器打开 / 重试）。
- 同上下文同 UA：验证窗口与抓取同 persistentContext + 同 UA（桌面版
  「同 store 同 UA」，对齐 ADR-0044 红线）；验证期间不做程序化导航
  （防连带封首页）。
- `$lib.browser.getHtml` 语义（`plugin-service.ts` per-run 覆盖）：
  串行（同时一抓）+ 默认 30s 超时 + 通道实现原文 resolve
  `{status, headers:{'x-lingshu-browser':'headed'}, body}`（403 挑战页原文
  也 resolve；挑战识别与抛错在 `$lib` 边界统一做，见 runtime `run.ts`；
  仅网络异常 reject）+ 回填共享
  cookie jar + 记 httpLog `BROWSER`。
- 失败语义：取消 = 仅关窗不重试；验证后仍 403 = 回原态（不自动循环）。
- 判定表：runtime `runtime/challenge.ts`（`$lib.http.get` 与 `$lib` 浏览器边界共用；
  403/503 + `cf-mitigated` 头 + 前 4KB 小写强特征串，已剔除无区分度的
  `challenge-platform`）；`proxy.ts` `isChallengeResponse` 引用同一表（只标记不抛）。
- runtime 保持纯 Node：L3 在 CLI 下永远 `--fixture` 离线验证，在线
  `CHALLENGE` + exit 1 即正确行为（详见 ADR-0045 Q7）。

## 真站实测补记（2026-09，anime_site_a）

- 首跑即通，无需人手：全新落盘 profile 的可见 Chrome 首抓即 200
  （Managed Challenge 在真浏览器栈内自动通过，未弹交互式 Turnstile）。
  「打开验证窗口」仍保留——WAF 升级为交互式验证时人才进回路。
- 路径实证（`/api/run` httpLog）：`GET 403`（Node 直连）→
  `BROWSER 200`（headed，同 URL），与设计一致。
- 七动作在线全绿：explore（12 分区）/ list / search（59 条）/ detail
  （与 fixture 同构）/ play（1080p MP4 + referer）/ categories（5 组）/
  listings（5 条）；转正 checklist（referer / `+` 编码 / secure 时效）
  随新鲜数据同步验证通过。

## 一次性抓取上下文（ADR-0046，与持久并列）

按窗口计数烧声誉的站点（anime_site_a「同一窗口第二次必 403」）用：类无痕上下文，用完即焚。

- 形态：`mode: 'persistent' | 'ephemeral'`（缺省 `persistent`，零回退）；
  `ephemeral` = 按需起 headed browser + 每次操作开全新
  上下文（`newContext` 即类无痕：cookie/storage 全隔离），用完关上下文即焚。
  与落盘 profile 完全隔离（不读不写），不碰持久 `context` 缓存。
- Dock 语义（修订4：双图标投诉——两种通道各是一个浏览器进程）：切模式时互关
  对方（开一次性窗先关持久，开持久窗先关一次性整侧）；一次性侧无待复用验证窗
  时连 browser 进程一起关（空闲 Dock 归零，下次按需重起）；持久侧按设计常驻
  （clearance 在落盘 profile，关了重起即回）。自关保护：程序化关上下文带标记，
  close 监听凭标记跳过空闲关，只有用户手动关窗才触发空闲关进程。
- 透传链（插件零改）：`ChallengeError「一次性窗口打开」` →
  `store.browserMode='ephemeral'`（武装到抓到非挑战内容为止，CHALLENGE 下保持）→
  `POST /api/run options.browserMode` →
  `plugin-service` 按 run 级透传给每次 `fetchHtmlViaBrowser` →
  `POST /api/browser/open { url, mode }` 管验证窗。
- 联动语义（修订2）：点「一次性窗口打开」后，验证窗的上下文暂存为待复用；
  下一次一次性抓取若已是目标页则**零新请求直接读已加载内容**（验证打开是唯一
  一次请求——按窗口计数站点的最优解）；读出来是挑战页则报 403 并把窗口留着，
  用户过完验证直接重试（`store.browserMode` 在 CHALLENGE 结果下保持武装）；
  目标不同才在同一上下文内导航一次。连续打开不堆积（只留最新一个验证窗）；
  用户手动关窗 = 放弃验证，下次抓取走全新上下文。
- 隔离边界：UA 照透（守同 UA 红线），`Referer` 等头照透；cookie 直接丢弃、
  不回填共享 jar（回填了 Node 也用不上，还污染持久展示值）。
- 可观测：`ephemeral` 打 `x-lingshu-browser: 'headed-ephemeral'`（持久仍是
  `'headed'`），`httpLog` 照记 `BROWSER`（前端按头区分）；`getBrowserStatus().hasContext`
  只反映持久上下文；`closeBrowser()` 一次性 browser 与持久全关。
- 失败语义：与持久同构——403 挑战页原文 resolve（挑战识别与抛错在 `$lib` 边界统一做，
  见 runtime `run.ts`；插件不再写判定）、仅网络/无浏览器 reject（`code=CHALLENGE`）；验证窗已死（用户手动关窗）时
  抓取回退全新上下文；导航本身失败直接抛（不多烧一次声誉）；重试按当前模式
  再来一次，不自动回退、不自动循环（防烧持久 profile 声誉）。
- 正文嗅探（修订3）：复用直读无状态码可依，报 200/403 全看正文——嗅探串剔除
  `challenge-platform`（Cloudflare 给正常页也注入该信标，无区分度；anime_site_a
  四 fixture 全含）；真挑战页恒含 `Just a moment` / `Attention Required`。
  另注意本站可能回"403 状态 + 完整正文"（半信任回包）：宿主强特征集天然放行，
  插件按 `assertParsed` 解析兜底（旧世界站内标题否定门已退役，见技能包 pitfalls）。
- 代价：开窗/新鲜抓取时各一次 launch（留窗期间复用同一进程）+ 抓取时窗口闪一下；
  仍走 `exclusive` 串行（同时只一抓）。

## 自动验证（ADR-0047，半自动：机器跑腿，人只点窗内验证）

挑战块的「自动处理验证」开关（按插件记忆，缺省关）：CHALLENGE 到即按该插件
通道偏好自动开窗（点的哪个窗记住哪个，缺省持久），每 2s 轮询
`GET /api/browser/verify-state`（服务端纯本地读：一次性窗看正文、持久看该域
`cf_clearance`，零新请求不烧声誉），通过即自动 `run()` 重试。安全线：只认
结构化 `code==='CHALLENGE'`、每轮最多自动一轮、关窗/超时 120s/切插件/取消即
转手动；窗内那一下人机验证省不掉。去重状态在模块级（与挂载无关：同一结果对象
一次、同一插件+URL 一轮、只处理当前结果；`run()` 卸载重挂、返回旧结果都不
二次触发；亲手重开开关再武装一次）。持久验证窗同样只留最新一个（旧页即关，
此前攒出一排标签页，ADR-0047 修订）。
