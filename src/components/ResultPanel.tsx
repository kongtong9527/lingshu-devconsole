import type { ReactNode } from 'react'
import { useStore } from '../store.js'
import PreviewDispatcher from '../preview/index.js'
import RequestList from './RequestList.js'
import ChallengeError, { isChallengeResult } from './ChallengeError.js'
import SettingsPanel from './SettingsPanel.js'
import AccountPanel from './AccountPanel.js'
import { ArrowLeftIcon, TrashIcon, BracesIcon, EyeIcon, NetworkIcon, SettingsIcon, UserIcon, InboxIcon, AlertIcon } from '../icons.js'

export default function ResultPanel() {
  const result = useStore((s) => s.result)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const loading = useStore((s) => s.loading)
  const history = useStore((s) => s.history)
  const goBack = useStore((s) => s.goBack)
  const clearHistory = useStore((s) => s.clearHistory)
  const plugins = useStore((s) => s.plugins)
  const pluginId = useStore((s) => s.selected.pluginId)
  const plugin = plugins.find((p) => p.id === pluginId)
  const hasSettings = !!plugin?.settingsSchema && plugin.settingsSchema.length > 0
  const hasAccount = !!plugin?.accountSchema && ((plugin.accountSchema.loginFields?.length ?? 0) > 0)

  const canGoBack = history.length >= 2 && !loading
  const canClear = history.length > 0 && !loading

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="dc-tabbar" role="tablist" aria-label="结果视图">
        <button
          type="button"
          className="dc-btn dc-btn--ghost dc-btn--xs"
          onClick={goBack}
          disabled={!canGoBack}
          title="返回上一步预览"
          aria-label="返回上一步预览"
        >
          <ArrowLeftIcon size={12} />
          返回
        </button>
        <button
          type="button"
          className="dc-btn dc-btn--ghost dc-btn--xs"
          onClick={clearHistory}
          disabled={!canClear}
          title="清除预览历史缓存"
          aria-label="清除预览历史缓存"
        >
          <TrashIcon size={12} />
          清除历史
        </button>

        <span style={{ width: 1, height: 18, background: 'var(--dc-color-border)', margin: '0 var(--dc-space-2)' }} />

        <Tab id="tab-json" active={view === 'json'} onClick={() => setView('json')} icon={<BracesIcon />}>
          JSON
        </Tab>
        <Tab id="tab-preview" active={view === 'preview'} onClick={() => setView('preview')} icon={<EyeIcon />}>
          预览
        </Tab>
        {result && (
          <Tab
            id="tab-requests"
            active={view === 'requests'}
            onClick={() => setView('requests')}
            icon={<NetworkIcon />}
          >
            请求
            {result.httpLog && result.httpLog.length > 0 && (
              <span className="dc-tab__badge">{result.httpLog.length}</span>
            )}
          </Tab>
        )}

        {hasSettings && (
          <Tab
            id="tab-settings"
            active={view === 'settings'}
            onClick={() => setView('settings')}
            icon={<SettingsIcon />}
          >
            设置
          </Tab>
        )}

        {hasAccount && (
          <Tab
            id="tab-account"
            active={view === 'account'}
            onClick={() => setView('account')}
            icon={<UserIcon />}
          >
            账号
          </Tab>
        )}

        <span className="dc-tabbar__spacer" />

        {result && (
          <span
            className={
              result.ok ? 'dc-status-dot dc-status-dot--ok' : 'dc-status-dot dc-status-dot--error'
            }
          >
            {result.ok ? `200 · ${result.durationMs}ms` : '错误'}
          </span>
        )}
      </div>

      <div className="dc-result">
        {view === 'settings' && hasSettings && <SettingsPanel />}

        {view === 'account' && hasAccount && <AccountPanel />}

        {view !== 'settings' && view !== 'account' && loading && <Skeleton />}

        {view !== 'settings' && view !== 'account' && !loading && !result && (
          <div className="dc-empty">
            <InboxIcon size={36} className="dc-empty__icon" />
            <div className="dc-empty__title">尚未运行</div>
            <div className="dc-empty__hint">选择插件与动作，点击「运行」查看结果</div>
          </div>
        )}

        {view !== 'settings' && view !== 'account' && !loading && result && !result.ok && (
          <div style={{ padding: 'var(--dc-space-6)' }}>
            {isChallengeResult(result) ? (
              <ChallengeError result={result} />
            ) : (
              <div className="dc-error">
                <div className="dc-error__title">
                  <AlertIcon size={16} />
                  运行错误
                </div>
                {result.error && <div className="dc-error__msg">{result.error}</div>}
                {result.stack && <pre className="dc-error__stack">{result.stack}</pre>}
              </div>
            )}
          </div>
        )}

        {!loading && result && result.ok && view === 'json' && (
          <pre className="dc-codeblock">{JSON.stringify(result.data, null, 2)}</pre>
        )}

        {!loading && result && result.ok && view === 'preview' && <PreviewDispatcher />}

        {!loading && result && view === 'requests' && (
          <div style={{ padding: 'var(--dc-space-6)' }}>
            <RequestList />
          </div>
        )}
      </div>
    </div>
  )
}

function Tab({
  id,
  active,
  onClick,
  icon,
  children,
}: {
  id: string
  active: boolean
  onClick: () => void
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className="dc-tab"
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  )
}

function Skeleton() {
  return (
    <div className="dc-skeleton" aria-label="加载中" role="status">
      <div className="dc-skeleton__line" style={{ width: '40%', height: 16 }} />
      <div className="dc-skeleton__line" />
      <div className="dc-skeleton__line" style={{ width: '85%' }} />
      <div className="dc-skeleton__line" style={{ width: '60%' }} />
      <div className="dc-skeleton__line" />
      <div className="dc-skeleton__line" style={{ width: '75%' }} />
    </div>
  )
}
