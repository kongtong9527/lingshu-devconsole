import { useState } from 'react'
import { useStore } from '../store.js'
import type { ImageTransport, ListItem, Action } from '../types.js'
import { proxyUrl } from '../api/proxy.js'
import LazyImage from './LazyImage.js'
import CardPreview, { shouldFallbackCard } from './CardPreview.js'
import { CoverBadges, ListTags, normalizeListTags } from './ListItemMeta.js'
import { getImageEncryption } from './imageEncryption.js'
import { toJumpPatch } from './jump.js'
import { FilterGroupEditor } from './FilterGroupEditor.js'
import { emptyGroupState, categoryFromState, mergeListingCategory, visibleGroups, applyLinkageClear } from './filterState.js'

export default function ListPreview() {
  const plugins = useStore((s) => s.plugins)
  const pluginId = useStore((s) => s.selected.pluginId)
  const runWith = useStore((s) => s.runWith)
  const items = useStore((s) => s.listItems)
  const pagination = useStore((s) => s.listPagination)
  const loadingMore = useStore((s) => s.loadingMore)
  const loadMore = useStore((s) => s.loadMore)
  // 落地列表页筛选组，两个来源（ADR-0066 起）：
  //   ① 列表结果自声明的 `filters` —— 「只有抓到页面才知道」的筛选（video_site_c 工作室页题材滑块
  //      按工作室不同、只渲进 SSR HTML），优先级更高；
  //   ② 跳转携带的 `PageJumpTarget.list.filters`（Q11-a 静态筛选），只在①缺省时顶上。
  const carriedFilters = useStore((s) => s.selected.filters)
  const resultFilters = useStore((s) => s.listFilters)
  const filters = resultFilters && resultFilters.length ? resultFilters : carriedFilters
  const baseCategory = useStore((s) => s.selected.category)
  const baseUrl = useStore((s) => s.selected.url)
  const [filterState, setFilterState] = useState(emptyGroupState())
  const plugin = plugins.find((p) => p.id === pluginId)
  const jumpAction: Action = plugin?.capabilities.detail ? 'detail' : 'reading'
  const canLoadMore = !!pagination?.hasMore
  const groups = filters && filters.length ? filters : []
  const hasFilters = groups.length > 0
  const shownGroups = visibleGroups(groups, filterState)
  const handleFilterChange = (next: typeof filterState) =>
    setFilterState((prev) => applyLinkageClear(groups, prev, next))

  /** 条目点击：带结构化 target（ADR-0025 递归列表/合集）优先，缺省回退详情（或 reading） */
  const jumpFor = (item: ListItem) =>
    toJumpPatch(item.target) ?? { action: jumpAction, target: item.url }

  /** 卡片节点点击：有显式 target 才到此处（CardPreview 已拦截冒泡）；invoke/noop 已在内层处理，只导航跳转类 */
  const nodeTargetFor = (target: unknown) => {
    const patch = toJumpPatch(target as Parameters<typeof toJumpPatch>[0])
    if (patch) runWith(patch)
  }

  /** 应用筛选：组合 category 与 base 合并后重进 list（保留 url 页面通道与 filters） */
  const applyFilter = () => {
    const filterCategory = categoryFromState(groups, filterState)
    const merged = mergeListingCategory(baseCategory, filterCategory)
    runWith({ action: 'list', url: baseUrl, category: merged, target: '', page: '1', filters: groups })
  }

  /** 重置筛选：清空本地 state 回默认列表 */
  const resetFilter = () => {
    setFilterState(emptyGroupState())
    runWith({ action: 'list', url: baseUrl, category: baseCategory, target: '', page: '1', filters: groups })
  }

  return (
    <div className="dc-preview-wrap">
      {hasFilters && (
        <div className="pv-categories pv-card">
          {shownGroups.map((g) => (
            <FilterGroupEditor
              key={`${g.key}:${groups.indexOf(g)}`}
              group={g}
              groups={groups}
              state={filterState}
              onChange={handleFilterChange}
            />
          ))}
          <div className="pv-category-footer">
            <div className="pv-category-preview">
              merged category = {mergeListingCategory(baseCategory, categoryFromState(groups, filterState)) || '（未选择筛选，进入默认列表）'}
            </div>
            <div className="pv-category-actions">
              <button type="button" className="pv-btn-primary" onClick={applyFilter}>
                应用筛选
              </button>
              <button type="button" className="dc-btn dc-btn--ghost" onClick={resetFilter}>
                重置
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="pv-list">
        {items.map((item: ListItem) => (
          <button
            key={item.id}
            type="button"
            className="pv-list-item"
            onClick={() => runWith(jumpFor(item))}
            aria-label={`查看 ${item.title}`}
          >
            {/* 卡片 DSL 分流（ADR-0050 v1）：有卡走 DSL 预览，无卡走老行 */}
            {!shouldFallbackCard(item) ? (
              <CardPreview item={item} onNodeTarget={nodeTargetFor} />
            ) : (
              <>
            {item.coverUrl && (
              <div className="pv-list-item__cover-wrap">
                <LazyImage
                  src={proxyUrl(
                    item.coverUrl,
                    getImageEncryption(item.metadata),
                    item.metadata?.imageTransport as ImageTransport | undefined,
                  )}
                  alt=""
                  className="pv-list-item__cover"
                />
                <CoverBadges badges={item.badges} />
              </div>
            )}
            <div className="pv-list-item__body">
              <div className="pv-list-item__title">{item.title}</div>
              {item.summary && <div className="pv-list-item__summary">{item.summary}</div>}
              <ListTags tags={normalizeListTags(item.tags)} onTagTarget={(patch) => runWith(patch)} />
            </div>
              </>
            )}
          </button>
        ))}
      </div>
      {canLoadMore && (
        <div className="pv-list__more">
          <button
            type="button"
            className="dc-btn dc-btn--ghost pv-list__more-btn"
            onClick={() => loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  )
}
