import { useStore } from '../store.js'
import type { TagGroup, TagIndex, TagResult } from '../types.js'
import { toJumpPatch } from './jump.js'

/**
 * 标签索引预览（`getTags()` + 分页标签索引）：
 * - 内容 = legacy `TagGroup[]`（首字分组全量云）或 `TagResult`（分页排序云：本页 groups + pagination）。
 * - 分页云走 store 累加器（`tagsGroups` + `loadMoreTags`，与 ListPreview 的 listItems/loadMore 同构）；
 *   legacy 全量（无 pagination）不显示加载更多。
 * - 服务端排序（`sort`，如 video_site_b views|videos）经 RunBar 输入切换后重跑首页；
 *   此处的过滤/拼音排序仍是本地零请求显示层（iOS TagsCloudView 同款语义）。
 * - 标签点击：结构化 target 优先（`{action:'list',url}` 进标签视频列表），缺省回退
 *   标签 url 作页面通道（`{action:'list',url}`，宿主优先 url）。
 */
export default function TagsPreview({ data }: { data: TagIndex | TagResult }) {
  const runWith = useStore((s) => s.runWith)
  const groups = useStore((s) => s.tagsGroups)
  const pagination = useStore((s) => s.tagsPagination)
  const tagsLoadingMore = useStore((s) => s.tagsLoadingMore)
  const loadMoreTags = useStore((s) => s.loadMoreTags)

  // legacy 全量（无累加器时）回退读本次 data；分页云以累加器为准。
  const legacyGroups = Array.isArray(data) ? (data as TagGroup[]) : null
  const shown = groups.length > 0 ? groups : legacyGroups ?? []
  const canLoadMore = !!pagination?.hasMore

  if (shown.length === 0) {
    return (
      <div className="dc-preview-wrap">
        <div className="pv-empty-hint">无标签索引内容</div>
      </div>
    )
  }

  const total = shown.reduce((n, g: TagGroup) => n + (Array.isArray(g.tags) ? g.tags.length : 0), 0)

  return (
    <div className="dc-preview-wrap">
      <div className="pv-card" style={{ marginBottom: 12 }}>
        {shown.length} 组 · {total} 个标签
        {pagination && pagination.strategy === 'page' ? ` · 第 ${pagination.page} 页${pagination.hasMore ? '（还有更多）' : '（已到底）'}` : ''}
      </div>
      {shown.map((group: TagGroup, i: number) => (
        <section key={`${group.title}:${i}`} className="pv-explore-section">
          <header className="pv-explore-section__head">
            <h3 className="pv-explore-section__title">{group.title}</h3>
            <span className="pv-listings-category">{group.tags.length} 个</span>
          </header>
          <div className="pv-tags-cloud" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(group.tags ?? []).map((tag) => (
              <button
                key={tag.url}
                type="button"
                className="dc-btn dc-btn--ghost"
                onClick={() =>
                  runWith(
                    toJumpPatch(tag.target) ?? { action: 'list', url: tag.url, category: '', target: '', page: '1' },
                  )
                }
                aria-label={`打开标签 ${tag.name}`}
                title={tag.url}
              >
                {tag.name}
                {typeof tag.count === 'number' && (
                  <span className="pv-listings-category" style={{ marginLeft: 6 }}>
                    {tag.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
      {canLoadMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            className="dc-btn dc-btn--primary"
            onClick={() => loadMoreTags()}
            disabled={tagsLoadingMore}
          >
            {tagsLoadingMore ? '加载中…' : '加载更多标签'}
          </button>
        </div>
      )}
    </div>
  )
}
