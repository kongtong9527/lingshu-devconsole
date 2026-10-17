# 构建与类型检查

DevConsole 的三条检查线，以及「契约类型来自 `runtime/dist`」这层跨包耦合。

## 命令

| 命令（仓库根目录） | 覆盖 |
| --- | --- |
| `npm run -w devconsole typecheck` | 先构建 runtime（`build:runtime`）→ 前端 `tsc --noEmit` + BFF `tsc -p server/tsconfig.json --noEmit` |
| `npm run -w devconsole build` | `typecheck` → `build:server`（tsc 出包）→ `build:web`（vite） |
| `npm run -w devconsole test` | vitest（jsdom）——**不做类型检查** |

## 契约类型来自 dist（不是 src）

`src/types.ts` 从 `lingshu-runtime` 转发契约类型，经 `runtime/package.json` 的 `exports.types` 解析到 **`runtime/dist/lib.d.ts`**（runtime 侧的出口政策见 `runtime/docs/program-api.md`）。而前端 `vite build` 走 esbuild、vitest 走 esbuild——**两者都不做类型检查**，所以类型漂移可以长期静默存在。

- **`typecheck` 内置 `cd ../runtime && npm run build`**：先重建再检查，杜绝「对着陈旧 dist 检查」——陈旧 dist 上「报错」和「不报错」都不可信。负向对照（2026-10 实测）：手工把 `dist/lib.d.ts` 改回旧版，`npm run -w devconsole typecheck` 仍报 0 错（第一步就重建了），而跳过重建直接 `npx tsc --noEmit` 会报一片——轻量陈旧（旧白名单只缺 3 个类型）报 3 条 TS2305，删掉整行 `export type *` 则报 99 条（类型全没了）。陈旧程度不同、错误量差两个数量级，共同点是**不重建就不可信**。
- 手工 `npx tsc --noEmit` 绕过该保护：改过 `runtime/src/**` 后先 `npm run -w runtime build`。
- `build` 前置 `typecheck`：类型错误不再等到「碰巧有人跑 tsc」才暴露。

## 测试夹具的能力集用 `caps()` 工厂

`src/__tests__/fixtures.ts` 的 `caps({ … })`：默认全关、只写要开的项。理由：`Capabilities` 是宿主能力清单，会随能力增加字段（`listings` / `explore` / `tags` …），逐处手写十一个字段的字面量必然漏——vitest 不做类型检查，漏了照样绿。

2026-10 基线（已清零）：`tsc --noEmit` 40 条 = **3 条** `lingshu-runtime` 漏导出（`CategoryFilterDisplay` / `TagContext` / `TagResult`，runtime 侧改为 `export type *` 后消失）+ **37 条**测试夹具陈旧（`Selected.sort` 29 处、`Capabilities.tags` 8 处：`sort` 补进三处夹具常量，`tags` 8 处字面量收归 `caps()`）。

教训一句话：**新增必填字段只有 `tsc` 会告诉你，测试全绿不代表类型对**——改契约字段后跑 `typecheck`，别只看 `test`。

## 插件目录怎么找（2026-10 去硬编码，ADR-0068）

服务端**不再回退 monorepo 相对路径**（原 `../../../lingshu-plugins`），解析规则集中在 `server/src/plugin-service.ts` 的 `pluginsDir()`，按优先级取第一个**存在**的：

1. 显式入参：`GET /api/plugins?dir=<path>` 或请求体 `options.dir`；
2. 环境变量 `LINGSHU_PLUGINS_DIR`（server 入口的 `--plugins-dir <path>` 会写进它）；
3. `<cwd>/plugins`。

三个都没有 → `pluginsDir()` 抛错并列出已尝试的候选；`listPlugins()` 保持「目录无效不抛错」契约（UI 空列表 + 一行 `[plugins]` 警告日志），`runPlugin()` 把这条可读报错原样回给前端。
fixture 白名单根同步改为 `[插件目录, 插件目录/_fixtures, cwd]`（懒解析，import 期不抛错）。

**母仓开发**：`devconsole/plugins` 是指向 `../lingshu-plugins` 的**符号链接**（已 gitignore，不入库、发布时不带）；公开仓没有内容源，使用者用 `--plugins-dir` 指向自己的插件目录。

**测试**：`server/src/__tests__/plugin-service.test.ts` 按同一规则找语料，找不到就 `describe.skipIf` 整组跳过（公开仓不带内容源，缺语料不该让 CI 红）；母仓 CI 可设 `LINGSHU_REQUIRE_PLUGIN_CORPUS=1` 把「语料丢了」变成硬失败。
