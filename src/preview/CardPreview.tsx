// **必须走 `lingshu-runtime/card-dsl` 子路径**（浏览器安全出口），别从包根 import：
// 包根 `dist/lib.js` 是**Node 宿主**入口，会带进 `runtime/storage.js` 等 Node-only 模块
// （`node:fs`/`node:url`），vite 的生产构建会因此报
// `"fileURLToPath" is not exported by "__vite-browser-external"` 而整包构建失败
// （2026-10 实测：母仓 CI 只跑 typecheck+test，`vite build` 的这条从没被覆盖，直到公开仓 CI 跑 `npm run build`）。
// 类型 import 无所谓（编译期擦除），值 import 一律走子路径。
import { shouldFallbackCard as runtimeShouldFallbackCard } from 'lingshu-runtime/card-dsl'
import type { CardDSL } from 'lingshu-runtime'
import type { ImageTransport, ListItem } from '../types.js'
import { proxyUrl } from '../api/proxy.js'
import LazyImage from './LazyImage.js'
import { getImageEncryption } from './imageEncryption.js'
import { isInvokeStub, isNoopTarget } from './jump.js'

// 卡片 DSL 布局预览（ADR-0050 v1）：与 iOS CardView 同语义，样式可略差，只保布局正确性。
// 安全：未知节点跳过，根非法由调用方回退老卡。
// 点击：无 target 冒泡到整卡；有显式 target（含 noop）拦截不冒泡；invoke 留桩禁用+warn；actionBar 跟整卡。

type CardText = string | { value: number; format: string }

