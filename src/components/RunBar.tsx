import { useStore } from '../store.js'
import type { Action } from '../types.js'
import { PlayIcon } from '../icons.js'

interface ActionDef {
  // login / setting-action 不在动作选择器：login 经「账号」tab 表单提交，
  // setting-action 经「设置」tab 按钮（均非 run 按钮，见 声明式交互）
  key: Exclude<Action, 'setting-action' | 'login'>
  label: string
  needTarget: boolean
}

const ALL_ACTIONS: ActionDef[] = [
  { key: 'categories', label: 'categories', needTarget: false },
  { key: 'listings', label: 'listings', needTarget: false },
  { key: 'explore', label: 'explore', needTarget: false },
  { key: 'tags', label: 'tags', needTarget: false },
  { key: 'list', label: 'list', needTarget: false },
  { key: 'detail', label: 'detail', needTarget: true },
  { key: 'reading', label: 'reading', needTarget: true },
  { key: 'search', label: 'search', needTarget: true },
  { key: 'play', label: 'play', needTarget: true },
]

export default function RunBar() {
  const plugins = useStore((s) => s.plugins)
  const selected = useStore((s) => s.selected)
  const setAction = useStore((s) => s.setAction)
  const patch = useStore((s) => s.patch)
  const run = useStore((s) => s.run)
  const loading = useStore((s) => s.loading)

  const plugin = plugins.find((p) => p.id === selected.pluginId)
  const actions = ALL_ACTIONS.filter((a) => plugin?.capabilities[a.key])
  const current = ALL_ACTIONS.find((a) => a.key === selected.action)

  return (
    <div className="dc-toolbar" role="toolbar" aria-label="运行控制">
      <div className="dc-field">
        <span className="dc-field__label">动作</span>
        <div className="dc-segmented" role="group" aria-label="选择动作">
          {actions.length === 0 && (
            <span className="dc-segmented__item" style={{ cursor: 'default' }}>
              无可用动作
            </span>
          )}
          {actions.map((a) => {
            const active = a.key === selected.action
            return (
              <button
                key={a.key}
                type="button"
                role="option"
                aria-selected={active}
                className="dc-segmented__item"
                onClick={() => setAction(a.key)}
              >
                {a.label}
              </button>
            )
          })}
        </div>
      </div>

      {current?.needTarget && (
        <div className="dc-field" style={{ flex: 1, minWidth: 220 }}>
          <span className="dc-field__label">{selected.action === 'search' ? '查询' : 'url'}</span>
          <input
            className="dc-input dc-input--mono"
            value={selected.target}
            onChange={(e) => patch({ target: e.target.value })}
            placeholder={selected.action === 'search' ? '关键词' : 'https://...'}
            style={{ flex: 1 }}
            aria-label={selected.action === 'search' ? '搜索关键词' : '目标 URL'}
          />
        </div>
      )}

      {(selected.action === 'list' || selected.action === 'search') && (
        <>
          <div className="dc-field">
            <span className="dc-field__label">page</span>
            <input
              className="dc-input dc-input--sm"
              value={selected.page}
              onChange={(e) => patch({ page: e.target.value })}
              aria-label="页码"
            />
          </div>
          <div className="dc-field">
            <span className="dc-field__label">url</span>
            <input
              className="dc-input dc-input--mono"
              value={selected.url}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="页面通道 URL（可选）"
              style={{ width: 180 }}
              aria-label="页面通道 URL"
            />
          </div>
          <div className="dc-field">
            <span className="dc-field__label">category</span>
            <input
              className="dc-input dc-input--mono"
              value={selected.category}
              onChange={(e) => patch({ category: e.target.value })}
              placeholder="region=cn&type=rexue"
              style={{ width: 180 }}
              aria-label="分类过滤参数"
            />
          </div>
        </>
      )}

      {selected.action === 'tags' && (
        <>
          <div className="dc-field">
            <span className="dc-field__label">page</span>
            <input
              className="dc-input dc-input--sm"
              value={selected.page}
              onChange={(e) => patch({ page: e.target.value })}
              aria-label="标签索引页码"
            />
          </div>
          <div className="dc-field">
            <span className="dc-field__label">category</span>
            <input
              className="dc-input dc-input--mono"
              value={selected.category}
              onChange={(e) => patch({ category: e.target.value })}
              placeholder="索引页自己的筛选（可选，如 type=album）"
              style={{ width: 180 }}
              aria-label="标签索引筛选组合串"
            />
          </div>
        </>
      )}

      <div className="dc-field">
        <span className="dc-field__label">fixture</span>
        <input
          className="dc-input dc-input--mono"
          value={selected.fixture}
          onChange={(e) => patch({ fixture: e.target.value })}
          placeholder="本地快照路径（可选）"
          style={{ width: 180 }}
          aria-label="fixture 本地快照路径"
        />
      </div>

      <div className="dc-toolbar__spacer" />

      <button
        type="button"
        className="dc-btn dc-btn--primary"
        onClick={() => run()}
        disabled={loading || actions.length === 0}
        aria-label="运行插件动作"
      >
        {loading ? (
          <>
            <span className="dc-spinner" aria-hidden />
            运行中…
          </>
        ) : (
          <>
            <PlayIcon size={12} />
            运行
          </>
        )}
      </button>
    </div>
  )
}
