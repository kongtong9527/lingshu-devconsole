import type { CoverBadge, ListTag } from '../types.js'
import type { Selected } from '../store.js'
import { toJumpPatch } from './jump.js'
import { badgeBackground, colorOf, formatText } from './CardPreview.js'

// 列表标签与封面角标（插件列表规则，老卡专用，有 card 时忽略）。
// 归一化 + 默认样式收敛一处，ListPreview / ExplorePreview 共用。

/** 标签行上限（单行横滑，保行高稳定；超限截断，与 iOS maxListTags 一致） */
export const MAX_LIST_TAGS = 6

export interface NormalizedTag {
  name: string
  url?: string
  target?: unknown
  backgroundColor?: unknown
  textColor?: unknown
  borderColor?: unknown
  navigable: boolean
}

/** 标签归一化：trim + 过滤空名 + 最多前 6 个（与 runtime 契约同序） */
export function normalizeListTags(tags: ListTag[] | undefined): NormalizedTag[] {
  if (!tags || tags.length === 0) return []
  const out: NormalizedTag[] = []
  for (const tag of tags) {
    if (typeof tag === 'string') {
      const name = tag.trim()
      if (name) out.push({ name, navigable: false })
    } else if (tag && typeof tag === 'object') {
      const name = String((tag as { name?: unknown }).name ?? '').trim()
      if (!name) continue
      const t = tag as { url?: unknown; target?: unknown; backgroundColor?: unknown; textColor?: unknown; borderColor?: unknown }
      const url = typeof t.url === 'string' ? t.url.trim() : ''
      const hasTarget = !!t.target && typeof (t.target as { action?: unknown }).action === 'string'
      out.push({
        name,
        url: url || undefined,
        target: hasTarget ? t.target : undefined,
        backgroundColor: t.backgroundColor,
        textColor: t.textColor,
        borderColor: t.borderColor,
        navigable: hasTarget || !!url,
      })
    }
    if (out.length >= MAX_LIST_TAGS) break
  }
  return out
}

/** 列表标签缺省单色（与 iOS `defaultListTagColors` 同值；插件带色则覆盖） */
export const TAG_DEFAULT_BACKGROUND = 'rgba(110, 110, 115, 0.14)'
/** 标签默认字色（与 iOS `DSColor.textSecondary` 浅色值一致） */
export const TAG_TEXT_COLOR = '#6E6E73'

/**
 * 列表标签缺省样式（单色，与标签名无关）。随机/分组配色由插件经颜色字段
 * 显式声明（全传同色即统一外观）——宿主不再按名哈希取色。
 */
export function defaultTagStyle(): { background: string; color: string } {
  return { background: TAG_DEFAULT_BACKGROUND, color: TAG_TEXT_COLOR }
}

/** 标签跳转 patch（有 target 优先内部导航，无则非空 url 包装为列表；均无返回 null 纯展示） */
export function tagJumpPatch(tag: NormalizedTag): Partial<Selected> | null {
  const patch = tag.target ? toJumpPatch(tag.target as Parameters<typeof toJumpPatch>[0]) : null
  if (patch) return patch
  if (tag.url) {
    return { action: 'list', url: tag.url, category: '', target: '', page: '1' }
  }
  return null
}

/** 标题下方标签行：单行横滑不换行；可导航项拦截跳列表，无路由项纯展示不冒泡 */
export function ListTags({ tags, onTagTarget }: {
  tags: NormalizedTag[]
  onTagTarget?: (patch: Partial<Selected>) => void
}) {
  if (tags.length === 0) return null
  return (
    <div className="pv-list-tags" role="list">
      {tags.map((tag, i) => {
        const fallback = defaultTagStyle()
        const style = {
          background: colorOf(tag.backgroundColor) ?? fallback.background,
          color: colorOf(tag.textColor) ?? fallback.color,
          borderColor: colorOf(tag.borderColor) ?? undefined,
        }
        if (!tag.navigable) {
          return (
            <span key={i} role="listitem" className="pv-list-tag" style={style}>
              {tag.name}
            </span>
          )
        }
        return (
          <button
            key={i}
            role="listitem"
            type="button"
            className="pv-list-tag pv-list-tag--button"
            style={style}
            aria-label={`查看标签 ${tag.name}`}
            onClick={(e) => {
              e.stopPropagation()
              const patch = tagJumpPatch(tag)
              if (patch) onTagTarget?.(patch)
            }}
          >
            {tag.name}
          </button>
        )
      })}
    </div>
  )
}

export interface NormalizedBadge {
  text: string
  background: string
  color: string
}

/** 角标归一化：字符串简写展开；空文本返回 null（该角不渲染） */
export function normalizeCoverBadge(badge: CoverBadge | undefined): NormalizedBadge | null {
  if (badge == null) return null
  if (typeof badge === 'string') {
    const text = badge.trim()
    return text ? { text, background: 'rgba(0,0,0,0.6)', color: '#fff' } : null
  }
  const b = badge as { text?: unknown; backgroundColor?: unknown; textColor?: unknown; opacity?: unknown }
  const text = formatText(b.text as string | { value: number; format: string } | undefined).trim()
  if (!text) return null
  return {
    text,
    background: badgeBackground({ backgroundColor: b.backgroundColor, opacity: b.opacity }),
    color: colorOf(b.textColor) ?? '#fff',
  }
}

/** 封面四角叠加（纯展示；无封面时调用方不挂载） */
export function CoverBadges({ badges }: {
  badges: { topLeft?: CoverBadge; topRight?: CoverBadge; bottomLeft?: CoverBadge; bottomRight?: CoverBadge } | undefined
}) {
  if (!badges) return null
  const slots = [
    { key: 'topLeft', badge: normalizeCoverBadge(badges.topLeft), cls: 'pv-cover-badge--tl' },
    { key: 'topRight', badge: normalizeCoverBadge(badges.topRight), cls: 'pv-cover-badge--tr' },
    { key: 'bottomLeft', badge: normalizeCoverBadge(badges.bottomLeft), cls: 'pv-cover-badge--bl' },
    { key: 'bottomRight', badge: normalizeCoverBadge(badges.bottomRight), cls: 'pv-cover-badge--br' },
  ] as const
  if (slots.every((s) => !s.badge)) return null
  return (
    <div className="pv-cover-badges" aria-hidden="true">
      {slots.map((s) => s.badge && (
        <span key={s.key} className={`pv-cover-badge ${s.cls}`} style={{ background: s.badge.background, color: s.badge.color }}>
          {s.badge.text}
        </span>
      ))}
    </div>
  )
}
