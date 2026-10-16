# 视频播放宿主侧处理（video-playback）

HLS 播放链路（`/api/proxy` 代理 + hls.js）、Cloudflare 挑战、清晰度切换（ADR-0029）的宿主侧约定。正文由 `devconsole/AGENTS.md` 对应节平移，文字零改动。

## HLS 视频播放宿主侧处理

详情页 `video` block（m3u8）在 DevConsole 中可能遇到 `key.bin 403` 或 `MEDIA_ERR_SRC_NOT_SUPPORTED`。插件侧只需产出正确的 `video` block（清单见 `<项目根目录>/lingshu-skills/lingshu-plugin-dev/references/video-playback.md`），以下为 **DevConsole 宿主侧** 的播放链路与已知处理。

### 播放链路

DevConsole 的播放链路是「服务端代理 `/api/proxy` 拉取清单与分片 + 浏览器端 hls.js 解码」。插件产出 `video` block 后，宿主负责伪装请求头、重写 HLS 子资源 URL、处理浏览器兼容性。

**媒体直通必须流式转发（2026-08，B站 mp4 案例）**：`/api/proxy` 对无需变换的
纯直通响应（mp4 直链、HLS 分片、普通图片）**流式透传**，并原样转发浏览器 `Range`
头与 `206`/`content-range`/`accept-ranges`——否则 `<video>` 要等代理把整个大文件
下载完才拿到首字节，表现为「一直 loading、duration 为 null」（B 站 720P 几百 MB
会卡死）。只有需要重写/变换的响应才整体缓冲：HLS 清单（`rewriteHlsPlaylist`）、
图片解密/`imageTransport`/`__s` 解扰。区分依据见 `server/src/proxy.ts` 的
`needsBuffer`（URL 带 .m3u8 / content-type 含 mpegurl / 存在变换参数）。

### 插件与宿主职责边界（宿主侧部分）

| 职责 | 归属 / 位置 |
|------|------|
| 服务端代理拉取清单/分片、伪装 UA + Referer + 客户端提示头 | 宿主 `devconsole/server/src/proxy.ts` |
| 重写 HLS 清单：分片 URL 走 `/api/proxy` 并透传 `referer` | 宿主 |
| `#EXT-X-KEY` 的 `URI` 保留为原始 CDN URL（不经过代理） | 宿主 |
| 浏览器端 hls.js 附加到 `<video>`、处理 Chrome 原生 HLS 误判 | 宿主 `devconsole/src/preview/VideoPlayer.tsx` |

### Cloudflare Challenge 与「不可代理」资源

部分 CDN（典型：Cloudflare Managed Challenge）要求客户端执行 JavaScript 挑战才能下发资源字节。服务端 Node.js `fetch` 无法执行 JS，这类资源不能经 `/api/proxy`，必须由浏览器直连。最典型的是 HLS 的 `#EXT-X-KEY`（`key.bin`）：

- 经代理拉取时，Cloudflare 返回 403 + 挑战页 HTML，hls.js 拿不到 AES-128 密钥 → 整段视频无法解密播放。
- 浏览器直连 CDN 时，Chrome 自动通过挑战，正常拿到密钥。

**宿主已处理**：`rewriteHlsPlaylist` 把 `#EXT-X-KEY` 行的 `URI` 保留为原始 CDN URL（不经过代理），由 hls.js 直连。

**全链 challenge（2026-08，movie_site_a 案例）**：部分 CDN 连**清单本身**都被 Cloudflare 拦
（Node fetch 403 + 挑战页，非仅 key.bin）——代理拿不到清单与分析片段，「key.bin 直连」
策略失效，DevConsole 播放链路整体不可达。此类站点插件侧选「浏览器直连可达的源」
（如 movie_site_a 的 `videoUrlOne` Twitter CDN，浏览器直连 200、Node 403）并如实报错即可；
 宿主如需播放需新增「挑战响应回退浏览器直连」通道（未来方向，当前不做）。
 完整排查见 `docs/hls-video-debug-log.md`「movie_site_a 案例」节。

**挑战响应识别与标记（2026-09，ADR-0042；口径见 ADR-0052）**：`fetchViaProxy` 对缓冲响应做
 `isChallengeResponse` 判定（403/503 + `cf-mitigated` 头或正文强特征串，引用 runtime
 共享表，只标记不抛）：命中则跳过
 HLS 重写/图片解密/缓存兜底（挑战 HTML 永不被当成媒体缓存），原样透传并打
 `x-lingshu-challenge: cloudflare` 标记头（路由层已透传）。全站挑战站（L3，如 anime_site_a）
 的插件 run 同样走 Node 通道，同样过不了——挑战由宿主 `$lib` 边界抛统一 `CHALLENGE`
 （ADR-0052），插件只留重抓 + 解析兜底。分级处置总纲见 ADR-0042。

