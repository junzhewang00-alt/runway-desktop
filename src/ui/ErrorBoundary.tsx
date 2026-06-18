import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  panelName: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '20px',
            color: '#d9534f',
            background: '#fff5f5',
            textAlign: 'center',
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            {this.props.panelName} Crashed
          </p>
          <p style={{ fontSize: 12, color: '#999', marginBottom: 16, maxWidth: 250 }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '6px 16px',
              background: '#0078d4',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
