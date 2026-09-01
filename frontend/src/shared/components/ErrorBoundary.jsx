import { Component, Fragment } from 'react';
import CriticalErrorScreen from './ui/CriticalErrorScreen';
import { recoverFromStaleChunk } from '@shared/lib/staleChunkRecovery';
import RouteErrorScreen from './ui/RouteErrorScreen';

/**
 * RouteErrorBoundary — wraps individual routes.
 * Shows a contained error within the page area only, leaving
 * the shell (header, sidebar) intact. The application never wipes caches, and
 * never reloads on an ordinary error.
 *
 * ONE exception, added deliberately: a lazy-import failure caused by a stale
 * build. When a deploy lands, the old chunk filenames stop existing, so a tab
 * that was already open requests a 404 and the route dies. For that error the
 * retry button is useless — it re-requests the same missing URL — and only a
 * fresh index.html can fix it. `recoverFromStaleChunk` reloads at most once per
 * tab per minute; if the route still fails after that, the cause was not
 * staleness and the error screen is shown as normal, so the tab cannot loop.
 */
export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
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
      return { hasError: false, error: null, prevResetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RouteErrorBoundary]', error, errorInfo);
    // Returns true only when a reload has actually been started, in which case
    // the page is on its way out and there is nothing more to do here.
    recoverFromStaleChunk(error);
  }

  handleRetry = () => {
    if (typeof this.props.onResetQueries === 'function') {
      try {
        this.props.onResetQueries();
      } catch {
        // ignore
      }
    }

    this.setState(s => ({
      hasError: false,
      error: null,
      retryCount: s.retryCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <RouteErrorScreen
          fullScreen={this.props.fullScreen}
          onRetry={this.handleRetry}
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
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RootErrorBoundary]', error, errorInfo);
    // Same recovery at the root: a stale chunk can just as easily take down a
    // component the route boundaries do not wrap, and the outcome there is a
    // blank app rather than a contained error.
    recoverFromStaleChunk(error);
  }

  render() {
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
