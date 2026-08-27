import { useNavigate, useLocation } from 'react-router-dom';
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
 * For onboarding (or fullScreen=true), it covers the whole screen on both
 * large screens and mobile devices and applies the identical onboarding ambient
 * theme (white background, ambient blobs, Changa One headline, brand-purple CTA).
 *
 * For regular dashboard routes, it sits inside the main content column so the
 * application shell (header, sidebar) stays fully intact.
 *
 * Props:
 *  onRetry — resets the boundary state so React retries the render
 *  fullScreen — whether to cover the entire viewport
 */
export default function RouteErrorScreen({ onRetry, fullScreen = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isOnboarding = fullScreen || location?.pathname === '/onboarding';

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

  if (isOnboarding) {
    return (
      <div className={styles.onboardingFullScreenWrapper} role="alert">
        <div className={styles.ambient} aria-hidden="true">
          <span className={`${styles.blob} ${styles.blobA}`} />
          <span className={`${styles.blob} ${styles.blobB}`} />
        </div>

        <div className={styles.onboardingContainer}>
          <div className={styles.onboardingIconWrapper}>
            <AlertCircleIcon />
          </div>

          <h1 className={styles.onboardingTitle}>Something went wrong</h1>

          <p className={styles.onboardingMessage}>
            We encountered an error loading your onboarding. Please try again.
          </p>

          <div className={styles.onboardingActions}>
            <button
              type="button"
              onClick={handleRetry}
              className={styles.onboardingPrimaryBtn}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

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
