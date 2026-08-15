import { Component, Fragment } from 'react';
import CriticalErrorScreen from './ui/CriticalErrorScreen';
import RouteErrorScreen from './ui/RouteErrorScreen';

function isChunkError(error) {
  const msg = error?.message || '';
  return (
    error?.name === 'ChunkLoadError' ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Failed to load module script') ||
    msg.includes('MIME type') ||
    msg.includes('Strict MIME type checking') ||
    msg.includes('dynamically imported module') ||
    msg.includes('Loading chunk')
  );
}

function silentReload() {
  try {
    const alreadyReloaded = JSON.parse(
      window.sessionStorage.getItem('page_reloaded_on_chunk_error') || 'false'
    );
    if (!alreadyReloaded) {
      try { window.sessionStorage.setItem('page_reloaded_on_chunk_error', 'true'); } catch (_) {}
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
        const url = new URL(window.location.href);
        url.searchParams.set('_v', Date.now().toString());
        window.location.replace(url.toString());
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
    this.state = {
      hasError: false,
      isChunkReloading: false,
      error: null,
      retryCount: 0,
      prevResetKey: props.resetKey ?? null,
    };
  }

  /**
   * Reset the boundary automatically when the wrapped route changes.
   * This prevents a stale hasError state from bleeding into a new page
   * when React reuses the same boundary instance across route transitions.
   */
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== undefined && props.resetKey !== state.prevResetKey) {
      return { hasError: false, isChunkReloading: false, error: null, prevResetKey: props.resetKey };
    }
    return null;
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
        <RouteErrorScreen
          onRetry={() => this.setState(s => ({ hasError: false, error: null, retryCount: s.retryCount + 1 }))}
        />
      );
    }

    // Key forces a full unmount + remount of the page tree on retry,
    // so transient state that caused the crash is cleared completely.
    return (
      <Fragment key={this.state.retryCount}>
        {this.props.children}
      </Fragment>
    );
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
        <CriticalErrorScreen
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}
