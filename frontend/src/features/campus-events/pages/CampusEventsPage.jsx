import { useState, useCallback, lazy, Suspense } from 'react';
import { ArrowLeft, CalendarPlus } from '@shared/components/icons';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { useCampusEvents, useDeleteCampusEvent } from '@shared/hooks/useCampusEvents';
import CampusEventSection from '../components/CampusEventSection';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import sharedStyles from '@features/campus/components/skeletons/CampusShared.module.css';
import VerificationGate from '@shared/components/VerificationGate/VerificationGate';

/**
 * Only ever opened by a campus representative, from the "+" button or a card's
 * Edit control. Statically imported it dragged the whole image-upload pipeline
 * (browser-image-compression) plus two custom pickers onto this route's
 * critical path — about 87 kB of JavaScript parsed before the first event could
 * paint, for a page most visitors only read.
 */
const CampusEventForm = lazy(() => import('../components/CampusEventForm'));

/**
 * Dedicated Campus Events page — the full event history and categorisation:
 * Upcoming / Ongoing / Past. Reuses the shared discovery hooks and section
 * components; no duplicate data structures.
 */
export default function CampusEventsPage() {
  const goBack = useSmartBack();
  const { currentUser } = useAuth();
  const isCampusRep = Boolean(currentUser?.isCampusRep);

  const upcoming = useCampusEvents('upcoming');
  const ongoing = useCampusEvents('ongoing');
  const past = useCampusEvents('past');
  const deleteEvent = useDeleteCampusEvent();

  const [eventFormState, setEventFormState] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);

  const handleDeleteEvent = useCallback(async () => {
    if (!deleteCandidate?.id) return;
    try {
      await deleteEvent.mutateAsync(deleteCandidate.id);
      showToast('Event deleted', 'success');
    } catch (err) {
      showToast(err?.message || "Couldn't delete event", 'error');
    } finally {
      setDeleteCandidate(null);
    }
  }, [deleteCandidate, deleteEvent]);

  // Stable across renders so the memoized event cards below stay memoized —
  // an inline arrow here is a new prop for every card in all three sections on
  // every render of this page.
  const editEvent = useCallback((ev) => setEventFormState({ event: ev }), []);
  const openCreateForm = useCallback(() => setEventFormState({}), []);
  const closeEventForm = useCallback(() => setEventFormState(null), []);
  const clearDeleteCandidate = useCallback(() => setDeleteCandidate(null), []);

  return (
    <main className={`centre centre-wide ${sharedStyles.hubContainer}`}>
      <VerificationGate message="Verify your student ID to access the campus directory, events, and communities." fullPage>
        <div className={`${sharedStyles.headerBanner} ${sharedStyles.compactHeader}`}>
          <header className={sharedStyles.header}>
            <div className={sharedStyles.headerLeftGroup}>
              <button className={sharedStyles.headerSquareBtn} onClick={() => goBack('/campus')} title="Back">
                <ArrowLeft size={20} />
              </button>
              <h1 className={sharedStyles.collegeTitle} style={{ margin: 0 }}>Events</h1>
            </div>
            {isCampusRep && (
              <div className={sharedStyles.headerActions}>
                <button
                  className={sharedStyles.headerSquareBtn}
                  onClick={openCreateForm}
                  title="Create event"
                >
                  <CalendarPlus size={20} />
                </button>
              </div>
            )}
          </header>
        </div>

        <div className={sharedStyles.campusBody} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', paddingTop: '0.5rem' }}>
          <CampusEventSection
            scope="ongoing"
            title="Happening now"
            emoji="🔴"
            live
            events={ongoing.events}
            isLoading={ongoing.isLoading}
            emptyText="No events are live right now."
            canManage={isCampusRep}
            onEdit={editEvent}
            onDelete={setDeleteCandidate}
            hasNextPage={ongoing.hasNextPage}
            isFetchingNextPage={ongoing.isFetchingNextPage}
            fetchNextPage={ongoing.fetchNextPage}
          />

          <CampusEventSection
            scope="upcoming"
            title="Upcoming events"
            emoji="🎟️"
            events={upcoming.events}
            isLoading={upcoming.isLoading}
            emptyText="No upcoming events yet. Check back soon!"
            canManage={isCampusRep}
            onEdit={editEvent}
            onDelete={setDeleteCandidate}
            hasNextPage={upcoming.hasNextPage}
            isFetchingNextPage={upcoming.isFetchingNextPage}
            fetchNextPage={upcoming.fetchNextPage}
          />

          <CampusEventSection
            scope="past"
            title="Past events"
            emoji="🗂️"
            events={past.events}
            isLoading={past.isLoading}
            emptyText="No past events to show."
            canManage={false}
            hasNextPage={past.hasNextPage}
            isFetchingNextPage={past.isFetchingNextPage}
            fetchNextPage={past.fetchNextPage}
          />
        </div>

        {eventFormState && (
          <Suspense fallback={null}>
            <CampusEventForm
              event={eventFormState.event || null}
              onClose={closeEventForm}
              onSaved={closeEventForm}
            />
          </Suspense>
        )}

        <ConfirmModal
          visible={Boolean(deleteCandidate)}
          title="Delete Event"
          description={deleteCandidate ? `"${deleteCandidate.title}" will be permanently removed.` : ''}
          confirmText="Delete"
          cancelText="Cancel"
          isDestructive={true}
          onConfirm={handleDeleteEvent}
          onCancel={clearDeleteCandidate}
        />
      </VerificationGate>
    </main>
  );
}
