import type { CategoryGroup, CategoryFilterType, CategoryNode } from '../types.js'

/**
 * 筛选表单的本地会话状态（DevConsole 调试台，不持久化）。
 * 与 iOS FilterState（ios/Lingshu/Models/FilterState.swift）同构：
 * 按分组 key 保存选择，应用时组合成category 查询串。
 * listings 页签的 filters 与 getCategories 共用同一套编码逻辑。
 * 筛选组联动求值器与 iOS 同算法：isGroupVisible / resolvedLinkedItems /
 * visibleGroups / applyLinkageClear（三端同输入同输出，单测同案锁定）。
 */
export interface GroupState {
  /** select / sort 的当前选项 id */
  single: Record<string, string>
  /** check 包含列表 */
  include: Record<string, string[]>
  /** check 排除列表（canExclude 时；编码带 `-` 前缀） */
  exclude: Record<string, string[]>
  /** text 输入值 */
  text: Record<string, string>
  /** sort 升/降序（canAscend 时） */
  ascending: Record<string, boolean>
}

export function emptyGroupState(): GroupState {
  return { single: {}, include: {}, exclude: {}, text: {}, ascending: {} }
}

/** 生效筛选类型：显式声明优先，否则 allowMultiple 兼容别名视为 check */
export function groupType(group: CategoryGroup): CategoryFilterType {
  if (group.type) return group.type
  return group.allowMultiple ? 'check' : 'select'
}

/**
 * 把 GroupState 组合成category 查询串（缺省组不输出）。
 * 与 iOS FilterState.categoryString 的编码逐条对齐：select `key=id`、
 * check `key=id1,id2,-id3`、text URL 编码、sort 可选 `,asc|desc` 后缀。
 * 同一 key 只输出一次（取最后出现的非空值，后者覆盖）——插件合法地让多组共享
 * 同一查询 key（摸摸分类 6 组共用 tagIds、跨组单选互斥），重复同名参数会让
 * 预览/角标重复、串也不干净；结果与站点「最后选中的标签生效」语义一致。
 */
export function categoryFromState(groups: CategoryGroup[], state: GroupState): string {
  const merged: Record<string, string> = {}
  const order: string[] = []
  for (const g of groups) {
    if (!isGroupVisible(g, groups, state)) continue
    const part = partForGroup(g, state)
    if (!part) continue
    if (!(g.key in merged)) order.push(g.key)
    merged[g.key] = part
  }
  return order.map((k) => merged[k]).join('&')
}

// ── 筛选组联动求值器（Q9/Q10/Q11/Q13）─────────────────────────────
// 运行期容差（Q12）：未知父当恒显、环截断、缺边忽略，永不抛错；硬失败只在 CLI 校验。

/** 非空父 key（trim 后空串视为无边） */
function parentKeyOf(group: CategoryGroup): string | null {
  const raw = typeof group.dependsOn === 'string' ? group.dependsOn.trim() : ''
  return raw ? raw : null
}

/** 组声明的全部叶子（items + sections 扁平） */
function declaredLeaves(group: CategoryGroup): CategoryNode[] {
  const items = Array.isArray(group.items) ? group.items : []
  const sections = Array.isArray(group.sections)
    ? group.sections.flatMap((s) => (Array.isArray(s?.items) ? s.items : []))
    : []
  return [...items, ...sections]
}

/** 清空策略（未知值回落 always） */
function clearPolicyOf(group: CategoryGroup): 'always' | 'if-invalid' {
  return group.clearPolicy === 'if-invalid' ? 'if-invalid' : 'always'
}

/**
 * 本组是否可见：无边恒显；父缺失容差显；父隐藏则后代恒隐（Q13-b）；
 * 有 visibleWhen 时父值命中 equals 才显（父空值不等于任何非空值，Q11）。
 * 环上重入截断为可见（校验侧已报错，运行期不连坐隐藏）。
 */
