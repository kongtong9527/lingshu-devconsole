import { useEffect } from 'react'
import { useStore } from './store.js'
import PluginList from './components/PluginList.js'
import RunBar from './components/RunBar.js'
import ResultPanel from './components/ResultPanel.js'
import UiPromptHost from './components/UiPromptHost.js'
import ThemeToggle from './components/ThemeToggle.js'
import { TerminalIcon } from './icons.js'

export default function App() {
  const loadPlugins = useStore((s) => s.loadPlugins)
  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  return (
    <div className="dc-app">
      <header className="dc-header">
        <div className="dc-header__brand">
          <span className="dc-header__brand-mark" aria-hidden>
            <TerminalIcon size={14} />
          </span>
          灵枢 DevConsole
        </div>
        <span className="dc-header__tag">PLUGIN RUNTIME</span>
        <div className="dc-header__spacer" />
        <ThemeToggle />
        <a
          className="dc-header__link"
          href="https://github.com/anomalyco/lingshu"
          target="_blank"
          rel="noreferrer"
        >
          文档
        </a>
      </header>
      <div className="dc-body">
        <aside className="dc-sidebar" aria-label="插件列表">
          <PluginList />
        </aside>
        <main className="dc-main">
          <RunBar />
          <ResultPanel />
        </main>
      </div>
      <UiPromptHost />
    </div>
  )
}
