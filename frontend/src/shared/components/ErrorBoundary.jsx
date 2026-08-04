import { Component } from 'react';

function isChunkError(error) {
  return (
    error?.name === 'ChunkLoadError' ||
    error?.message?.includes('Failed to fetch dynamically imported module') ||
    error?.message?.includes('Importing a module script failed') ||
    error?.message?.includes('dynamically imported module')
  );
}

function silentReload() {
  try {
    const alreadyReloaded = JSON.parse(
      window.sessionStorage.getItem('page_reloaded_on_chunk_error') || 'false'
    );
    if (!alreadyReloaded) {
      window.sessionStorage.setItem('page_reloaded_on_chunk_error', 'true');
      Promise.resolve().then(async () => {
        try {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
        } catch { /* ignore */ }
        window.location.reload();
      });
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * RouteErrorBoundary — wraps individual routes.
 * Shows a contained error within the page area only, leaving
 * the shell (header, sidebar) intact.
 * Chunk-load errors are handled silently with an auto-reload — no flash.
 */
export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isChunkReloading: false, error: null };
  }

  static getDerivedStateFromError(error) {
    if (isChunkError(error)) {
      // Kick off silent reload; render nothing while it happens
      silentReload();
      return { hasError: false, isChunkReloading: true, error };
    }
    return { hasError: true, isChunkReloading: false, error };
  }

  componentDidCatch(error, errorInfo) {
    if (!isChunkError(error)) {
      console.error('[RouteErrorBoundary]', error, errorInfo);
    }
  }

  render() {
    // Blank screen while the page silently reloads after a chunk error
    if (this.state.isChunkReloading) return null;

    if (this.state.hasError) {
      return (
        <div style={{
          padding: '3rem 2rem',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          marginTop: '3rem',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-main)', margin: 0 }}>
            Something went wrong on this page.
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '360px', margin: 0, lineHeight: 1.6 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: '0.25rem',
              padding: '0.55rem 1.4rem',
              background: 'var(--color-primary)',
              color: 'var(--color-bg-white)',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              fontFamily: 'var(--font-family-sans)',
              fontWeight: 600,
              fontSize: '0.875rem',
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * RootErrorBoundary — wraps the entire app.
 * Only catches errors that escape all route-level boundaries.
 * Chunk-load errors are handled silently with an auto-reload — no flash.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isChunkReloading: false, error: null };
  }

  static getDerivedStateFromError(error) {
    if (isChunkError(error)) {
      silentReload();
      return { hasError: false, isChunkReloading: true, error };
    }
    return { hasError: true, isChunkReloading: false, error };
  }

  componentDidCatch(error, errorInfo) {
    if (!isChunkError(error)) {
      console.error('[RootErrorBoundary]', error, errorInfo);
    }
  }

  render() {
    if (this.state.isChunkReloading) return null;

    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'var(--color-bg-main)',
        }}>
          <h2 style={{ color: 'var(--color-danger)', marginBottom: '1rem' }}>Something went wrong.</h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem', maxWidth: '500px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = '/';
            }}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '100px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Go to Homepage
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
