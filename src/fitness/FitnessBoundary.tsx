import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Keeps a Fitness crash contained: the finance section stays usable. */
export class FitnessBoundary extends Component<{ children: ReactNode; onBack: () => void }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Fitness section failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="panel">
        <p className="eyebrow">Fitness</p>
        <h2>Fitness hit a problem</h2>
        <p className="quiet-line">Your data is safe. Finance is not affected.</p>
        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={this.props.onBack}>
            Back to Finance
          </button>
          <button type="button" className="primary-button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </section>
    )
  }
}
