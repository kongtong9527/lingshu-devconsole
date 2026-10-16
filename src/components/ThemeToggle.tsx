import { useStore } from '../store.js'
import { SunIcon, MoonIcon } from '../icons.js'

export default function ThemeToggle() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)

  return (
    <button
      className="dc-btn dc-btn--ghost dc-btn--icon"
      onClick={toggleTheme}
      title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
    >
      {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
    </button>
  )
}