import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './theme/theme.css'
import { initTheme } from './theme/theme.js'
import { loadAuthConfig, initAuth } from './auth/auth.js'
import Login from './auth/Login.jsx'

// Apply the saved colour theme before the first render (avoids a flash).
initTheme()

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root'))
  const config = await loadAuthConfig()

  // Auth not configured (local dev / setup-wizard mode) → run the app open.
  if (!config || !config.authRequired) {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
    return
  }

  let signedIn = false
  try {
    signedIn = await initAuth(config)
  } catch (err) {
    console.error('[auth] initialisation failed:', err)
  }

  root.render(
    <React.StrictMode>
      {signedIn ? <App /> : <Login />}
    </React.StrictMode>
  )
}

bootstrap()
