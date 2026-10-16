# 渲染组件约定（LazyImage 三态）

devconsole 前端图片渲染组件的语义约定与取值（由 CONTEXT.md 词条平移，文字零改动）：加载态/占位/终态三概念的分界与 CSS token。

**加载态指示器 (Loading State Indicator)**:
图片等资源在「开始请求」到「终态（成功 / 失败）」之间显示的不确定（indeterminate）视觉信号。只表达「正在加载」，不报告百分比。
_Avoid_: 进度指示器、进度条 —— `<img>` 元素不暴露字节级 progress 事件，真实百分比需要 `fetch` + `ReadableStream` 重写整个取图链路（含 `proxyUrl` 加密代理），devconsole 明确不采用。

**图片占位 (Image Placeholder)**:
`LazyImage` 在图片终态到达前所占据的视觉盒。devconsole 的既有语言：语义颜色 token `--pv-color-image-placeholder`（#f1f5f9 浅灰）+ 调用方 CSS 提供的显式尺寸（`min-height` 或固定宽高）+ `object-fit: cover`。框尺寸由调用方负责，组件自身不收 `width/height`。
_Avoid_: 把占位与加载态混用 —— 占位是「这个盒永远在」的结构事实；加载态是「正在请求」的动态信号。加载态是占位的渐进增强（把静态灰底升级为 shimmer），不取代它。

**图片终态 (Image Terminal State)**:
一张 `LazyImage` 的终态：成功（`onLoad`）或失败（`onError`）。加载态在到达终态时消失；用户点击「重新加载」会把组件退回加载态并重新发起请求。

## 服务端文件头识别（`server/src/proxy.ts` `detectImageType`）

与 iOS `ImageLoader.looksLikeImage` **同构**：jpeg/png/gif/webp 魔法头 + **SVG**（按头部 `<svg`
判，先剥 BOM/`<?xml …?>`/注释/`<!DOCTYPE …>`）。

**SVG 这条不能删**：`decodeBase64Image` 用它判「base64-text 的载荷是什么类型」，只认魔法头会把
SVG 当「未知文件头」直接拒（`Base64 图片文件头未知或非法`）——而 iOS 侧 SVG 已由自绘光栅化支持
（`ios/docs/image-pipeline.md`），少了这条就会出现「iOS 能显示、DevConsole 报错」的反向不一致。
回归锁：`server/src/__tests__/proxy.test.ts`「解码 base64-text SVG 响应并按头部 `<svg` 设置类型」。