/** 文本格式化（宿主统一格式化，列表标签/封面角标复用，与 iOS CardFormat 同语义） */
export function formatText(t: CardText | undefined): string {
  if (t == null) return ''
  if (typeof t === 'string') return t
  const { value, format } = t as { value: number; format: string }
  if (format === 'duration') {
    const s = Math.floor(value)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  if (format === 'count') {
    if (value >= 10000) return `${parseFloat((value / 10000).toFixed(1))}万`
    if (value >= 1000) return `${parseFloat((value / 1000).toFixed(1))}K`
    return String(value)
  }
  if (format === 'relative') {
    // 与 iOS `RelativeTime`（DesignSystem/Components/CardView.swift）**逐档同口径**：
    // 全档位恒「…前」，>24h 也**不落绝对日期**（预览若与 App 不一致 = 预览骗人，
    // 见 ios/docs/card-dsl.md「数字」条）
    const s = Math.floor((Date.now() - value) / 1000)
    if (s < 60) return '刚刚'
    if (s < 3600) return `${Math.floor(s / 60)}分钟前`
    if (s < 86400) return `${Math.floor(s / 3600)}小时前`
    const days = Math.floor(s / 86400)
    if (days < 30) return `${days}天前`
    const months = Math.floor(days / 30)
    if (months < 12) return `${months}个月前`
    return `${Math.max(Math.floor(days / 365), 1)}年前`
  }
  if (format === 'date' || format === 'datetime') return new Date(value).toLocaleString()
  return String(value)
}

/** 插件颜色解析（列表标签/封面角标复用；语义色回退继承，未知走原文） */
export function colorOf(c: unknown): string | undefined {
  if (!c) return undefined
  if (typeof c === 'string') {
    // 卡片底色映射预览主题表面色（两端 $surface 都是“页面之上的分层”，iOS 走 DSColor.surface）；
    // 其余语义色走 CSS 变量回退（继承周围预览主题文字色）。
    if (c === '$surface') return 'var(--pv-color-surface)'
    if (c.startsWith('$')) return undefined
    return c
  }
  const o = c as { light?: string; dark?: string }
  return o.light
}

/** 徽标底合成（含插件透明度旋钮）：底色 × opacity（缺省 1），只淡底（color-mix 乘 alpha），图标/文字不动 */
export function badgeBackground(ov: { backgroundColor?: unknown; opacity?: unknown }): string {
  const base = colorOf(ov.backgroundColor) ?? 'rgba(0,0,0,0.6)'
  const o = typeof ov.opacity === 'number' && Number.isFinite(ov.opacity)
    ? Math.min(Math.max(ov.opacity, 0), 1) : 1
  if (o >= 1) return base
  return `color-mix(in srgb, ${base} ${Math.round(o * 100)}%, transparent)`
}

/** 圆形钮直径 px（仅 shape:circle 有效；非法回缺省 34，与 iOS 同语义） */
function badgeSize(ov: { size?: unknown }): number {
  const s = ov.size
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 34
}

function paddingStyle(padding: unknown): React.CSSProperties {
  if (typeof padding === 'number') return { padding }
  if (Array.isArray(padding)) {
    const nums = (padding as unknown[]).filter((n): n is number => typeof n === 'number')
    if (nums.length === 2) return { padding: `${nums[0]}px ${nums[1]}px` }
    if (nums.length === 4) return { padding: `${nums[0]}px ${nums[1]}px ${nums[2]}px ${nums[3]}px` }
  }
  return {}
}

function flexStyle(flex: unknown): React.CSSProperties {
  if (typeof flex !== 'number') return {}
  return { flex: `${flex} 1 0%`, minWidth: 0 }
}

function justifyStyle(justify: unknown): React.CSSProperties {
  if (justify === 'start') return { justifyContent: 'flex-start', width: '100%' }
  if (justify === 'center') return { justifyContent: 'center', width: '100%' }
  if (justify === 'end') return { justifyContent: 'flex-end', width: '100%' }
  return {}
}

function radiusStyle(radius: unknown): React.CSSProperties {
  if (radius === 'auto') return { borderRadius: 12 }
  if (typeof radius === 'number') return { borderRadius: radius }
  return {}
}

function aspectStyle(aspect?: string): React.CSSProperties {
  switch (aspect) {
    case '16:9': return { aspectRatio: '16/9' }
    case '4:3': return { aspectRatio: '4/3' }
    case '3:4': return { aspectRatio: '3/4' }
    case '2:3': return { aspectRatio: '2/3' }
    case '1:1':
    case 'circle': return { aspectRatio: '1/1' }
    default: {
      // 通用 W:H 解析（如 video_site_g 宫格 1.86:1）：W/H 必须为正有限数才采用，否则回退 16:9
      // （与 runtime isLegalAspect / iOS 同口径；'0:1' 曾漏成 aspectRatio:'0/1' 被浏览器整条丢弃）。
      const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspect ?? ''))
      const w = m ? Number(m[1]) : NaN
      const h = m ? Number(m[2]) : NaN
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { aspectRatio: `${w}/${h}` }
      return { aspectRatio: '16/9' }
    }
  }
}

/** 图片填充方式归一化（与 iOS CardCoverImageView 同语义）：只有 'contain' 判等命中，
 *  缺省与非法值一律回 cover（零回归，不报错不炸卡；runtime 侧另有 lint warning）。 */
function objectFitStyle(resizeMode: unknown): React.CSSProperties {
  return { objectFit: resizeMode === 'contain' ? 'contain' : 'cover' }
}

