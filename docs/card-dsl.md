# 列表项卡片 DSL 预览（DevConsole 宿主侧，ADR-0050）

`ListItem.card` 有即渲染 DSL、无即回退老行。渲染见 `src/preview/CardPreview.tsx`，接入见 `ListPreview.tsx`（`shouldFallbackCard` 分流）。

## 红线

- 布局正确性预览，样式可略差；iOS 真机验终效。
- 未知 `type` 跳节点，根非法（`version != 1`/无 root）整卡回退。
- 截断与 iOS 对齐：stack 子前 20、grid 图前 4、overlay 前 5、actionBar 前 4；文本 `maxLines` 缺省 2 行截断。
- 数字格式化与 iOS 对齐：秒→`m:ss`、次数→万/K、时间戳→相对/日期（`formatText`）。
- 语义色（`$…`）走 CSS 回退不硬解；固定色与 `{light,dark}` 取 light 预览。
- 图片经 `proxyUrl`（管线参数优先节点自带、缺省继承 `item.metadata`）。
- 容器属性全 honor（与 iOS 对齐）：stack 的 `backgroundColor/padding（单/双/四元）/borderRadius（数字或 auto=12）/justifyContent（有值即撑满整行）`、`flex`（`${n} 1 0%`，子级按值配比）；text/image/grid/pill 的 `flex` 同理；image/grid 补 `minWidth: 0` 防横向溢出。
- 明图直通（proxy，与站内解密器同语义）：`decrypt` 已配但响应体已有图片魔法头（jpeg/png/gif/webp）时跳过解密直接透传——混排中个别明图（如视频海报）不被误解密成乱码。
- 点击（节点级，冒泡拦截）：无 `target` 冒泡到整卡按钮；有显式 `target`（含 `noop`）`stopPropagation` 拦截；`invoke` 通用调用留桩置灰禁用+warn 不发请求（预览不做写侧——写侧验证走 runtime CLI `invoke` 动作分派 + iOS 真机，勿在预览里补调插件写侧）；`actionBar` 单项 target 忽略、跟整卡走。
- `divider` 全宽 1px 细线（缺省 `var(--pv-color-border)`，与 iOS 0.5pt `DSColor.separator` 同位）；`flex` 配比原生按值分配（iOS 侧曾只认有无不认配比，已修 `ProportionalRowLayout`，预览行为不变）。
- 徽标形状认插件声明：`overlay.shape === 'circle'` 走 34px 圆钮（与 iOS 定径对齐），缺省小胶囊（预览忽略图标只显文字，属已知预览 gap，iOS 为准）；徽标底透明度认 `overlay.opacity`（`badgeBackground` 经 `color-mix` 只乘底色 alpha，图标/文字不动，与 iOS 只淡底同语义）；圆直径认 `overlay.size`（`badgeSize` 非法回 34px，图标同比）。
- pill 固定圆形认 `shape === 'circle'`（直径 `size` 缺省 24px、非法回缺省，多位数按位降字号近似 iOS 缩字，终效以 iOS 为准）。

## 图片填充方式与 iOS 同构（`image.resizeMode` / `image.aspect`）

`image` 节点的几何语义（**填充方式 + 定比**）在渲染两端（DevConsole / iOS）必须逐像素同构——预览是插件作者唯一能自查裁剪的地方；runtime 侧另做同口径 lint 校验（非法值 warning + 回缺省）。

| 声明 | 行为（DevConsole / iOS 同一份语义） |
| --- | --- |
| `resizeMode: 'cover'` | `object-fit: cover`：填满盒，超出部分**居中**裁 |
| `resizeMode: 'contain'` | `object-fit: contain`：整图入盒不裁，超出比例处留白 |
| `resizeMode` 不写 | 同 `cover`（缺省） |
| `resizeMode` 非法（`'stretch'`、`null`、空串、数字、大小写不合…） | 同 `cover`（**只回缺省，不报错不炸卡**；runtime 侧另有 lint warning） |
| `aspect` 合法（枚举 `16:9/4:3/3:4/2:3/1:1/circle`，或通用 `W:H` 且 W、H 均为**正有限数**） | 盒按比值定高（如 `1.86:1` → `aspectRatio: 1.86/1`） |
| `aspect` 缺省/非法（非串、`0:1`、`1:0`、`0:0`、`16/9`、`abc`…） | 回退 **16:9**（口径与 runtime `isLegalAspect` 一致） |

- 实现：`CardPreview.tsx` 的 `objectFitStyle()` 只对 `'contain'` 判等、其余一律 `cover`；`aspectStyle()` 的通用 `W:H` 分支必须 `Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0` 才采用——`0:1` 曾漏成 `aspectRatio: '0/1'`，浏览器整条丢弃该声明（盒消失 → 图又溢出）。只有 `image` 节点有 `resizeMode`，`avatar` 没有，勿自作主张套用。
- CSS：图元素 `.pv-card__img` = `width/height: 100% + object-fit + object-position: center + display: block`（`src/styles/devconsole.css`）；盒由 `aspect` 定比、父级 `overflow: hidden` 兜底。**居中一律交给 `object-fit`**，不要用 margin/绝对定位凑。
- **为什么必须逐像素同构（本次根因）**：`.pv-card__img` 历史上连样式都没有 → 图按自身尺寸溢出、被父级 `overflow: hidden` 从**左上角**裁，而 iOS 是**居中**裁：同一份 DSL 两端画面不同，插件作者在预览里「看着没问题」，裁剪缺陷就一路漏到 iOS 真机才暴露（本次 iOS 根因同样是图片视图未按提议尺寸排版）。凡「填充 / 裁剪 / 定比」这类几何语义，改任一端都必须三端（iOS / runtime / DevConsole）同轮对齐。
- 回归守卫：`src/preview/__tests__/preview.test.tsx` 的「CardPreview image 填充方式与定比」组断言缺省与非法 `resizeMode` 回 cover、`0:1` 回 16:9，并静态校验 `.pv-card__img` 的上述四条声明（jsdom 不加载样式表，故读源文件断言）。
