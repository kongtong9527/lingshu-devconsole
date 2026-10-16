# 灵枢调试台（Lingshu DevConsole）

[![CI](https://github.com/kongtong9527/lingshu-devconsole/actions/workflows/ci.yml/badge.svg)](https://github.com/kongtong9527/lingshu-devconsole/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.17-3c873a.svg)](https://nodejs.org)

[English](README.md) · **简体中文**

> [!IMPORTANT]
> **灵枢调试台是「插件驱动的内容聚合运行时」的 Web 调试台**：它通过灵枢运行时（`@lingshu/runtime`）
> 执行 `.plugin.js`，让你可视化地选插件、选动作、跑一次、看原始 JSON、看渲染预览，并追踪插件发出的 HTTP 请求。
>
> **本仓不含任何内容源、站点实现或内容策略。** 这里只有调试台本体（React 前端 + Fastify BFF）与宿主侧文档；
> 没有内置插件、没有默认插件目录——你必须用 `--plugins-dir` / 环境变量指向**你自己获得的**插件目录。
>
> **沙箱不是安全边界。** 插件跑在运行时的 `node:vm` 沙箱里，上下文与宿主共享同一个 V8 堆与同一个进程；
> 原型链逃逸与动态 `import()` 都是已知路径。沙箱提供的是**开发期隔离与危险 API 屏蔽**，
> **不是**对不可信代码的隔离。请勿运行来源不可信的插件。
>
> **插件由第三方提供。** 你加载的每一个插件都来自他人。本项目不提供、不托管、不审核、不背书，
> 也不对插件内容、插件访问的站点、插件取回的数据、或你如何使用输出承担任何责任。

## 本仓内容

| 路径 | 是什么 |
| --- | --- |
| `src/` | React 前端：运行栏、JSON/预览双模式、卡片 DSL 预览、筛选组、账号面板、播放诊断 |
| `server/src/` | Fastify BFF：插件发现与运行、请求追踪、媒体/图片代理、浏览器通道、`$lib.ui` 的 SSE 桥 |
| `docs/` | 宿主侧工程笔记：预览导航、卡片 DSL 渲染、视频播放、浏览器通道、构建与类型检查 |
| `AGENTS.md` | 宿主侧红线与文档索引 |

读代码前值得先知道两点：

- **契约类型来自运行时包。** 卡片 DSL 校验器（`validateCardDSL`、`shouldFallbackCard`）与契约类型一律
  从 `@lingshu/runtime` 构建后的 `dist/` 导入，本仓**不另写一套**——三端同口径。
- **插件目录永远显式指定。** BFF 依次从请求（`?dir=` / `options.dir`）、`LINGSHU_PLUGINS_DIR`
  （server 的 `--plugins-dir <path>` 也写这个变量）、`<cwd>/plugins` 解析；**不会**回退到任何兄弟目录。
  一个都没有时：插件列表为空，run 会把已尝试的候选路径原样回给前端。

## 环境要求

- **Node.js ≥ 18.17**（推荐 Node 20 LTS）——硬约束来自图片链路用的 `sharp` 0.33；Vite 5 本身要求 18 以上。
- npm

## 快速开始

```bash
git clone https://github.com/kongtong9527/lingshu-devconsole.git
cd lingshu-devconsole
npm ci                   # 若你的检出没有 lockfile，改用 npm install
npm run build

# 指向你自己获得的插件目录（必需——本仓不带任何插件）：
LINGSHU_PLUGINS_DIR=/path/to/plugins npm run dev
```

> **跨仓依赖（`@lingshu/runtime`）**：在它发上 npm 之前以 git 依赖消费。npm 解析 GitHub 的 git 依赖时
> 会走 **ssh**（`ssh://git@github.com/…`），没有配 GitHub SSH key 的机器会直接失败。若 `npm ci` 报
> `Permission denied (publickey)`，做一次 https 映射即可：
>
> ```bash
> git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
> ```
>
> `kongtong9527/lingshu-runtime` 还是私有仓时另需凭据（PAT 或 SSH key）；它转公开之后上面这条映射就够了。


`npm run dev` 同时起两个进程：

- Vite 开发服务器 <http://localhost:5180>——浏览器打开的是它。
- Fastify BFF `127.0.0.1:5181`，Vite 把 `/api` 代理过去。

打开页面 → 选插件 → 选动作 → 填参数 → 运行。结果面板可在 **JSON** 与**预览**之间切换，请求日志会列出
插件发出的每一个 HTTP 请求。

### 指向插件目录的四种等价方式

解析顺序是：请求里的显式参数（`?dir=` / `options.dir`）优先，其次是 `LINGSHU_PLUGINS_DIR`
（server 的 `--plugins-dir` 写的就是这个变量），最后是 `<cwd>/plugins`；一个都不存在时会把尝试过的
候选路径全部列出。四种等价写法：

```bash
# 1. 环境变量（dev 与构建后都适用）
LINGSHU_PLUGINS_DIR=/path/to/plugins npm run dev

# 2. server 参数
node server/dist/index.js --plugins-dir /path/to/plugins
npm run start -- --plugins-dir /path/to/plugins

# 3. 工作目录下的 plugins/（符号链接也可以）
mkdir -p plugins && cp /path/to/plugins/*.plugin.js plugins/

# 4. 单次请求（前端填目录时走这条）
curl 'http://127.0.0.1:5181/api/plugins?dir=/path/to/plugins'
```

候选路径一个都不存在时，页面显示空插件列表，run 返回已尝试的候选清单——它不会悄悄跑到仓库外面去找。

### 跑构建产物

```bash
npm run build                                              # 类型检查 → 编译 BFF → 打包前端
node server/dist/index.js --plugins-dir /path/to/plugins   # API + SSE，127.0.0.1:5181
```

BFF **只提供 API，不托管前端静态文件**。`npm run build:web` 把前端产物写进 `dist/`；
用任意静态服务器托管该目录，并把 `/api` 指向 BFF（Vite 开发服务器就是这么做的，见 `vite.config.ts`）。
本地开发仍推荐 `npm run dev`。BFF 端口可用 `PORT` 覆盖（默认 `5181`）。

## npm scripts

| 脚本 | 做什么 |
| --- | --- |
| `npm run dev` | 同时起 Vite（5180）与 BFF（5181） |
| `npm run dev:vite` / `npm run dev:server` | 分开起两半 |
| `npm run build` | `typecheck` → 编译 BFF → 打包前端 |
| `npm run typecheck` | 前端 `tsc --noEmit` + BFF `tsc -p server/tsconfig.json --noEmit` |
| `npm run build:server` / `npm run build:web` | 分开构建两半 |
| `npm run start` | 跑构建后的 BFF（`server/dist/index.js`） |
| `npm test` | Vitest（jsdom） |

**类型检查不在 `npm test` 里。** Vite 与 Vitest 都走 esbuild，不做类型检查——契约字段写错，测试照样全绿；
CI 依赖的是 `npm run build`（内部前置 `typecheck`）。类型检查解析的是**已安装的** `@lingshu/runtime`
包里的 `dist/`，所以请先装依赖再跑。

### 测试与插件语料

服务端大部分测试需要一个插件目录当语料。本仓不带语料，那些测试组会**整组跳过**而不是变红：
解析器会把尝试过的候选路径打进日志，依赖语料的 `describe` 块整块跳过。

`LINGSHU_REQUIRE_PLUGIN_CORPUS=1` 的作用是把「缺语料」变成硬失败——它服务于上游开发仓（那里语料恒在），
**在本仓不要设**，否则会按设计失败。

## 运行时的依赖关系

本调试台从 `@lingshu/runtime` 导入沙箱、动作分派与卡片 DSL 校验器。在 npm 包尚未发布之前，
依赖以源码形态消费（锁定到 release tag 的 git 依赖，或本地构建好的检出）；契约类型取自该包构建后的
`dist/`（由运行时仓的 `npm run build` 产出）。`@lingshu/runtime` 上 npm 之后，直接安装即为推荐路径。

## 安全

调试台会执行插件，因此运行时的威胁模型**完全适用**：**沙箱不是安全边界**。哪些问题属于本仓、
哪些属于运行时仓、哪些属于插件作者，见 [SECURITY.md](SECURITY.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。第三方依赖及其许可（含 `sharp` 带入的 LGPL-3.0 libvips 二进制）
见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 贡献

欢迎 issue 与 PR，动手前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。要点：本仓是上游开发仓的**发布快照**；
CI 文件由上游模板注入，**不要在本仓直接改**；PR 必须回流到上游才能在后续快照里生效。
提交请带 DCO 签名（`git commit -s`），本项目不采用 CLA。

## 相关仓库

| 仓库 | 是什么 |
| --- | --- |
| [`kongtong9527/lingshu-runtime`](https://github.com/kongtong9527/lingshu-runtime) | 运行时与 `lingshu` 命令行（本调试台驱动的沙箱） |
| [`kongtong9527/lingshu-plugins`](https://github.com/kongtong9527/lingshu-plugins) | 少量「教材级」示例插件与 manifest |
| [`kongtong9527/lingshu-ios`](https://github.com/kongtong9527/lingshu-ios) | SwiftUI + JavaScriptCore 宿主，在设备上跑同一份 `.plugin.js` |

每个仓库都是独立快照、各自持有许可；它们都不含任何内容源。

---

快照：`2026-10-17` · 版本 `0.1.5`