function NodeView({ node, item, onNodeTarget }: { node: any; item: ListItem; onNodeTarget?: (target: any) => void }) {
  if (!node || typeof node.type !== 'string') return null
  // 节点点击属性：无 target 返回空（冒泡到整卡）；有则拦截（stopPropagation）
  const tapProps = (target: any): React.HTMLAttributes<HTMLElement> & { style?: React.CSSProperties } => {
    if (!target || typeof target.action !== 'string') return {}
    if (isNoopTarget(target)) {
      return { onClick: (e) => e.stopPropagation() }
    }
    if (isInvokeStub(target)) {
      return {
        onClick: (e) => {
          e.stopPropagation()
          console.warn(`[CardDSL] invoke预览留桩禁用 function=${String((target as { call?: { function?: unknown } }).call?.function ?? '')}，写侧验证走 runtime/iOS`)
        },
        style: { opacity: 0.55, cursor: 'not-allowed' },
        role: 'button' as unknown as undefined,
      }
    }
    return {
      onClick: (e) => {
        e.stopPropagation()
        onNodeTarget?.(target)
      },
      style: { cursor: 'pointer' },
      role: 'button' as unknown as undefined,
    }
  }
  const mergeStyle = (...styles: Array<React.CSSProperties | undefined>): React.CSSProperties => Object.assign({}, ...styles)
  switch (node.type) {
    case 'stack': {
      const dir = node.direction === 'column' ? 'column' : 'row'
      const tap = tapProps(node.target)
      return (
        <div onClick={tap.onClick} style={mergeStyle({ display: 'flex', flexDirection: dir, gap: node.gap ?? 8, alignItems: node.alignItems === 'start' ? 'flex-start' : node.alignItems === 'end' ? 'flex-end' : 'center', background: colorOf(node.backgroundColor), overflow: node.backgroundColor ? 'hidden' : undefined, ...radiusStyle(node.borderRadius), ...paddingStyle(node.padding), ...justifyStyle(node.justifyContent), ...flexStyle(node.flex) }, tap.style)}>
          {(node.children ?? []).slice(0, 20).map((c: unknown, i: number) => (
            <NodeView key={i} node={c} item={item} onNodeTarget={onNodeTarget} />
          ))}
        </div>
      )
    }
    case 'text': {
      const tap = tapProps(node.target)
      return (
        <div
          onClick={tap.onClick}
          style={mergeStyle({
            color: colorOf(node.textColor),
            textAlign: node.textAlign ?? 'left',
            display: '-webkit-box',
            WebkitLineClamp: node.maxLines ?? 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            ...flexStyle(node.flex),
          }, tap.style)}
        >
          {formatText(node.text)}
        </div>
      )
    }
    case 'image': {
      const overlays = (node.overlays ?? []).slice(0, 5)
      const tap = tapProps(node.target)
      return (
        <div onClick={tap.onClick} style={mergeStyle({ position: 'relative', width: '100%', minWidth: 0, ...aspectStyle(node.aspect), overflow: 'hidden', borderRadius: 12, ...flexStyle(node.flex) }, tap.style)}>
          <LazyImage
            src={proxyUrl(node.src, node.decrypt ?? getImageEncryption(item.metadata), (node.transport ?? item.metadata?.imageTransport) as ImageTransport | undefined)}
            alt=""
            className="pv-card__img"
            style={objectFitStyle(node.resizeMode)}
          />
          {overlays.map((ov: any, i: number) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                ...(ov.position === 'topRight' ? { top: 6, right: 6 } : ov.position === 'bottomLeft' ? { bottom: 6, left: 6 } : ov.position === 'bottomRight' ? { bottom: 6, right: 6 } : ov.position === 'center' ? { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' } : { top: 6, left: 6 }),
                background: badgeBackground(ov),
                color: colorOf(ov.textColor) ?? '#fff',
                // 徽标形状由插件声明：circle = 圆形钮（直径走 ov.size 缺省 34px，图标同比），缺省 rounded 小胶囊
                ...(ov.shape === 'circle'
                  ? { borderRadius: 999, width: badgeSize(ov), height: badgeSize(ov), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: badgeSize(ov) * 14 / 34 }
                  : { borderRadius: 6, padding: '2px 6px', fontSize: 12 }),
              }}
            >
              {formatText(ov.text)}
            </span>
          ))}
        </div>
      )
    }
    case 'avatar': {
      const tap = tapProps(node.target)
      return (
        <div onClick={tap.onClick} style={tap.style}>
        <LazyImage
          src={proxyUrl(node.src, node.decrypt ?? getImageEncryption(item.metadata), (node.transport ?? item.metadata?.imageTransport) as ImageTransport | undefined)}
          alt=""
          className="pv-card__avatar"
          style={node.flex != null ? { flex: `${node.flex} 1 0%` } : undefined}
        />
        </div>
      )
    }
    case 'grid': {
      const tap = tapProps(node.target)
      return (
        <div onClick={tap.onClick} style={mergeStyle({ display: 'grid', width: '100%', minWidth: 0, gridTemplateColumns: `repeat(${Math.min(Math.max(node.columns ?? 2, 1), 3)}, 1fr)`, gap: node.gap ?? 8, ...flexStyle(node.flex) }, tap.style)}>
          {(node.children ?? []).slice(0, 4).map((c: unknown, i: number) => (
            <NodeView key={i} node={c} item={item} onNodeTarget={onNodeTarget} />
          ))}
        </div>
      )
    }
    case 'pill': {
      const tap = tapProps(node.target)
      if ((node as { shape?: unknown }).shape === 'circle') {
        // 固定圆形徽（序号/名次用）：直径固定，多位数降字号适配，不断宽成胶囊（iOS 为准，此处近似）。
        const d = typeof (node as { size?: unknown }).size === 'number' && Number.isFinite((node as { size?: number }).size) && ((node as { size?: number }).size as number) > 0
          ? ((node as { size?: number }).size as number) : 24
        const label = formatText(node.text)
        const fontSize = label.length >= 3 ? 10 : label.length >= 2 ? 11 : 12
        return (
          <span className="pv-card__pill" onClick={tap.onClick} style={mergeStyle({ background: colorOf(node.backgroundColor), color: colorOf(node.textColor), width: d, height: d, padding: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize, lineHeight: 1, overflow: 'hidden', whiteSpace: 'nowrap', ...flexStyle(node.flex) }, tap.style)}>
            {label}
          </span>
        )
      }
      return (
        <span className="pv-card__pill" onClick={tap.onClick} style={mergeStyle({ background: colorOf(node.backgroundColor), color: colorOf(node.textColor), ...flexStyle(node.flex) }, tap.style)}>
          {formatText(node.text)}
        </span>
      )
    }
    case 'actionBar':
      // 本版跟整卡走：忽略 items[].target（deprecated 占位），冒泡到整卡
      return (
        <div style={{ display: 'flex', gap: 16, color: '#888' }}>
          {(node.items ?? []).slice(0, 4).map((it: any, i: number) => (
            <span key={i} style={{ fontSize: 12 }}>
              {formatText(it.text)}
            </span>
          ))}
        </div>
      )
    case 'spacer':
      // 无 length 即弹性（双向撑满父容器剩余空间，横向顶右/纵向顶底就靠它）；
      // 有 length 即固定高度占位（历史行为）。
      if (node.length != null) return <div style={{ height: node.length }} />
      return <div style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0 }} />
    case 'divider':
      // 全宽细分隔线（榜单行之间）：缺省走主题边框色，与 iOS DSColor.separator 同位。
      return <div style={{ height: 1, width: '100%', minWidth: 0, background: colorOf(node.color) ?? 'var(--pv-color-border)' }} />
    case 'date': {
      const tap = tapProps(node.target)
      return <div onClick={tap.onClick} style={mergeStyle({ fontSize: 12, color: '#888' }, tap.style)}>{node.date}</div>
    }
    default:
      return null // 未知节点跳过（Q20）
  }
}

/**
 * 整卡回退判定 = **runtime 的唯一实现**（`lingshu-runtime` 的 `shouldFallbackCard`），
 * 预览不得自写一套：曾经三端口径不一（未知 root：iOS 回退、runtime/预览不回退），
 * 由 contracts/conformance/card-root.json 的语料抓出（2026-10 统一为「未知 root 回退老卡」）。
 */
export function shouldFallbackCard(item: ListItem): boolean {
  return runtimeShouldFallbackCard((item as { card?: CardDSL }).card)
}

export default function CardPreview({ item, onNodeTarget }: { item: ListItem; onNodeTarget?: (target: any) => void }) {
  const card = (item as { card?: { root: unknown; accessibilityLabel?: string } }).card
  if (!card || shouldFallbackCard(item)) return null
  return (
    <div aria-label={(card as { accessibilityLabel?: string }).accessibilityLabel ?? item.title}>
      <NodeView node={(card as { root: unknown }).root} item={item} onNodeTarget={onNodeTarget} />
    </div>
  )
}
