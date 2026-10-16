import { useStore } from '../store.js'
import type { ArticleDetail, ReadingPage, CategoryGroup, ExploreFeed, Listing, PageJumpTarget, PlayUrlResult, TagIndex, TagResult } from '../types.js'
import { toJumpPatch } from './jump.js'
export { toJumpPatch } from './jump.js'
import ArticlePreview from './ArticlePreview.js'
import ReadingPagePreview from './ReadingPagePreview.js'
import ListPreview from './ListPreview.js'
import CategoriesPreview from './CategoriesPreview.js'
import ListingsPreview from './ListingsPreview.js'
import ExplorePreview from './ExplorePreview.js'
import TagsPreview from './TagsPreview.js'
import VideoPlayer from './VideoPlayer.js'

/** 提取 URL 的 query string（不含 `?`），用于把标签链接还原为 fetchList 的 category */
function extractQuery(url: string): string {
  const qIdx = url.indexOf('?')
  if (qIdx < 0) return ''
  const tail = url.slice(qIdx + 1)
  const hashIdx = tail.indexOf('#')
  return hashIdx >= 0 ? tail.slice(0, hashIdx) : tail
}

export default function PreviewDispatcher() {
  const action = useStore((s) => s.selected.action)
  const result = useStore((s) => s.result)
  const setView = useStore((s) => s.setView)
  const runWith = useStore((s) => s.runWith)
  const plugins = useStore((s) => s.plugins)
  const pluginId = useStore((s) => s.selected.pluginId)
  const listItems = useStore((s) => s.listItems)
  const selectedTarget = useStore((s) => s.selected.target)
  if (!result?.ok || result.data == null) return null
  const jump = () => setView('json')

  let content
  switch (action) {
    case 'detail': {
      const plugin = plugins.find((p) => p.id === pluginId)
      const onChapterClick = plugin?.capabilities.reading
        ? (url: string, target?: PageJumpTarget) =>
            runWith(toJumpPatch(target) ?? { action: 'reading', target: url })
        : undefined
      // 推荐项点击 → 在 DevConsole 内打开对应详情预览（target 优先，否则回退 url）
      const onDetailClick = (url: string, target?: PageJumpTarget) =>
        runWith(toJumpPatch(target) ?? { action: 'detail', target: url })
      // 标签点击 → 还原为分类跳转到对应列表预览（target 优先，否则回退 url 的 query）
      const onTagClick = (url: string, target?: PageJumpTarget) =>
        runWith(toJumpPatch(target) ?? { action: 'list', category: extractQuery(url), target: '', page: '1' })
      // 链接点击（link 块带 target 时）→ 结构化跳转；link 无 target 保持外链语义
      const onLinkClick = (url: string, target: PageJumpTarget) =>
        runWith(toJumpPatch(target) ?? { action: 'detail', target: url })
      // 推荐块级「更多」（block.viewMore）→ 该推荐维度的完整列表页；与发现页分区
      // ExplorePreview 同一跳转机制（toJumpPatch → runWith），动作缺省同 detail 页
      const onViewMoreClick = (target: PageJumpTarget) =>
        runWith(
          toJumpPatch(target) ?? {
            action: plugin?.capabilities.detail ? 'detail' : 'reading',
            target: '',
          },
        )
      const listItem = listItems.find((item) => item.url === selectedTarget)
      const fallbackCoverUrl = listItem?.coverUrl
      content = (
        <ArticlePreview
          data={result.data as ArticleDetail}
          onJumpJson={jump}
          onChapterClick={onChapterClick}
          onTagClick={onTagClick}
          onDetailClick={onDetailClick}
          onLinkClick={onLinkClick}
          onViewMoreClick={onViewMoreClick}
          fallbackCoverUrl={fallbackCoverUrl}
          pluginId={pluginId}
        />
      )
      break
    }
    case 'play': {
      // 从 RunBar 直接跑 play 动作时（调试用）：结果即 PlayUrlResult，就地用播放器预览
      const playResult = result.data as PlayUrlResult
      content = playResult && typeof playResult.url === 'string' ? (
        <div className="pv-playresult">
          <VideoPlayer
            src={playResult.url}
            poster={playResult.poster}
            referer={playResult.referer}
          />
          <pre className="pv-playresult__json">{JSON.stringify(playResult, null, 2)}</pre>
        </div>
      ) : (
        <div className="pv-empty-hint">play 动作未返回可播放地址</div>
      )
      break
    }
    case 'reading': {
      const page = result.data as ReadingPage
      content = (
        <ReadingPagePreview
          data={page}
          onPrev={
            page.prevUrl ? () => runWith({ action: 'reading', target: page.prevUrl! }) : undefined
          }
          onNext={
            page.nextUrl ? () => runWith({ action: 'reading', target: page.nextUrl! }) : undefined
          }
        />
      )
      break
    }
    case 'list':
    case 'search':
      content = <ListPreview />
      break
    case 'categories':
      content = <CategoriesPreview data={result.data as CategoryGroup[]} />
      break
    case 'listings':
      content = <ListingsPreview data={result.data as Listing[]} />
      break
    case 'explore':
      content = <ExplorePreview data={result.data as ExploreFeed} />
      break
    case 'tags':
      content = <TagsPreview data={result.data as TagIndex | TagResult} />
      break
    default:
      content = <div className="pv-empty-hint">该动作的预览渲染器尚未接入（{action}）</div>
  }

  return <div className="dc-preview-viewport">{content}</div>
}
