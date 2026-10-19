import { useState, type ReactNode } from 'react'
import type { CategoryGroup, CategoryNode } from '../types.js'
import type { GroupState } from './filterState.js'
import { groupType, resolvedLinkedItems } from './filterState.js'

/** 模式标签：与筛选类型对应的控件形态说明 */
export function modeLabel(type: string, group: CategoryGroup): string {
  switch (type) {
    case 'check': {
      const tag = group.display === 'tags' ? '·标签' : ''
      return group.canExclude ? `多选${tag}·可排除` : `多选${tag}`
    }
    case 'text': return '文本'
    case 'sort': return group.canAscend ? '排序·可升降' : '排序'
    default: return '单选'
  }
}

/**
 * 长组折叠阈值：select/sort 组条目数超过该值时默认只显示前 N 条 + 「展开全部」toggle chip
 * （点击展开/收起）。纯展示级（不持久化，不参与筛选 state），让长维度组（如 A-Z 27 项、
 * movie_site_c 题材 29 项/地区 27 项）不占满整行。
 */
const LONG_GROUP_THRESHOLD = 16

interface Props {
  group: CategoryGroup
  state: GroupState
  onChange: (state: GroupState) => void
  /** 同数组全量分组（联动寻址父选项用；缺省=无联动，按声明渲染） */
  groups?: CategoryGroup[]
}

/**
 * 单个筛选分组（widget）的渲染：
 * select 单选 chips / check 勾选（canExclude 含排除）/ text 输入框 / sort 排序+可选升降序。
 * check + display:'tags' = 多选 tag 样式：芯片云三态循环（未选→包含→排除→未选），
 * 与复选框行同状态同编码（纯展示切换）。
 * 分节单组（sections）：一个 widget 内按节分组展示（节标题纯展示），各节叶子读写
 * 同一 key 的状态、编码一次输出（与站内单面板多分区的筛选 UI 同构，如 anime_site_a 内容标签）。
 * 无 sections 时退化为无标题单节（旧行为零改动）。
 * DevConsole 的 CategoriesPreview（getCategories）与 ListingsPreview（listing.filters，
 *）共用本组件，保证两种来源的筛选 UI 行为一致。
 */
