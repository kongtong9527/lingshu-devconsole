import { describe, expect, it } from 'vitest'
import type { CategoryGroup } from '../../types.js'
import {
  applyLinkageClear,
  categoryFromState,
  emptyGroupState,
  isGroupVisible,
  resolvedLinkedItems,
  visibleGroups,
} from '../filterState.js'

// 联动求值器回归锁（Q15-b）：与 iOS FilterStateTests/FilterLinkageTests 同案。
function group(patch: Partial<CategoryGroup> & { name: string; key: string }): CategoryGroup {
  return { ...patch } as CategoryGroup
}

const TYPE = () =>
  group({ name: '类型', key: 'type', type: 'select', items: [{ id: 'video', name: '视频' }, { id: 'album', name: '图集' }] })
const SORT = (patch: Partial<CategoryGroup> = {}) =>
  group({
    name: '排序', key: 'sort_by', type: 'sort',
    items: [{ id: 'total_videos', name: '最多收录' }],
    dependsOn: 'type',
    optionsWhen: {
      video: [{ id: 'total_videos', name: '最多收录' }],
      album: [{ id: 'total_albums', name: '最多收录' }],
    },
    ...patch,
  })

describe('isGroupVisible', () => {
  it('无边恒显，未知父容差显', () => {
    const s = emptyGroupState()
    expect(isGroupVisible(TYPE(), [TYPE()], s)).toBe(true)
    expect(isGroupVisible(group({ name: '子', key: 'c', dependsOn: 'ghost' }), [group({ name: '子', key: 'c', dependsOn: 'ghost' })], s)).toBe(true)
  })

  it('visibleWhen 命中才显（父空不等于任何非空值）', () => {
    const groups = [TYPE(), SORT({ visibleWhen: { equals: 'album' } })]
    expect(isGroupVisible(groups[1], groups, emptyGroupState())).toBe(false)
    const s = emptyGroupState()
    s.single['type'] = 'album'
    expect(isGroupVisible(groups[1], groups, s)).toBe(true)
    s.single['type'] = 'video'
    expect(isGroupVisible(groups[1], groups, s)).toBe(false)
  })

  it('父隐藏则后代恒隐', () => {
    const mid = group({ name: '中', key: 'mid', dependsOn: 'type', visibleWhen: { equals: 'album' } })
    const leaf = group({ name: '叶', key: 'leaf', dependsOn: 'mid' })
    const groups = [TYPE(), mid, leaf]
    const s = emptyGroupState()
    s.single['type'] = 'video'
    s.single['mid'] = 'x'
    expect(isGroupVisible(mid, groups, s)).toBe(false)
    expect(isGroupVisible(leaf, groups, s)).toBe(false)
  })
})

describe('resolvedLinkedItems', () => {
  it('无边/未命中回落 null，命中回映射表', () => {
    const groups = [TYPE(), SORT()]
    expect(resolvedLinkedItems(TYPE(), groups, emptyGroupState())).toBeNull()
    const s = emptyGroupState()
    s.single['type'] = 'album'
    expect(resolvedLinkedItems(groups[1], groups, s)).toEqual([{ id: 'total_albums', name: '最多收录' }])
    expect(resolvedLinkedItems(groups[1], groups, emptyGroupState())).toBeNull()
  })
})

describe('categoryFromState 跳过隐藏组', () => {
  it('隐藏组已选值不编码', () => {
    const groups = [TYPE(), SORT({ visibleWhen: { equals: 'album' } })]
    const s = emptyGroupState()
    s.single['type'] = 'video'
    s.single['sort_by'] = 'total_videos'
    expect(categoryFromState(groups, s)).toBe('type=video')
  })
})

describe('applyLinkageClear', () => {
  it('切父无条件清空子全切片（含方向）', () => {
    const groups = [TYPE(), SORT()]
    const prev = emptyGroupState()
    prev.single['type'] = 'video'
    prev.single['sort_by'] = 'total_videos'
    prev.ascending['sort_by'] = true
    const next = emptyGroupState()
    next.single['type'] = 'album'
    next.single['sort_by'] = 'total_videos'
    next.ascending['sort_by'] = true
    const out = applyLinkageClear(groups, prev, next)
    expect(out.single['sort_by']).toBe('')
    expect(out.ascending['sort_by']).toBeUndefined()
  })

  it('if-invalid 保留合法值、只清非法', () => {
    const groups = [TYPE(), SORT({ clearPolicy: 'if-invalid' })]
    const prev = emptyGroupState()
    prev.single['type'] = 'video'
    // title 两侧同值：切 album 后仍合法 → 保留
    const keepChild = group({
      name: '排序', key: 'sort_by', type: 'sort', dependsOn: 'type', clearPolicy: 'if-invalid',
      items: [{ id: 'title', name: '按字母' }],
      optionsWhen: { video: [{ id: 'title', name: '按字母' }], album: [{ id: 'title', name: '按字母' }] },
    })
    const next = emptyGroupState()
    next.single['type'] = 'album'
    next.single['sort_by'] = 'title'
    const out = applyLinkageClear([TYPE(), keepChild], prev, next)
    expect(out.single['sort_by']).toBe('title')
  })

  it('级联到孙组', () => {
    const dir = group({ name: '方向细则', key: 'detail', dependsOn: 'sort_by' })
    const groups = [TYPE(), SORT(), dir]
    const prev = emptyGroupState()
    prev.single['type'] = 'video'
    prev.single['sort_by'] = 'total_videos'
    prev.single['detail'] = 'x'
    const next = emptyGroupState()
    next.single['type'] = 'album'
    next.single['sort_by'] = 'total_videos'
    next.single['detail'] = 'x'
    const out = applyLinkageClear(groups, prev, next)
    expect(out.single['sort_by']).toBe('')
    expect(out.single['detail']).toBe('')
  })

  it('无父变原样返回（含引用相等）', () => {
    const groups = [TYPE(), SORT()]
    const s = emptyGroupState()
    s.single['type'] = 'video'
    expect(applyLinkageClear(groups, s, s)).toBe(s)
  })
})

describe('visibleGroups', () => {
  it('只留可见组', () => {
    const groups = [TYPE(), SORT({ visibleWhen: { equals: 'album' } })]
    expect(visibleGroups(groups, emptyGroupState()).map((g) => g.key)).toEqual(['type'])
    const s = emptyGroupState()
    s.single['type'] = 'album'
    expect(visibleGroups(groups, s).map((g) => g.key)).toEqual(['type', 'sort_by'])
  })
})
