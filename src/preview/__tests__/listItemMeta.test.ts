import { describe, it, expect } from 'vitest'
import {
  MAX_LIST_TAGS,
  TAG_DEFAULT_BACKGROUND,
  TAG_TEXT_COLOR,
  defaultTagStyle,
  normalizeCoverBadge,
  normalizeListTags,
  tagJumpPatch,
} from '../ListItemMeta.js'

// 列表标签与封面角标归一化（插件列表规则，老卡专用）：纯函数契约，与 iOS ListItemBadgesTests 同断言。

describe('normalizeListTags', () => {
  it('字符串简写展开、空名过滤', () => {
    expect(normalizeListTags(['#阿嬤', '  ', '', '#往事'])).toEqual([
      expect.objectContaining({ name: '#阿嬤', navigable: false }),
      expect.objectContaining({ name: '#往事', navigable: false }),
    ])
  })

  it('缺省/空隐藏（返回空数组，调用方不挂载整行）', () => {
    expect(normalizeListTags(undefined)).toEqual([])
    expect(normalizeListTags([])).toEqual([])
  })

  it('对象形态保留跳转与样式、可导航判定', () => {
    const target = { action: 'list', url: 'https://example.com/tags/x' } as const
    const [a, b, c] = normalizeListTags([
      { name: '#風流', target },
      { name: '#纯展示', url: 'https://example.com/tags/y' },
      { name: '#不可点' },
    ])
    expect(a.navigable).toBe(true)
    expect(a.target).toBe(target)
    expect(b.navigable).toBe(true)
    expect(b.url).toBe('https://example.com/tags/y')
    expect(c.navigable).toBe(false)
  })

  it('上限截断（最多前 6 个）', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `#t${i}`)
    const out = normalizeListTags(tags)
    expect(out).toHaveLength(MAX_LIST_TAGS)
    expect(out[0].name).toBe('#t0')
    expect(out[MAX_LIST_TAGS - 1].name).toBe(`#t${MAX_LIST_TAGS - 1}`)
  })

  it('空名对象过滤', () => {
    expect(normalizeListTags([{ name: '   ' }, '#ok'])).toEqual([
      expect.objectContaining({ name: '#ok' }),
    ])
  })
})

describe('tagJumpPatch', () => {
  it('有 target 优先内部导航', () => {
    const target = { action: 'list', url: 'https://example.com/tags/x' } as const
    const [tag] = normalizeListTags([{ name: '#風流', target }])
    expect(tagJumpPatch(tag)).toMatchObject({ action: 'list', url: 'https://example.com/tags/x' })
  })

  it('无 target 时非空 url 包装为列表', () => {
    const [tag] = normalizeListTags([{ name: '#往事', url: 'https://example.com/tags/y' }])
    expect(tagJumpPatch(tag)).toMatchObject({ action: 'list', url: 'https://example.com/tags/y' })
  })

  it('均无返回 null（纯展示，调用方不冒泡整卡）', () => {
    const [tag] = normalizeListTags(['#不可点'])
    expect(tagJumpPatch(tag)).toBeNull()
  })
})

describe('normalizeCoverBadge', () => {
  it('字符串简写展开、空串返回 null', () => {
    expect(normalizeCoverBadge('連載中')).toMatchObject({ text: '連載中' })
    expect(normalizeCoverBadge('  ')).toBeNull()
    expect(normalizeCoverBadge(undefined)).toBeNull()
  })

  it('格式化时长宿主统一格式化（750 秒 → 12:30）', () => {
    expect(normalizeCoverBadge({ text: { value: 750, format: 'duration' } })).toMatchObject({ text: '12:30' })
  })

  it('格式化次数中文万进制', () => {
    expect(normalizeCoverBadge({ text: { value: 12000, format: 'count' } })).toMatchObject({ text: '1.2万' })
  })

  // 与 iOS `LingshuTests/RelativeTimeFormatTests` 逐档同口径：恒「…前」，>24h 也不落绝对日期
  it('格式化相对时间恒「…前」（天/月/年，勿回落 toLocaleDateString）', () => {
    // 各档取桶内点（+30/+60s 缓冲），避免测试自身与档位边界抖动
    const text = (seconds: number) =>
      normalizeCoverBadge({ text: { value: Date.now() - seconds * 1000, format: 'relative' } })?.text
    expect(text(30)).toBe('刚刚')
    expect(text(5 * 60 + 30)).toBe('5分钟前')
    expect(text(3 * 3600 + 30)).toBe('3小时前')
    expect(text(2 * 86400 + 60)).toBe('2天前')
    expect(text(29 * 86400 + 60)).toBe('29天前')
    expect(text(30 * 86400 + 60)).toBe('1个月前')
    expect(text((11 * 30 + 1) * 86400)).toBe('11个月前')
    expect(text(365 * 86400 + 60)).toBe('1年前')
    expect(text(800 * 86400 + 60)).toBe('2年前')
    for (const days of [1, 7, 100, 359, 364, 365, 1000]) {
      expect(text(days * 86400 + 60)).toMatch(/前$/)
    }
  })
})

describe('defaultTagStyle', () => {
  it('缺省单色（与标签名无关；与 iOS defaultListTagColors 同值）', () => {
    expect(defaultTagStyle()).toEqual({ background: TAG_DEFAULT_BACKGROUND, color: TAG_TEXT_COLOR })
    expect(defaultTagStyle()).toEqual(defaultTagStyle())
  })
})