export function FilterGroupEditor({ group, state, onChange, groups }: Props) {
  const type = groupType(group)
  // 多选展示形态：display:'tags' = 多选 tag 样式（芯片云三态循环），缺省/未知 = 复选框列表。
  // 纯展示切换——两种形态读写同一份 include/exclude 状态、同一编码。非 check 组忽略本字段。
  const isCheckTags = type === 'check' && group.display === 'tags'
  // 联动映射命中时按单节扁平渲染（节标题不展示，见 types 注释）；未命中回落声明集
  const linked = groups ? resolvedLinkedItems(group, groups, state) : null
  // 分节视图：有 sections 按节渲染（单 widget 多节），否则无标题单节（旧行为）
  const sections: Array<{ title?: string; items: CategoryNode[] }> = linked
    ? [{ items: linked }]
    : group.sections?.length
      ? group.sections.map((s) => ({ title: s.title, items: s.items || [] }))
      : [{ items: group.items || [] }]
  const totalLeaves = sections.reduce((n, s) => n + s.items.length, 0)
  // 长组折叠（纯展示级 UI 状态，不持久化；重置筛选/重进预览时回到折叠态）：
  // 仅无分节组启用，分节组按节完整渲染（分节本身即站内 UI 的全量展示）
  const [expanded, setExpanded] = useState(false)
  const isLongGroup = sections.length === 1 && type !== 'check' && totalLeaves > LONG_GROUP_THRESHOLD
  const shownItems = isLongGroup && !expanded ? sections[0].items.slice(0, LONG_GROUP_THRESHOLD) : sections[0].items

  const setSingle = (key: string, id: string) =>
    onChange({
      ...state,
      single: { ...state.single, [key]: state.single[key] === id ? '' : id },
    })

  const toggleInclude = (key: string, id: string) => {
    const cur = state.include[key] || []
    const include = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    const exclude = (state.exclude[key] || []).filter((x) => x !== id)
    onChange({ ...state, include: { ...state.include, [key]: include }, exclude: { ...state.exclude, [key]: exclude } })
  }

  const toggleExclude = (key: string, id: string) => {
    const cur = state.exclude[key] || []
    const exclude = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    const include = (state.include[key] || []).filter((x) => x !== id)
    onChange({ ...state, include: { ...state.include, [key]: include }, exclude: { ...state.exclude, [key]: exclude } })
  }

  const hasChildren = sections.some((s) => s.items.some((n) => n.children?.length))

  // 多选 tag 芯片三态循环（display:'tags'）：未选 → 包含 → （canExclude 时）排除 → 未选。
  // 与复选框行（勾选 + 独立排除按钮）同状态同编码，只是单芯片形态（芯片云放不下行内双控件）。
  const cycleCheckTag = (id: string) => {
    const inc = state.include[group.key] || []
    const exc = state.exclude[group.key] || []
    if (inc.includes(id)) {
      const include = inc.filter((x) => x !== id)
      const exclude = group.canExclude ? [...exc.filter((x) => x !== id), id] : exc.filter((x) => x !== id)
      onChange({ ...state, include: { ...state.include, [group.key]: include }, exclude: { ...state.exclude, [group.key]: exclude } })
    } else if (exc.includes(id)) {
      onChange({ ...state, include: { ...state.include, [group.key]: inc }, exclude: { ...state.exclude, [group.key]: exc.filter((x) => x !== id) } })
    } else {
      onChange({ ...state, include: { ...state.include, [group.key]: [...inc, id] }, exclude: { ...state.exclude, [group.key]: exc.filter((x) => x !== id) } })
    }
  }

  // 同一 key 状态共享：分节各节读写同一 key（state.single/include[key]），天然并集/互斥
  const checkRow = (node: CategoryNode, key: string) => {
    const included = (state.include[group.key] || []).includes(node.id)
    const excluded = (state.exclude[group.key] || []).includes(node.id)
    return (
      <div key={key} className="pv-check-row">
        <label className="pv-check-label">
          <input
            type="checkbox"
            checked={included}
            onChange={() => toggleInclude(group.key, node.id)}
          />
          <span>{node.name}</span>
        </label>
        {group.canExclude && (
          <button
            type="button"
            className={`pv-chip pv-chip--small${excluded ? ' pv-chip--exclude' : ''}`}
            aria-pressed={excluded}
            onClick={() => toggleExclude(group.key, node.id)}
          >
            排除
          </button>
        )}
      </div>
    )
  }

  const selectChip = (node: CategoryNode, key: string) => {
    const on = state.single[group.key] === node.id
    return (
      <button
        key={key}
        type="button"
        className="pv-chip"
        aria-pressed={on}
        onClick={() => setSingle(group.key, node.id)}
      >
        {node.name}
      </button>
    )
  }

  // 多选 tag 芯片（display:'tags'）：选中态沿用 pv-chip pressed，排除态叠加 pv-chip--exclude。
  const checkTag = (node: CategoryNode, key: string) => {
    const included = (state.include[group.key] || []).includes(node.id)
    const excluded = (state.exclude[group.key] || []).includes(node.id)
    return (
      <button
        key={key}
        type="button"
        className={`pv-chip${excluded ? ' pv-chip--exclude' : ''}`}
        aria-pressed={included || excluded}
        title={group.canExclude ? '点击循环：未选 → 包含 → 排除 → 未选' : '点击切换选中'}
        onClick={() => cycleCheckTag(node.id)}
      >
        {node.name}
      </button>
    )
  }

  // 分节区渲染：节标题 + 本节选项（身份按节下标+选项 id，勿只用 id——跨节理论可重 id）
  const renderSections = (renderItem: (node: CategoryNode, key: string) => ReactNode, listClass: string) => (
    <>
      {sections.map((sec, si) => (
        <div key={si} className="pv-section">
          {sec.title && <div className="pv-section__title">{sec.title}</div>}
          <div className={listClass} role="group" aria-label={sec.title || group.name}>
            {sec.items.map((node) => renderItem(node, `${si}:${node.id}`))}
          </div>
        </div>
      ))}
    </>
  )

  return (
    <div className="pv-category-group">
      <div className="pv-category-group__head">
        <span className="pv-category-group__name">
          {group.name} <code>({group.key})</code>
        </span>
        <span className="pv-category-mode">{modeLabel(type, group)}</span>
      </div>

      {type === 'text' && (
        <input
          className="pv-text-input"
          type="text"
          placeholder={group.placeholder || `输入${group.name}…`}
          value={state.text[group.key] || ''}
          onChange={(e) => onChange({ ...state, text: { ...state.text, [group.key]: e.target.value } })}
        />
      )}

      {type === 'check' && (isCheckTags
        ? renderSections(checkTag, 'pv-chips')
        : renderSections(checkRow, 'pv-check-list'))}

      {(type === 'select' || type === 'sort') && (
        sections.length === 1 && !sections[0].title ? (
          <div className="pv-chips" role="group" aria-label={group.name}>
            {shownItems.map((node) => selectChip(node, node.id))}
            {isLongGroup && (
              <button
                type="button"
                className="pv-chip pv-chip--toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? '收起' : `+${totalLeaves - LONG_GROUP_THRESHOLD} 展开`}
              </button>
            )}
          </div>
        ) : (
          renderSections(selectChip, 'pv-chips')
        )
      )}

      {type === 'sort' && group.canAscend && state.single[group.key] && (
        <div className="pv-sort-dir" role="group" aria-label={`${group.name}方向`}>
          <button
            type="button"
            className="pv-chip pv-chip--small"
            aria-pressed={state.ascending[group.key] === true}
            onClick={() =>
              onChange({ ...state, ascending: { ...state.ascending, [group.key]: true } })
            }
          >
            升序
          </button>
          <button
            type="button"
            className="pv-chip pv-chip--small"
            aria-pressed={state.ascending[group.key] === false}
            onClick={() =>
              onChange({ ...state, ascending: { ...state.ascending, [group.key]: false } })
            }
          >
            降序
          </button>
        </div>
      )}

      {hasChildren && (
        <div className="pv-category-hint">
          该分组含子级分类；当前按一级选择，子级用于展示结构。
        </div>
      )}
    </div>
  )
}