import { useStore } from '../store.js'
import type { Action, ExploreFeed, ExploreSection, ImageTransport, ListItem } from '../types.js'
import { proxyUrl } from '../api/proxy.js'
import LazyImage from './LazyImage.js'
import { getImageEncryption } from './imageEncryption.js'
import { toJumpPatch } from './jump.js'
import { CoverBadges, ListTags, normalizeListTags } from './ListItemMeta.js'

function coverSrc(item: ListItem): string | undefined {
  if (!item.coverUrl) return undefined
  return proxyUrl(
    item.coverUrl,
    getImageEncryption(item.metadata),
    item.metadata?.imageTransport as ImageTransport | undefined,
  )
}

export default function ExplorePreview({ data }: { data: ExploreFeed }) {
  const plugins = useStore((s) => s.plugins)
  const pluginId = useStore((s) => s.selected.pluginId)
  const runWith = useStore((s) => s.runWith)
  const plugin = plugins.find((p) => p.id === pluginId)
  const jumpAction: Action = plugin?.capabilities.detail ? 'detail' : 'reading'

  const renderItem = (item: ListItem) => (
    <button
      key={item.id}
      type="button"
      className="pv-list-item pv-list-item--compact"
      onClick={() => runWith(toJumpPatch(item.target) ?? { action: jumpAction, target: item.url })}
      aria-label={`查看 ${item.title}`}
    >
      {item.coverUrl && (
        <div className="pv-list-item__cover-wrap">
          <LazyImage src={coverSrc(item)!} alt="" className="pv-list-item__cover" />
          <CoverBadges badges={item.badges} />
        </div>
      )}
      <div className="pv-list-item__body">
        <div className="pv-list-item__title">{item.title}</div>
        <ListTags tags={normalizeListTags(item.tags)} onTagTarget={(patch) => runWith(patch)} />
      </div>
    </button>
  )

  return (
    <div className="dc-preview-wrap">
      {data.length === 0 && <div className="pv-empty-hint">无发现页内容</div>}
      {data.map((section: ExploreSection, i) => {
        const morePatch = toJumpPatch(section.viewMore)
        return (
          <section key={i} className="pv-explore-section">
            <header className="pv-explore-section__head">
              <h3 className="pv-explore-section__title">{section.title}</h3>
              {morePatch && (
                <button
                  type="button"
                  className="dc-btn dc-btn--ghost pv-explore-section__more"
                  onClick={() => runWith(morePatch)}
                >
                  更多
                </button>
              )}
            </header>
            <div className="pv-explore-section__items">
              {section.items.length === 0 ? (
                <span className="pv-empty-hint">暂无内容</span>
              ) : (
                section.items.map(renderItem)
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
