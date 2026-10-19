import type { ReactNode } from 'react'
import type { ContentBlock, PageJumpTarget } from '../types.js'
import type { ImageEncryption, ImageTransport } from '../types.js'
import { proxyUrl } from '../api/proxy.js'
import LazyImage from './LazyImage.js'
import VideoPlayer from './VideoPlayer.js'
import VideoLazyBlock from './VideoLazyBlock.js'
import EpisodesBlock from './EpisodesBlock.js'

/** 内容块角标色（映射到 tokens.css 的语义变量） */
const TAG_COLOR: Record<string, string> = {
  heading: 'var(--dc-color-block-heading)',
  text: 'var(--dc-color-block-text)',
  image: 'var(--dc-color-block-image)',
  video: 'var(--dc-color-block-video)',
  episodes: 'var(--dc-color-block-episodes)',
  gallery: 'var(--dc-color-block-gallery)',
  link: 'var(--dc-color-block-link)',
  chapter: 'var(--dc-color-block-chapter)',
  tags: 'var(--dc-color-block-tags)',
  tagGroups: 'var(--dc-color-block-tags)',
  recommendations: 'var(--dc-color-block-recommendations)',
  divider: 'var(--dc-color-block-divider)',
}

const HEADING_SIZE: Record<number, number> = { 1: 24, 2: 20, 3: 17, 4: 15, 5: 14, 6: 13 }

