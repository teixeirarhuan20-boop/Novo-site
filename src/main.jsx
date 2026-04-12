import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#0f172a', color: 'white', fontFamily: 'monospace',
          padding: '2rem', textAlign: 'center'
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>💥 Erro de JavaScript</h2>
          <pre style={{
            background: '#1e293b', padding: '1.5rem', borderRadius: '8px',
            maxWidth: '700px', width: '100%', textAlign: 'left',
            fontSize: '0.85rem', color: '#f87171', overflowX: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>
            {this.state.error?.message}{'\n\n'}{this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
