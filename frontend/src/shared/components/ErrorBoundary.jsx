import { Component, Fragment } from 'react';
import CriticalErrorScreen from './ui/CriticalErrorScreen';
import RouteErrorScreen from './ui/RouteErrorScreen';

/**
 * RouteErrorBoundary — wraps individual routes.
 * Shows a contained error within the page area only, leaving
 * the shell (header, sidebar) intact. Import failures are shown as normal
 * route errors; the application never wipes caches or reloads automatically.
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
