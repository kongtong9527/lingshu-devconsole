import { useStore } from '../store.js'
import type { Capabilities } from '../types.js'
import { PlugIcon, InboxIcon } from '../icons.js'

const ACTION_LABELS: { key: keyof Capabilities; label: string }[] = [
  { key: 'list', label: 'list' },
  { key: 'detail', label: 'detail' },
  { key: 'reading', label: 'reading' },
  { key: 'search', label: 'search' },
  { key: 'categories', label: 'cat' },
]

export default function PluginList() {
  const plugins = useStore((s) => s.plugins)
  const selectedId = useStore((s) => s.selected.pluginId)
  const setPlugin = useStore((s) => s.setPlugin)

  return (
    <div>
      <div className="dc-section-label">
        <span>插件</span>
        <span className="dc-section-label__count">{plugins.length}</span>
      </div>

      {plugins.length === 0 && (
        <div className="dc-empty" style={{ minHeight: 160 }}>
          <InboxIcon size={28} className="dc-empty__icon" />
          <span className="dc-empty__hint">未找到插件</span>
        </div>
      )}

      {plugins.map((p) => {
        const active = p.id === selectedId
        const caps = ACTION_LABELS.filter((a) => p.capabilities[a.key]).map((a) => a.label)
        return (
          <button
            key={p.id}
            type="button"
            className="dc-plugin-item"
            aria-current={active ? 'true' : undefined}
            onClick={() => setPlugin(p.id)}
          >
            <span style={{ color: active ? 'var(--dc-color-primary)' : 'var(--dc-color-text-muted)' }}>
              <PlugIcon size={14} />
            </span>
            <span>
              <span className="dc-plugin-item__name">{p.name}</span>
              <div className="dc-plugin-item__meta">
                {p.id} · {caps.join(' · ')}
              </div>
            </span>
          </button>
        )
      })}
    </div>
  )
}
