# ADR-0045：桌面 headed 浏览器通道（DevConsole 可见手过 + simulator 保持纯 Node）

> ADR-0060：§2/§3 的「插件自带重抓腿」「插件零改」前提退役——插件改纯直连；
> headed sidecar 薄注入、限次与 `--browser` 不进 simulator 全部不变。

## 背景

ADR-0042 把 anime_site_a 定为 L3 全站挑战（Node 通道彻底无解：`cf_clearance` 绑 TLS
指纹，同机同 IP 全套 cookie + 同 UA + 齐头经 curl/undici 重放仍 403），在线等
浏览器通道。ADR-0043 落 iOS 显式通道（`$lib.browser.getHtml` + 隐藏 WK 抓取），
真机实证隐藏抓取仍 403（WAF 分辨自动/人手加载）；ADR-0044 以可见手过验证
（同 store 同 UA + 被动触发 + 复用重试链）补上最后一环。

桌面双宿主（grill-with-docs 四轮共识，2026-09）要回答：DevConsole 与 simulator
“有办法解决吗”。代码实证（两路子代理只读）：

- `/api/run` → `devconsole/server/src/plugin-service.ts:199` →
  simulator `executeRun` → `runtime/src/runtime/http.ts`（`undici fetch`）：
  纯 Node，无浏览器 backed 分支（ADR-0042 已明写 backed 另立项）。
- `isChallengeResponse` 在 `devconsole/server/src/proxy.ts:174`（403 +
  `cf-mitigated` 头或前 4KB 特征串），命中跳过变换 + 打标透传。
- DevConsole 前端无中继能力（`src/api/client.ts` 只调自家 `/api/*`；
  `getHtml/browser/sidecar` 零命中）；全仓无 playwright/puppeteer 依赖。
- anime_site_a v1.0.1 已是标准形态（`request()` 直连优先 + 有通道恰 1 次
  `browser.getHtml` + `assertNotBlocked`）；桌面端通道是恒抛 `CHALLENGE`
  存根（`runtime/src/runtime/browser.ts` 24 行），仅 `--fixture`
  （`run.ts L108-111` 短路回 200 快照）可离线验证。

第一轮推荐曾误判两处，本 ADR 如实记录并纠正：

1. **前端 fetch 中继不可行（CORS/SOP）**：DevConsole 前端 origin 是
   `localhost`，`fetch('https://anime_site_a.me/...')` 无
   `Access-Control-Allow-Origin` 即被浏览器拦，读不到 body。iOS 能做是因
   为 WK 内先建同源上下文再 fetch；桌面无此条件（扩展 content-script
   亦无基建）。
2. **新标签页手过沾不到 Node 重试的光（跨网络栈）**：iOS 能沾光是因为
   可见 Sheet 与隐藏链同 WK 网络栈（同 store 同 UA 同 TLS 实现）。
   桌面“系统标签页手过 → 回 Node undici 重试”是跨栈，clearance 仍因
   TLS 指纹失效，重抓仍 403。

结论：桌面真正的 iOS 对等物不是“前端中继”，而是**与抓取同栈的可见
浏览器**——headed sidecar。

## 决策

1. **DevConsole 走 headed sidecar（Q5=A）**：`playwright-core` +
   `channel:'chrome'` 连用户本机 Chrome（不绑大体积 chromium 下载），
   `launch({ headless:false, persistentContext(userDataDir) })` 起可见窗口；
   无 Chrome 回退报错指引安装。抓取在 page 上下文 `page.content()`，
   无 CORS，同页手过即同上下文（桌面版“同 store 同 UA”=
   同 persistentContext 同 UA）。
2. **被动式 + 持久 profile（Q6=A，对齐 ADR-0044）**：平时不起浏览器；
   插件抛 `CHALLENGE` → 预览区切挑战态（「需要验证后访问」+ 三按钮，
   见 Q11）；点「打开验证窗口」起 headed 窗口加载 challengeURL，用户
   手过后点「已验证，重新加载」调现有 retry（直连优先 + 最多 1 次
   browser 重抓，Q9C 限次保留）。profile 落盘复用，clearance 跨 run
   有效。不做自动弹出（防误伤），不做自动检测通过（防烧声誉）。
3. **薄注入（Q9=A）**：只在 `plugin-service.ts` 组装 `RunOptions` 时覆盖
   `sandbox.$lib.browser.getHtml`（仿 fixture 覆盖写法）；语义照抄 iOS
   `BrowserBridge`：串行链（同时一抓）+ 默认 30s 超时竞速 + 成功 resolve
   `{status, headers:{'x-lingshu-browser':'headed'}, body}`（403 挑战页原文
   也 resolve，交插件 `assertNotBlocked`；仅网络异常 reject）+ 回填共享
   cookie jar（展示用）+ 记 httpLog `BROWSER`。插件 / simulator / iOS 零改。
4. **挑战判定三端拉齐（Q10=A，闭环 ADR-0043 Q8C）**：抽
   `challenge-detector.ts`（server/simulator 共用；iOS 附录对照不搬代码）：
   403/503 + `cf-mitigated` 头 + 前 4KB 小写匹配
   `just a moment|attention required|challenge-platform|cf-chl|cf-error|cf-mitigated`；
   `proxy.ts` 与插件文档引用同一表。
5. **预览区就地挑战态（Q11=A）**：`err.code==='CHALLENGE'` + url →
   「需要验证后访问」+ 挑战说明 + 「打开验证窗口」/「在浏览器打开」
   （系统浏览器兜底）/「重试」。取消 = 仅关窗不重试；验证后仍 403 =
   回原态（不自动循环）。
6. **simulator 保持纯 Node（Q7=A）**：CLI 永远 `--fixture` 离线验证 +
   在线如实 `CHALLENGE`（exit 1 即正确行为）；在线复核只在 DevConsole 做。
   CLI 依赖保持 `undici + commander` 零膨胀。`--browser` 开关否决（有头窗口
   要显示环境，CI 即回退；CLI 职责是确定性回放）。

## 插入点（实现另立项，本 ADR 只定约）

- `devconsole/server/src/browser-channel.ts`（新）：headed 抓取模块
  （launch/串行/超时/`page.content()`/jar 回填/日志）。
- `devconsole/server/src/plugin-service.ts`：per-run 覆盖
  `$lib.browser.getHtml`。
- `devconsole/server/src/challenge-detector.ts`（新，与 simulator 共用）。
- `devconsole/src/preview/*`：挑战态（复用现有错误态渲染位点）。
- 术语：`CONTEXT.md`「桌面可见手过验证（headed sidecar）」；
  宿主行为见 `devconsole/docs/browser-channel.md`。

## 后果

- anime_site_a 转正条件追加 DevConsole 在线复核（referer 校验、`+` 编码、
  secure 时效、playlist 上限，见 ADR-0042 后果 + issue #1）。
- 存量零回归：插件零改；simulator 132 全绿；iOS 链路不动；
  非挑战页预览渲染路径不动。
- 否决线：前端 fetch 中继（CORS 死）、常驻无头 sidecar（已知无解，
  重蹈隐藏抓取覆辙）、Cookie 粘贴复用（ADR-0042 已否决）、`--browser`
  进 simulator（职责错位）——勿回退。
