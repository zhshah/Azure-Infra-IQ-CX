// ── Colour theme preference ────────────────────────────────────────────────
// The app ships with a dark theme by default. Users can opt into a lighter
// theme via the header toggle; the choice is persisted in localStorage so it
// is restored on the next visit. The dark theme is the default and is left
// completely untouched — light mode simply adds a class to <html>.

const STORAGE_KEY = 'infraiq-theme'

export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'light') root.classList.add('theme-light')
  else root.classList.remove('theme-light')
}

export function setTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* storage unavailable — apply for this session only */
  }
  applyTheme(theme)
}

export function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light'
  setTheme(next)
  return next
}

// Apply the saved theme as early as possible (before React renders) so there
// is no flash of the wrong theme on load.
export function initTheme() {
  applyTheme(getTheme())
}
