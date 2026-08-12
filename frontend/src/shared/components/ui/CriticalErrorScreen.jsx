import styles from './CriticalErrorScreen.module.css';

function SparkleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={styles.sparkle}
    >
      <path d="M12 1.5l1.545 7.455L21 10.5l-7.455 1.545L12 19.5l-1.545-7.455L3 10.5l7.455-1.545L12 1.5z" />
    </svg>
  );
}

/**
 * CriticalErrorScreen - rendered by RootErrorBoundary when an unhandled
 * React error escapes all route-level boundaries.
 *
 * Covers the entire viewport (position: fixed; inset: 0; z-index: 99999)
 * so no shell UI leaks through. Uses only Meetifyy design tokens.
 *
 * Props:
 *  onRetry - resets the error boundary state so React retries the render
 */
export default function CriticalErrorScreen({ onRetry }) {
  const handleGoHome = () => {
    try {
      window.location.href = '/home';
    } catch {
      window.location.href = '/';
    }
  };

  return (
    <div className={styles.overlay} role="alert" aria-live="assertive">
      <div className={styles.card}>

        <div className={styles.sparkleRow}>
          <SparkleIcon />
        </div>

        <h1 className={styles.title}>
          <span className={styles.accent}>Oops!</span>{' '}Something
          <br />
          Went Wrong
        </h1>

        <p className={styles.message}>
          We're already on it. Please try again in a moment.
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
            onClick={handleGoHome}
            className={styles.secondaryBtn}
          >
            Go Home
          </button>
        </div>
      </div>
    </div>
  );
}