export function isGroupVisible(
  group: CategoryGroup,
  groups: CategoryGroup[],
  state: GroupState,
  visiting: Set<string> = new Set(),
): boolean {
  const parent = parentKeyOf(group)
  if (!parent) return true
  if (visiting.has(group.key)) return true
  visiting.add(group.key)
  const parentGroup = groups.find((g) => g.key === parent)
  if (!parentGroup) return true
  if (!isGroupVisible(parentGroup, groups, state, visiting)) return false
  const cond = group.visibleWhen
  if (!cond) return true
  const parentValue = state.single[parent] ?? ''
  const eq = (cond as { equals?: unknown }).equals
  if (eq === undefined || eq === null) return true
  return Array.isArray(eq) ? eq.map(String).includes(parentValue) : String(eq) === parentValue
}

/**
 * 联动映射选项：命中 optionsWhen[父值] 返回扁平数组（分节标题此时不展示），
 * 无边/无表/未命中/父空回落返回 null（调用方用默认 items/sections）。
 */
export function resolvedLinkedItems(
  group: CategoryGroup,
  groups: CategoryGroup[],
  state: GroupState,
): CategoryNode[] | null {
  const parent = parentKeyOf(group)
  if (!parent) return null
  if (!group.optionsWhen || typeof group.optionsWhen !== 'object') return null
  const parentValue = state.single[parent] ?? ''
  const hit = (group.optionsWhen as Record<string, unknown>)[parentValue]
  return Array.isArray(hit) ? (hit as CategoryNode[]) : null
}

/** 可见组（渲染/编码/角标统一入口） */
export function visibleGroups(groups: CategoryGroup[], state: GroupState): CategoryGroup[] {
  return groups.filter((g) => isGroupVisible(g, groups, state))
}

/** 子组在给定状态下的合法单值 id 集（映射命中用映射，否则用声明集） */
function allowedSingleIds(group: CategoryGroup, groups: CategoryGroup[], state: GroupState): Set<string> {
  const linked = resolvedLinkedItems(group, groups, state)
  const leaves = linked ?? declaredLeaves(group)
  return new Set(leaves.map((n) => n?.id ?? ''))
}

/** 清空一组的全部状态切片 */
function clearGroupFully(key: string, draft: GroupState): void {
  draft.single[key] = ''
  draft.include[key] = []
  draft.exclude[key] = []
  draft.text[key] = ''
  delete draft.ascending[key]
}

/**
 * 切父清子（Q7 全切片 + 传递级联）：比较 prev→next 的父单值变化，
 * 对传递后代按 clearPolicy 清空（always 全清，if-invalid 只清非法值）。
 * 输入输出均为新对象，不改入参；无父变原样返回 next。
 */
