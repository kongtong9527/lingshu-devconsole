import type { ArticleDetail, ImageTransport, PageJumpTarget } from '../types.js'
import BlockRenderer from './BlockRenderer.js'
import LazyImage from './LazyImage.js'
import { proxyUrl } from '../api/proxy.js'
import { getImageEncryption } from './imageEncryption.js'

export default function ArticlePreview({
  data,
  onJumpJson,
  onChapterClick,
  onTagClick,
  onDetailClick,
  onLinkClick,
  onViewMoreClick,
  fallbackCoverUrl,
  pluginId,
}: {
  data: ArticleDetail
  onJumpJson: () => void
  onChapterClick?: (url: string) => void
  onTagClick?: (url: string) => void
  onDetailClick?: (url: string) => void
  onLinkClick?: (url: string, target: PageJumpTarget) => void
  /** recommendations 块级「更多」（`block.viewMore`）：跳该推荐维度的完整列表页 */
  onViewMoreClick?: (target: PageJumpTarget) => void
  fallbackCoverUrl?: string
  pluginId?: string | null
}) {
  const meta = [data.author, data.sourceName].filter(Boolean).join(' · ')
  const imageEncryption = getImageEncryption(data.metadata)
  const imageTransport = data.metadata?.imageTransport as ImageTransport | undefined
  const displayCoverUrl = data.coverUrl || fallbackCoverUrl
  return (
    <div className="dc-preview-wrap">
      <article className="pv-article">
        <h1 className="pv-article__title">{data.title}</h1>
        {meta && <div className="pv-article__meta">{meta}</div>}
        {displayCoverUrl && (
          <LazyImage
            src={proxyUrl(displayCoverUrl, imageEncryption, imageTransport)}
            alt=""
            className="pv-article__cover"
          />
        )}
        {data.blocks.map((b, i) => (
          <BlockRenderer
            key={i}
            block={b}
            onJumpJson={onJumpJson}
            onChapterClick={onChapterClick}
            onTagClick={onTagClick}
            onDetailClick={onDetailClick}
            onLinkClick={onLinkClick}
            onViewMoreClick={onViewMoreClick}
            imageEncryption={imageEncryption}
            imageTransport={imageTransport}
            pluginId={pluginId}
          />
        ))}
      </article>
    </div>
  )
}
