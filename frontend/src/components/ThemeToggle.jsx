import { useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { getTheme, toggleTheme } from '../theme/theme'

// Small header button that switches between the default dark theme and the
// opt-in light theme. The choice is persisted (see theme.js) so it survives
// reloads.
export default function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme())
  const isLight = theme === 'light'

  return (
    <button
      onClick={() => setThemeState(toggleTheme())}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-label="Toggle colour theme"
      style={{
        width: 32, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, border: '1px solid rgba(var(--rgb-slate), 0.6)',
        background: 'rgba(var(--rgb-slate), 0.3)',
        color: 'var(--c-64748b)', cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--rgb-slate), 0.6)'; e.currentTarget.style.color = 'var(--c-94a3b8)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--rgb-slate), 0.3)'; e.currentTarget.style.color = 'var(--c-64748b)' }}
    >
      {isLight ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  )
}
