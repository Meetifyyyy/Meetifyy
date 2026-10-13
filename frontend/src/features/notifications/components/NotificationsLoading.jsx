/**
 * The loading state of the notification lists: one centred spinner where the
 * rows will be, announced to assistive tech. Used by the page while a list
 * loads and by the route while the page's chunk loads.
 */
export default function NotificationsLoading({ label = 'Loading notifications' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0', minHeight: '40vh' }}
    >
      <span className="spinner" aria-hidden="true" />
    </div>
  );
}
