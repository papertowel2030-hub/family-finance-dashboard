import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Family Finance startup failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="app-shell">
        <section className="setup-panel">
          <div className="setup-copy">
            <p className="eyebrow">Startup issue</p>
            <h2>The dashboard could not start</h2>
          </div>
          <div className="setup-actions">
            <p className="quiet-line">
              Reload the app once. If this keeps happening, the browser console will show the exact startup error.
            </p>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              <RefreshCcw size={18} />
              Reload
            </button>
          </div>
        </section>
      </main>
    )
  }
}
