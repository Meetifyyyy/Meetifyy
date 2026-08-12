import { useNavigate } from 'react-router-dom';
import styles from './RouteErrorScreen.module.css';
function AlertCircleIcon() {
  return (
    <svg
      width="42"
      height="42"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <circle cx="12" cy="16.25" r="0.65" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * RouteErrorScreen — rendered by RouteErrorBoundary when an error occurs
 * within a single route. Sits inside the main content column so the
 * application shell (header, sidebar) stays fully intact.
 *
 * Props:
 *  onRetry — resets the boundary state so React retries the render
 */
export default function RouteErrorScreen({ onRetry }) {
  const navigate = useNavigate();

  return (
    <div className={styles.fullPageWrapper}>
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
            onClick={onRetry}
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