export default function BlockRenderer({
  block,
  onJumpJson,
  onChapterClick,
  onTagClick,
  onDetailClick,
  onLinkClick,
  onViewMoreClick,
  imageEncryption,
  imageTransport,
  pluginId,
}: {
  block: ContentBlock
  onJumpJson: () => void
  onChapterClick?: (url: string, target?: PageJumpTarget) => void
  /** 标签点击：跳转到对应标签的列表预览；未传时标签渲染为外链 */
  onTagClick?: (url: string, target?: PageJumpTarget) => void
  /** 推荐项点击：跳转到对应详情预览；未传时推荐项渲染为外链 */
  onDetailClick?: (url: string, target?: PageJumpTarget) => void
  /** 推荐块级「更多」点击（`block.viewMore`，与发现页分区 viewMore 同型同语义） */
  onViewMoreClick?: (target: PageJumpTarget) => void
  /** 链接点击：仅当 link 块带 target 时内部导航；未传或 link 无 target 时渲染为外链 */
  onLinkClick?: (url: string, target: PageJumpTarget) => void
  imageEncryption?: ImageEncryption
  imageTransport?: ImageTransport
  /** 当前插件 id（episodes 块就地调 play 动作用；缺失时剧集仅展示不可播） */
  pluginId?: string | null
}) {
  const tag = (
    <button
      type="button"
      className="pv-block__tag"
      onClick={onJumpJson}
      title="跳转到 JSON"
      style={{ background: TAG_COLOR[block.type] ?? 'var(--dc-color-block-default)' }}
    >
      {block.type}
    </button>
  )

  let inner: ReactNode
  switch (block.type) {
    case 'text':
      // title 可选：带标题时渲染标题区样式（与 tags 区标题同语言，简介等独立文本区用）；
      // 缺省保持裸段落。换行由 .pv-text 的 pre-wrap 保留（\n 不缩为一行）。
      inner = block.title ? (
        <div className="pv-text-block">
          <div className="pv-text__title">{block.title}</div>
          <p className="pv-text">{block.content}</p>
        </div>
      ) : (
        <p className="pv-text">{block.content}</p>
      )
      break
    case 'heading':
      inner = (
        <div
          className="pv-heading"
          style={{ fontSize: HEADING_SIZE[block.level] ?? 16 }}
        >
          {block.content}
        </div>
      )
      break
    case 'link':
      // link 块默认语义 = 外链（pv-link 文本链接）；带 target 且宿主传入
      // onLinkClick 时改为胶囊 chip（与筛选 chips 同语言，突出「可点进 App 内」）
      inner = block.target && onLinkClick ? (
        <p style={{ margin: '0 0 var(--dc-space-5)' }}>
          <button
            type="button"
            className="pv-chip"
            onClick={() => onLinkClick(block.url, block.target!)}
          >
            {block.content}
          </button>
        </p>
      ) : (
        <p style={{ margin: '0 0 var(--dc-space-5)' }}>
          <a className="pv-link" href={block.url} target="_blank" rel="noreferrer">
            {block.content}
          </a>
        </p>
      )
      break
    case 'chapter': {
      // 条目级 coverUrl（章节封面）：任一项有图即走横向缩略图行，无图项纯色占位对齐行高；
      // 全块无图回退纵向文字列表（与 episodes 有图行同构）。
      const hasCover = block.content.some((c) => !!c.coverUrl)
      inner = hasCover ? (
        <ul className="pv-chapter-list has-cover">
          {block.content.map((c, i) => (
            <li key={i} className="pv-chapter-row">
              {c.coverUrl ? (
                <LazyImage
                  src={proxyUrl(c.coverUrl, imageEncryption, imageTransport)}
                  alt={c.title}
                  className="pv-chapter-thumb"
                />
              ) : (
                <span className="pv-chapter-thumb is-empty" aria-hidden="true" />
              )}
              {onChapterClick ? (
                <button
                  type="button"
                  className="pv-chapter-btn"
                  onClick={() => onChapterClick(c.url, c.target)}
                >
                  {c.title}
                </button>
              ) : (
                <a
                  className="pv-chapter-link"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.title}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="pv-chapter-list">
          {block.content.map((c, i) => (
            <li key={i}>
              {onChapterClick ? (
                <button
                  type="button"
                  className="pv-chapter-btn"
                  onClick={() => onChapterClick(c.url, c.target)}
                >
                  {c.title}
                </button>
              ) : (
                <a
                  className="pv-chapter-link"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.title}
                </a>
              )}
            </li>
          ))}
        </ul>
      )
      break
    }
    case 'tags':
      inner = (
        <div className="pv-tags">
          {block.title && <div className="pv-tags__title">{block.title}</div>}
          {block.content.map((item) =>
            onTagClick ? (
              <button
                key={item.url}
                type="button"
                className="pv-tag-btn"
                onClick={() => onTagClick(item.url, item.target)}
              >
                {item.name}
              </button>
            ) : (
              <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
                {item.name}
              </a>
            ),
          )}
        </div>
      )
      break
    case 'tagGroups': {
      // 标签分组块：一行一种类型，类型名稳定配色（FNV-1a 取余，与 iOS 同算法同调色板）。
      const palette = ['#F9D5D8', '#E6D6F3', '#D3E5F5', '#D6EDD8', '#F9EBC2', '#F9DAC0', '#CDE9E6', '#F2CDE0', '#E2E8C8', '#D8DDE8']
      const stableHash = (s: string): number => {
        let h = 2166136261
        for (let i = 0; i < s.length; i++) {
          // 按 UTF8 字节迭代（与 Swift String.utf8 对齐，含中文多字节）
          const bytes = new TextEncoder().encode(s[i])
          for (const b of bytes) {
            h ^= b
            h = Math.imul(h, 16777619)
          }
        }
        return h >>> 0
      }
      inner = (
        <div className="pv-tags">
          {block.title && <div className="pv-tags__title">{block.title}</div>}
          {block.groups.map((group) => (
            <div key={group.name} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
              <span
                style={{
                  background: palette[stableHash(group.name) % palette.length],
                  color: '#2E2E33',
                  borderRadius: 999,
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {group.name}
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {group.content.map((item) =>
                  onTagClick ? (
                    <button
                      key={item.url}
                      type="button"
                      className="pv-tag-btn"
                      onClick={() => onTagClick(item.url, item.target)}
                    >
                      {item.name}
                    </button>
                  ) : (
                    <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
                      {item.name}
                    </a>
                  ),
                )}
              </span>
            </div>
          ))}
        </div>
      )
      break
    }
    case 'recommendations':
      // 块头（title 缺省「推荐」）+ 块级「更多」：与发现页分区同款块头语言
      // （复用 pv-explore-section__head/__title/__more，两处观感一致）；
      // 无 viewMore 不渲染按钮（禁死按钮，同 iOS SectionHeaderView 口径）。
      inner = (
        <div className="pv-recommendations-block">
          <header className="pv-explore-section__head">
            <h4 className="pv-explore-section__title">{block.title ?? '推荐'}</h4>
            {block.viewMore && onViewMoreClick && (
              <button
                type="button"
                className="dc-btn dc-btn--ghost pv-explore-section__more"
                onClick={() => onViewMoreClick(block.viewMore!)}
              >
                更多
              </button>
            )}
          </header>
          <div className="pv-recommendations">
            {block.content.map((item) =>
              onDetailClick ? (
                <button
                  key={item.url}
                  type="button"
                  className="pv-recommendation"
                  onClick={() => onDetailClick(item.url, item.target)}
                  aria-label={`查看 ${item.title}`}
                >
                  {item.coverUrl && (
                    <LazyImage
                      src={proxyUrl(item.coverUrl, imageEncryption, imageTransport)}
                      alt={item.title}
                    />
                  )}
                  <span className="pv-recommendation__title">{item.title}</span>
                </button>
              ) : (
                <div key={item.url} className="pv-recommendation">
                  {item.coverUrl && (
                    <LazyImage
                      src={proxyUrl(item.coverUrl, imageEncryption, imageTransport)}
                      alt={item.title}
                    />
                  )}
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                </div>
              ),
            )}
          </div>
        </div>
      )
      break
    case 'image':
      inner = (
        <figure className="pv-figure">
          <LazyImage
            src={proxyUrl(block.url, imageEncryption, imageTransport)}
            alt={block.caption || ''}
            className="pv-image"
          />
          {block.caption && <figcaption className="pv-figcaption">{block.caption}</figcaption>}
        </figure>
      )
      break
    case 'video':
      // url 可选。有 target.play 时**优先懒解析**——即使同时给了 url，
      // 该 url 也可能是出流入口/页面地址而非媒体直链（如 B 站视频页），直接硬播会
      // MEDIA_ERR_SRC_NOT_SUPPORTED；点播时经 fetchPlayUrl 现算出流才保鲜、可播。
      // 仅无 target.play 时才直接用 url 内联播放（直嵌流形态，video_site_a 短剧/manga_site_a 等）。
      if (block.target?.action === 'play') {
        inner = (
          <VideoLazyBlock
            pluginId={pluginId ?? null}
            playUrl={block.target.url}
            poster={block.poster}
            platform={block.platform}
            posterEncryption={imageEncryption}
            posterTransport={imageTransport}
          />
        )
      } else if (block.url) {
        inner = (
          <VideoPlayer
            src={block.url}
            poster={block.poster}
            encryption={imageEncryption}
            imageTransport={imageTransport}
            referer={block.referer}
            qualities={block.qualities}
          />
        )
      } else {
        // 既无 url 也无 target.play：不冒充能力，直接提示
        inner = <div className="pv-video-placeholder">视频块缺少播放地址（url 或 target.play）</div>
      }
      break
    case 'episodes':
      inner = (
        <EpisodesBlock
          pluginId={pluginId ?? null}
          lines={block.lines}
          poster={block.poster}
          posterEncryption={imageEncryption}
          posterTransport={imageTransport}
        />
      )
      break
    case 'gallery':
      inner = (
        <div className="pv-gallery">
          {block.images.map((im, i) => (
            <figure key={i}>
              <LazyImage
                src={proxyUrl(im.url, imageEncryption, imageTransport)}
                alt={im.caption || ''}
                className="pv-image"
              />
            </figure>
          ))}
        </div>
      )
      break
    case 'divider':
      inner = <hr className="pv-divider" />
      break
    default:
      // 未识别类型降级为原始 JSON，不报错
      inner = <pre className="pv-fallback">{JSON.stringify(block, null, 2)}</pre>
  }

  return (
    <div className="pv-block">
      {inner}
      {tag}
    </div>
  )
}
