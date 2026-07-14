export function EmptyState({ title = 'Nothing to see here', message, icon }) {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-text-muted)', width: '100%' }}>
      {icon ? icon : (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      )}
      <h3 style={{ fontSize: '1.1rem', color: 'var(--color-text-main)', marginBottom: '0.5rem' }}>{title}</h3>
      {message && <p style={{ fontSize: '0.9rem' }}>{message}</p>}
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
