import React from 'react'
import ReactDOM from 'react-dom/client'
import Settings from './settings'
import './settings.css'

type BoundaryState = {
  error: Error | null
}

class SettingsErrorBoundary extends React.Component<
  React.PropsWithChildren,
  BoundaryState
> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[settings] render crashed', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            background: '#1e1e2e',
            color: '#f8d7da',
            padding: '24px',
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          }}
        >
          <h2 style={{ marginBottom: '12px', color: '#fff' }}>Settings renderer crashed</h2>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'rgba(0,0,0,0.25)',
              padding: '16px',
              borderRadius: '12px',
            }}
          >
            {this.state.error.stack || this.state.error.message}
          </pre>
        </div>
      )
    }

    return this.props.children
  }
}

window.addEventListener('error', (event) => {
  console.error('[settings] window error', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[settings] unhandled rejection', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <SettingsErrorBoundary>
    <Settings />
  </SettingsErrorBoundary>,
)
