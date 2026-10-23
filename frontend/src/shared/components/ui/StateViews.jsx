import styles from './StateViews.module.css';

export function EmptyState({ title = 'Nothing to see here', message, icon, action, className, style }) {
  return (
    <div className={className} style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--color-text-muted)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', ...style }}>
      {icon ? icon : (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      )}
      <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: message ? '0.5rem' : 0 }}>{title}</h3>
      {message && <p style={{ fontSize: '0.9rem' }}>{message}</p>}
      {action && <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center' }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message = 'There was an error loading the data.', onRetry }) {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-text-muted)', width: '100%' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger, #ef4444)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.8 }}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h3 style={{ fontSize: '1.1rem', color: 'var(--color-text-main)', marginBottom: '0.5rem' }}>{title}</h3>
      <p style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>{message}</p>
      {onRetry && (
        <button 
          onClick={onRetry}
          style={{ padding: '0.5rem 1rem', background: 'var(--color-bg-white)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-main)', cursor: 'pointer', fontWeight: 500 }}
        >
          Try Again
        </button>
      )}
    </div>
  );
}

export { default as NotFoundState } from './NotFoundState';


/**
 * A screen opened offline with nothing to show for it. Shown instead of a
 * skeleton that never ends or a generic "something went wrong"; the data loads
 * by itself when the connection returns (queries resume), so there is nothing
 * to tap. The wording never says what is or is not kept on the device.
 */
export function OfflineState({ title = "You're offline", message = 'Connect to the internet to see this.', action, className, style }) {
  return (
    <EmptyState
      className={className}
      style={style}
      title={title}
      message={message}
      action={action}
      icon={
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }} aria-hidden="true">
          <line x1="2" y1="2" x2="22" y2="22" />
          <path d="M8.5 16.5a5 5 0 0 1 7 0" />
          <path d="M2 8.8a15 15 0 0 1 4.2-2.6" />
          <path d="M10.7 5.1A15 15 0 0 1 22 8.8" />
          <path d="M5 12.9a10 10 0 0 1 5.2-2.7" />
          <path d="M13.9 10.4a10 10 0 0 1 5.1 2.5" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      }
    />
  );
}

/**
 * The offline state for a whole screen that has nothing else on it: centred,
 * both ways, in what is visible of the screen.
 *
 * On a phone it is laid over exactly that area (under the status bar, above the
 * bottom bar or the home indicator), so it is centred in the visible screen
 * whatever padding or height the page around it has. On a wide screen it is an
 * ordinary block in the page's content column. `onBack` adds a Back button, for
 * a page opened from somewhere (a community, an activity) that has no bar of
 * its own to leave by.
 */
export function OfflineScreen({ title, message, onBack }) {
  return (
    <div className={styles.screen} data-offline-screen="">
      <OfflineState
        title={title}
        message={message}
        style={{ padding: '1.5rem 1rem' }}
        action={onBack ? (
          <button type="button" className={styles.backButton} onClick={onBack}>
            Go back
          </button>
        ) : undefined}
      />
    </div>
  );
}