export function applyLinkageClear(
  groups: CategoryGroup[],
  prev: GroupState,
  next: GroupState,
): GroupState {
  const hasEdge = groups.some((g) => parentKeyOf(g))
  if (!hasEdge) return next
  const childrenOf = new Map<string, CategoryGroup[]>()
  for (const g of groups) {
    const parent = parentKeyOf(g)
    if (!parent) continue
    const list = childrenOf.get(parent) ?? []
    list.push(g)
    childrenOf.set(parent, list)
  }
  const changed: string[] = []
  for (const parent of childrenOf.keys()) {
    if ((prev.single[parent] ?? '') !== (next.single[parent] ?? '')) changed.push(parent)
  }
  if (!changed.length) return next

  const draft: GroupState = {
    single: { ...next.single },
    include: { ...(next.include as Record<string, string[]>) },
    exclude: { ...(next.exclude as Record<string, string[]>) },
    text: { ...next.text },
    ascending: { ...next.ascending },
  }
  const clearOne = (child: CategoryGroup): boolean => {
    const key = child.key
    const before = draft.single[key] ?? ''
    if (clearPolicyOf(child) === 'always') {
      clearGroupFully(key, draft)
    } else {
      const allowed = allowedSingleIds(child, groups, draft)
      const cur = draft.single[key] ?? ''
      if (cur && !allowed.has(cur)) {
        draft.single[key] = ''
        delete draft.ascending[key]
      }
      const keep = (ids: string[] | undefined) => (ids ?? []).filter((id) => allowed.has(id))
      draft.include[key] = keep(draft.include[key])
      draft.exclude[key] = keep(draft.exclude[key])
    }
    return (draft.single[key] ?? '') !== before
  }

  // 一阶段：值级联（父单值变 → 直系子按策略清，子单值变再向下传；环上重入截断）
  const visited = new Set<string>(changed)
  const queue = [...changed]
  let guard = 0
  while (queue.length && guard++ < groups.length * 2 + 8) {
    const parent = queue.shift()!
    for (const child of childrenOf.get(parent) ?? []) {
      if (child.key === parent) continue // 自环运行期忽略（校验侧已报错）
      if (visited.has(child.key)) continue
      const valueChanged = clearOne(child)
      if (valueChanged && !visited.has(child.key)) {
        visited.add(child.key)
        queue.push(child.key)
      } else {
        visited.add(child.key)
      }
    }
  }

  // 二阶段：隐藏扫荡（Q10：变隐藏的那一刻同样按策略清；值未变但显隐翻转时补清）
  // 父隐藏则后代恒隐（isGroupVisible 已含传递），编码侧本就跳过隐藏组，
  // 此处把幽灵值清掉，避免切回显现时复活。
  for (let pass = 0; pass <= groups.length; pass++) {
    let swept = false
    for (const g of groups) {
      if (!parentKeyOf(g)) continue
      if (isGroupVisible(g, groups, draft)) continue
      const key = g.key
      const s0 = draft.single[key] ?? ''
      const i0 = (draft.include[key] ?? []).length
      const e0 = (draft.exclude[key] ?? []).length
      const t0 = draft.text[key] ?? ''
      clearOne(g)
      // 隐藏组在 if-invalid 下 text 恒保留：隐藏即不可见的值不存在，text 同样清掉
      if ((g as CategoryGroup).clearPolicy === 'if-invalid' && (draft.text[key] ?? '')) {
        draft.text[key] = ''
      }
      if (
        (draft.single[key] ?? '') !== s0 ||
        (draft.include[key] ?? []).length !== i0 ||
        (draft.exclude[key] ?? []).length !== e0 ||
        (draft.text[key] ?? '') !== t0
      ) {
        swept = true
      }
    }
    if (!swept) break
  }
  return draft
}

function partForGroup(g: CategoryGroup, state: GroupState): string {
  const type = groupType(g)
  switch (type) {
    case 'check': {
      const inc = state.include[g.key] || []
      const exc = state.exclude[g.key] || []
      if (!inc.length && !exc.length) return ''
      return `${g.key}=${[...inc, ...exc.map((id) => `-${id}`)].join(',')}`
    }
    case 'text': {
      const value = (state.text[g.key] || '').trim()
      return value ? `${g.key}=${encodeURIComponent(value)}` : ''
    }
    case 'sort': {
      const id = state.single[g.key]
      if (!id) return ''
      const asc = state.ascending[g.key]
      const dir = g.canAscend && asc !== undefined ? (asc ? ',asc' : ',desc') : ''
      return `${g.key}=${id}${dir}`
    }
    default: {
      const id = state.single[g.key]
      return id ? `${g.key}=${id}` : ''
    }
  }
}

/**
 * 合并 listing 自带 category 与筛选组合：
 * listing.category 是目录页基础参数（如 "tid=1"），筛选组是用户后选的额外维度。
 * 两者同走编码；约定筛选组 key 不应与 listing.category 已有 key 重复，
 * 若重复以筛选值覆盖（拼接在后的同名键由 fetchList.parseCategory 后者覆盖前者）。
 */
export function mergeListingCategory(base: string, filterCategory: string): string {
  if (!filterCategory) return base
  if (!base) return filterCategory
  return `${base}&${filterCategory}`
}