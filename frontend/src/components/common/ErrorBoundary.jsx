import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--color-bg)' }}>
          <h2 style={{ color: 'var(--color-danger)', marginBottom: '1rem' }}>Something went wrong.</h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem', maxWidth: '500px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button 
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = '/';
            }}
            style={{ padding: '0.75rem 1.5rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '100px', cursor: 'pointer', fontWeight: 600 }}
          >
            Go to Homepage
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
