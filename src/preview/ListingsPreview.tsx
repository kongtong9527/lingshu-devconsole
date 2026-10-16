import { useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../store.js'
import type { Listing } from '../types.js'
import { ArrowRightIcon } from '../icons.js'
import { emptyGroupState, categoryFromState, mergeListingCategory, visibleGroups, applyLinkageClear } from './filterState.js'
import { FilterGroupEditor } from './FilterGroupEditor.js'

/**
 * listings 预览（ADR-0015 + ADR-0021 + ADR-0025 导航树 + listings-first 探索页条目）：
 * - 顶层页签 = 一级导航；选中页签就地渲染其目录树。
 * - 导航树递归：带 children 的结点是分组/子菜单（可折叠，可任意深度），
 *   只有叶子结点是可点击目录页（打开 = runWith list）。
 * - 叶子打开：kind==='explore' 走 explore 动作（探索页 feed，url 为探索页标识透传
 *   getExplore context；缺省 = 默认探索页）；其余叶子带 url（页面通道）优先
 *   runWith({ action:'list', url })，缺省回退 category（ADR-0021 组合查询串）。
 * - kind（series/search/explore 等）以角标展示，未知 kind 降级为普通项。
 * - filters（ADR-0021）是叶子目录页属性：叶子带 filters 时渲染筛选组，
 *   用户组合后并入 category 再打开（url 叶子同样携带 filters 串）。筛选不持久化。
 *   explore 条目不消费 filters（feed 无目录页筛选语义）；**tags 条目消费**（ADR-0062：
 *   合并串经 `TagContext.category` 传给 `getTags`，与 list 的 `context.category` 同口径）。
 */
export default function ListingsPreview({ data }: { data: Listing[] }) {
  const runWith = useStore((s) => s.runWith)
  const [active, setActive] = useState(0)
  const [filterStates, setFilterStates] = useState<Record<string, ReturnType<typeof emptyGroupState>>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  if (data.length === 0) {
    return <div className="pv-empty-hint">该源未提供 listings 目录页</div>
  }

  const listing = data[active]

  /** 叶子「打开」：explore 条目走 explore 动作；tags 条目走 tags 动作（标签索引，
   * 合并串经 `TagContext.category` 消费，ADR-0062）；其余 url 页面通道优先、缺省回退
   * category；入参为含自身 category + filters 的合并串 */
  const openListing = (node: Listing, mergedCategory: string) => {
    if (node.kind === 'explore') {
      runWith({ action: 'explore', url: node.url ?? '' })
      return
    }
    if (node.kind === 'tags') {
      // 页级筛选合并串（空串 = 不传，插件按站点默认索引页抓）
      runWith({ action: 'tags', category: mergedCategory, target: '', page: '1' })
      return
    }
    runWith(
      node.url
        ? { action: 'list', url: node.url, category: mergedCategory, target: '', page: '1' }
        : { action: 'list', category: mergedCategory, target: '', page: '1' },
    )
  }

  /** 递归渲染导航结点；path 为「0-1-2」式索引路径，作为筛选/折叠状态的稳定 key */
  const renderNode = (node: Listing, indexPath: number[]): ReactNode => {
    const path = indexPath.join('-')
    const isLeaf = !node.children || node.children.length === 0
    const isCollapsed = !!collapsed[path]
    const hasFilters = isLeaf && !!node.filters?.length
    const filterState = filterStates[path] ?? emptyGroupState()
    const filterCategory = hasFilters ? categoryFromState(node.filters!, filterState) : ''
    const mergedCategory = isLeaf
      ? mergeListingCategory(node.category ?? '', filterCategory)
      : ''

    return (
      <div key={path} className="pv-listing-node">
        <div className="pv-listing-node__row">
          {!isLeaf && (
            <button
              type="button"
              className="pv-listing-node__toggle"
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? `展开 ${node.name}` : `折叠 ${node.name}`}
              onClick={() => setCollapsed((c) => ({ ...c, [path]: !isCollapsed }))}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          )}
          <span className={`pv-listing-node__name${isLeaf ? ' is-leaf' : ''}`}>{node.name}</span>
          {node.kind && <span className="pv-listing-node__kind">{node.kind}</span>}
        </div>

        {!isLeaf && !isCollapsed && (
          <div className="pv-listing-node__children">
            {node.children!.map((child, i) => renderNode(child, [...indexPath, i]))}
          </div>
        )}

        {isLeaf && (
          <div className="pv-listing-node__leaf">
            <div className="pv-listing-node__action">
              <button
                type="button"
                className="pv-btn-primary"
                onClick={() => openListing(node, mergedCategory)}
              >
                打开「{node.name}」
                <ArrowRightIcon size={12} />
              </button>
              {node.kind === 'explore' ? (
                node.url ? (
                  <code className="pv-listings-category">explore url = {node.url}</code>
                ) : (
                  <code className="pv-listings-category">explore（默认探索页）</code>
                )
              ) : node.url ? (
                <code className="pv-listings-category">url = {node.url}</code>
              ) : (
                <code className="pv-listings-category">
                  category = {node.category ? node.category : '（默认列表）'}
                </code>
              )}
            </div>

            {node.kind === 'explore' ? (
              <div className="pv-empty-hint">
                探索页：getExplore(context) 聚合 feed（ExploreSection[]），不消费目录页筛选
              </div>
            ) : hasFilters ? (
              <div className="pv-categories pv-card">
                {visibleGroups(node.filters!, filterState).map((g) => (
                  <FilterGroupEditor
                    key={`${g.key}:${node.filters!.indexOf(g)}`}
                    group={g}
                    groups={node.filters!}
                    state={filterState}
                    onChange={(next) =>
                      setFilterStates((prev) => ({
                        ...prev,
                        [path]: applyLinkageClear(node.filters!, prev[path] ?? emptyGroupState(), next),
                      }))
                    }
                  />
                ))}
                <div className="pv-category-footer">
                  <div className="pv-category-preview">
                    merged category = {mergedCategory || '（未选择筛选，进入默认列表）'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="pv-empty-hint">
                {node.kind === 'tags'
                  ? '标签索引：getTags() 标签云（首字分组全量或分页云 TagResult），未声明页级筛选'
                  : '该目录页未声明筛选组（ADR-0021）'}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="dc-preview-wrap">
      <div className="pv-card">
        <div className="pv-listings-tabs" role="tablist" aria-label="预设目录页">
          {data.map((l, i) => (
            <button
              key={l.name + i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`pv-listings-tab${i === active ? ' pv-listings-tab--active' : ''}`}
              onClick={() => setActive(i)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <div className="pv-listings-tree">{renderNode(listing, [active])}</div>
      </div>
    </div>
  )
}
