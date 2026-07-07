import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppErrorBoundary } from './ErrorBoundary'
import './styles.css'
import { registerServiceWorker } from './registerServiceWorker'
import { ensureIndexedDb } from './storageBootstrap'

ensureIndexedDb()
  .then(async () => {
    const { default: App } = await import('./App')

    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>,
    )

    registerServiceWorker()
  })
  .catch((error) => {
    console.error('Unable to prepare local storage', error)
  })
