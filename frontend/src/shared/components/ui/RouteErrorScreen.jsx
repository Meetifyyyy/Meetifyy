import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import styles from './RouteErrorScreen.module.css';

function AlertCircleIcon() {
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/**
 * RouteErrorScreen — rendered by RouteErrorBoundary when an error occurs
 * within a single route.
 *
 * It sits inside the main content column so the application shell (header,
 * sidebar) stays fully intact.
 *
 * There used to be a second, full-viewport variant. Onboarding was the only
 * route that asked for it — it was the only caller passing `fullScreen`, and
 * the only path the component special-cased — so it went with that route.
 *
 * Props:
 *  onRetry — resets the boundary state so React retries the render
 */
export default function RouteErrorScreen({ onRetry }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleRetry = () => {
    try {
      // Invalidate and reset any cached query errors so React Query fetches fresh data
      queryClient.resetQueries();
      queryClient.invalidateQueries();
    } catch {
      // Ignore query client errors
    }

    if (typeof onRetry === 'function') {
      try {
        onRetry();
      } catch {
        window.location.reload();
      }
    } else {
      window.location.reload();
    }
  };

  return (
    <div className={styles.fullPageWrapper} role="alert">
      <div className={styles.container}>
        <div className={styles.iconWrapper}>
          <AlertCircleIcon />
        </div>

        <h2 className={styles.title}>Something went wrong</h2>

        <p className={styles.message}>
          This page hit an unexpected problem. Your other tabs and data are fine.
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            onClick={handleRetry}
            className={styles.primaryBtn}
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => navigate('/home', { replace: true })}
            className={styles.secondaryBtn}
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
