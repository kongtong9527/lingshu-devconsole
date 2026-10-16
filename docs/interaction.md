# 声明式交互与直问桥（interaction）

账号面板（ADR-0005）与 `$lib.ui` 直问用户桥（ADR-0006）的宿主侧约定。正文由 `devconsole/AGENTS.md` 对应节平移，文字零改动。

## 账号面板（声明式交互，ADR-0005）

插件声明 `getAccountSchema()` 时，`PluginInfo.accountSchema` + `capabilities.account` 为真，结果面板出现「账号」tab（`ResultPanel.tsx`，与「设置」tab 同构）。

- **`AccountPanel.tsx`** 渲染 `accountSchema.loginFields` 表单，收集值后调 `apiRun({ action: 'login', options: { inputs } })`，展示 `AccountLoginResult`（uid/username/message）或错误。
- **登录态持久化**：登录成功后，`AccountLoginResult` 按 plugin id 写入 `localStorage`（key `devconsole-account:<pluginId>`），重进账号 tab / 刷新后仍显示已登录账号；“退出登录”只清除宿主侧本地登录展示，不清理 server 共享 cookie jar。
- **login 不进 RunBar 动作选择器**（`RunBar.ALL_ACTIONS` 排除 `'login'`）——它经「账号」tab 表单提交，同 `setting-action` 经「设置」tab 按钮，均非 run 按钮。
- **共享 cookie jar**：server 侧 `plugin-service.ts` 持模块级 `sharedCookieStore`，每次 run 注入。登录写入的 session cookie 自动续到后续读取 run（见 `runtime/AGENTS.md`「cookie jar 跨 run 共享」）。

## `$lib.ui` 直问用户桥（ADR-0006）

插件在 run 中途经 `await $lib.ui.*` 直问用户（验证码/确认/toast/开链接）时，DevConsole 的承载模型：**run 仍是「POST /api/run → JSON RunResponse」（happy path 不变）**，`$lib.ui` 触发时另开一条实时通道回推 prompt。

- **server 桥**（`server/src/ui-bridge.ts`）：`runPlugin` 注入 `sharedUiHandler`；input/confirm 推 SSE + 等 respond，message/launchUrl 推过去即返回。
- **三个端点**：
  - `GET /api/ui/stream` —— SSE 流，前端 `EventSource` 连这里收 prompt 帧（`data: {promptId, prompt}`）。
  - `POST /api/ui/respond` —— 回传 input/confirm 答案（`{promptId, response}`），按 promptId 路由解封对应 await。
  - `POST /api/run` —— 不变（始终注入 sharedUiHandler，无 `$lib.ui` 调用时无副作用）。
- **前端宿主**（`src/components/UiPromptHost.tsx`）：App 挂载一次，全生命周期复用一条 EventSource；按 prompt.kind 渲染输入框/确认框/toast，收齐答案 POST respond。input 的 image 为 base64（无 `data:` 前缀时组件自动补 `data:image/png;base64,`）。
- **⚠️ Fastify SSE 必须 `flushHeaders()`**：`reply.hijack()` 后 `reply.raw.writeHead` 不保证立即把头部刷到 socket，会导致客户端 `fetch`/`EventSource` 卡在等 header（实测 Node 24 + Fastify 4 复现）。必须紧跟 `reply.raw.flushHeaders()`（见 `routes.ts` 的 `/api/ui/stream`）。
- **单用户假设**：DevConsole 一次一用户，所有活跃 SSE 连接都收到 prompt，按 promptId（uuid）路由 respond。无连接时 input/confirm 会使 run 挂起（dev 场景前端始终在线）。
