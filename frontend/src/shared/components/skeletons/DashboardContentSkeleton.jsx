import Skeleton from './Skeleton';

/**
 * Generic skeleton for pages inside the dashboard shell.
 * Only fills the content area — no header/sidebar duplication.
 * Used as the Suspense fallback for all dashboard routes except /home.
 */
export default function DashboardContentSkeleton() {
  return (
    <main className="centre" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingTop: '1rem' }}>
      {/* Page title bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Skeleton type="text" width="160px" height="22px" style={{ marginBottom: 0 }} />
        <Skeleton type="rect" width="90px" height="34px" style={{ borderRadius: 'var(--radius-md)' }} />
      </div>

      {/* Card rows */}
      {[180, 160, 200, 160].map((h, i) => (
        <Skeleton key={i} type="rect" width="100%" height={`${h}px`} style={{ borderRadius: 'var(--radius-lg)' }} />
      ))}
    </main>
  );
}