### VideoPlayer 的 `canPlayType` 优先级

Chrome macOS 的 `canPlayType('application/vnd.apple.mpegurl')` 返回 `"maybe"`（真值），会误导 VideoPlayer 跳过 hls.js、直接把重写后的 m3u8 代理 URL 交给 `<video>` 原生播放，导致 `MEDIA_ERR_SRC_NOT_SUPPORTED`。

**宿主已处理**：VideoPlayer 把 `Hls.isSupported()` 检查移到 `canPlayType` 之前，优先用 hls.js；`canPlayType` 仅作 Safari/iOS 降级；`enableWorker: false` 避免 Vite 开发模式下 Web Worker 加载问题。

### 诊断事件序列

确认插件侧无误后，若仍播放失败，检查 hls.js 事件序列是否完整：`MANIFEST_PARSED` → `KEY_LOADED` → `FRAG_LOADED` → `canplay`。若 `video._hls` 为 falsy 却报 `MEDIA_ERR_SRC_NOT_SUPPORTED`，是宿主 VideoPlayer 优先级问题，按「工具自迭代优化」原则修复 DevConsole。

## 视频清晰度切换（ADR-0029，双通路）

`VideoPlayer`（`src/preview/VideoPlayer.tsx`）支持清晰度菜单，两条通路互斥（显式优先）：

- **显式 `qualities`（多 URL 型站点）**：props 收到 `qualities` 且 >1 档时渲染菜单；点档位
  换 `activeSrc`（组件内 state，初始 = props.src）**重建播放器**（换源）。`props.src` 变化
  （换剧集/线路）时重置 `activeSrc` 与 `hlsLevels`。
- **master playlist 自动（HLS ABR）**：hls.js `MANIFEST_PARSED` 后 `data.levels.length > 1`
  时渲染菜单；点档位设 `hlsRef.currentLevel`（-1 = 自动）**原地切档不重建播放器**。注意
  `data.levels` 的下标即 `currentLevel` 取值，UI 展示排序（高→低）只动 `label` 顺序、
  **保留原始下标映射**，切勿对 levels 数组本体排序。
- 菜单行为：播放器右上角浮动按钮（当前档名）+ 下拉列表（含「自动」）；**>1 档才显示
  菜单、单档不显示**（条件即 `qualities.length > 1` / `levels.length > 1`，两档也会显示；
  「≤2 档不显示」为早期笔误，勿回退）；Safari/iOS 原生 HLS 降级路径无菜单（原生播放器自理）。

**透传链**：`BlockRenderer` video case（直嵌）传 `block.qualities`；`VideoLazyBlock` /
`EpisodesBlock` 把 `PlayUrlResult.qualities` 传给 `VideoPlayer`。**iOS 端已落地（ADR-0029
2026-09 后置补完）**：Swift 契约同型（`VideoQuality{label;url;width?;height?}` +
`qualities?` 双端），会话演进见 `ios/docs/player.md`「视频清晰度切换」——自动通路在 iOS 用
`AVPlayerItem.variantPreferences`（「偏好」语义，系统仍按带宽自适应降档），与 hls.js
`currentLevel` 的「锁定」语义有差异（记录于 ADR-0029）。

**插件侧职责**：多 URL 型站点声明 `qualities`；master playlist 型零声明。判定边界见
`lingshu-skills/lingshu-plugin-dev/SKILL.md`「视频清晰度」节与 `data-model.md` 对应节。

### 海报代理必须透传 referer（2026-09，manga_site_d 案例）

视频与海报同 CDN 且 CDN 校验 `Referer` 时（如 `v.manga_site_d.top` 的 MP4 与 JPG 无
Referer 一律 403），`VideoPlayer` 的 `poster` 也必须走带 `referer` 的代理 URL——
只给视频源传 `referer`、海报裸代理，表现为「能播但海报黑」。修复：
`proxyUrl(poster, encryption, imageTransport, referer)`（`proxy.ts` 的 `referer`
参数本就存在，调用点漏传）。同类：站内图片代理凡是与媒体同源且验 Referer 的，
一律带上块/结果的 `referer`，不要只管媒体不管图。

### 完整排查记录

HLS 播放（Cloudflare 反爬、Chrome 原生 HLS 误判）的完整排查过程、修改文件清单与关键教训见 `docs/hls-video-debug-log.md`。
