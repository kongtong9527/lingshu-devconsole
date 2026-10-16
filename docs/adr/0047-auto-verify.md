# ADR-0047：挑战自动验证开关（半自动：机器跑腿，人只点窗内验证）

状态：接受（2026-09）。

## 背景

ADR-0045/0046 落到真机后，每轮 CHALLENGE 都要三次鼠标：点开窗 → 盯着窗过
验证 → 回来点重试。用户要"全自动"。

丑话说前头：**Cloudflare 要人点的那一下（Turnstile/复选框）机器替不了**，
"全自动过验证"不存在。能自动的是前后两截：自动开窗 + 盯窗 + 通过后自动重试。
目标：用户每轮只剩窗内那一下验证，DevConsole 侧零点击。

## 决定

1. **开关按插件记忆**（`devconsole-auto-verify:<pluginId>`，缺省关）：anime_site_a
   开自动不影响别的站。开关放在挑战块（出挑战时才有意义）。
2. **通道形态沿用该插件偏好**（`devconsole-browser-pref:<pluginId>`，缺省
   persistent）：点的哪个窗记住哪个——anime_site_a 点过一次"一次性"，之后自动全
   走一次性；别的站默认持久。偏好只决定宿主开哪个窗，从不注入插件。
3. **轮询零新请求**：新端点 `GET /api/browser/verify-state`，服务端纯本地读——
   ephemeral 读待复用窗正文（与抓取同嗅探串）、persistent 读该域 `cf_clearance`
   （Cloudflare 标准 cookie 名；非 CF 站恒 false、走超时转手动）。前端每 2s
   问一次，120s 上限。
4. **安全线**：只认结构化 `code==='CHALLENGE'`（文案兜底不触发，防误开窗）；
   每轮 CHALLENGE 最多自动重试一次，仍失败就停（不循环，防烧声誉）；用户关窗 /
   超时 / 切插件 / 取消 → 转手动；ephemeral 武装中途被手动洗掉 = 接管，自动停。
5. **StrictMode 防重开**：attempts 同步占位，effect 重跑也不开第二个窗。

## 链路

挑战块开关开 → `useAutoVerify`（CHALLENGE 到）→ `setBrowserMode(偏好)` →
`POST /api/browser/open` → 轮询 `verify-state` → passed → `run()`（复用现有
武装消费语义）→ 仍 CHALLENGE 则停（attempts 已耗尽）。

## 文件

- 服务端：`browser-channel.ts#getVerifyState` + `routes.ts`（verify-state）。
- 前端：`api/client.ts#verifyState` + `verify-prefs.ts` + `components/useAutoVerify.ts`
  + `ChallengeError.tsx`（开关 + 状态行 + 取消）。
- 回归：`browser-channel.test.ts`（等待态 7 项）+ `useAutoVerify.test.tsx`
  （7 项）+ `verify-prefs.test.ts`（2 项）+ `ChallengeError.test.tsx`（开关/偏好 2 项）。
- 宿主行为全文见 `devconsole/docs/browser-channel.md`「自动验证」一节。

## 修订（2026-09，真机两连 bug：无限开窗 + 返回误触发）

首版上线即翻车，如实记录：

- **bug1 无限开窗重试**：去重计数放在挂载期 ref 里，但 `run()` 期间
  `ResultPanel` 切 Skeleton 会卸载挑战块、落定后带新结果对象重挂——ref 清零，
  每轮自动重试都从零开始，无限开窗。修复：去重状态全部搬到模块级，与挂载无关
  （同一结果对象 WeakSet 一次 + 同插件+URL episode 一轮 + 只处理 store 当前结果；
  结果换人即作废陈旧流程；亲手重开开关经 `rearmAuto` 再武装一次）。
- **bug2 返回误触发**：goBack 换回旧结果对象，挂载期计数为 0（或 URL 变了），
  直接开窗。同一套模块级去重顺带修掉：处理过的对象、消费过的 episode 都不再触发。
- **持久窗堆积**（bug1 的截图：8 个 "Attention" 标签页）：连续打开持久验证窗
  从不关旧页（一次性的防堆积没给持久做），循环起来一排标签。`openVerifyWindow`
  持久路径补"只留最新一个验证页"。另注意当时偏好缺省 persistent 也是帮凶——
  首次勾选自动时偏好即持久，每轮开的都是持久窗。
- 回归：`useAutoVerify.test.tsx` 加 StrictMode 单开窗、重挂同一对象、重试新对象、
  返回旧对象、`rearmAuto` 五项；`browser-channel.test.ts` 加持久窗去重一项。
