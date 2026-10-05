import { lazy, Suspense } from 'react';

/**
 * ReportModal, fetched the first time somebody actually reports something.
 *
 * The modal carries zod and react-hook-form — a 100 KB chunk — and every Post,
 * comment and profile mounts one, closed, so a static import put that chunk on
 * the path to the first Home render of every launch. It renders nothing while
 * closed anyway, so mounting it only once open changes nothing a user can see;
 * the first open waits on one local chunk.
 */
const ReportModal = lazy(() => import('./ReportModal'));

export default function LazyReportModal(props) {
  if (!props.isOpen) return null;
  return (
    <Suspense fallback={null}>
      <ReportModal {...props} />
    </Suspense>
  );
}
