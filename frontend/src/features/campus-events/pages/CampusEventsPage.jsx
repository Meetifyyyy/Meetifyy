import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarPlus } from '@shared/components/icons';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { useCampusEvents, useDeleteCampusEvent } from '@shared/hooks/useCampusEvents';
import CampusEventSection from '../components/CampusEventSection';
import CampusEventForm from '../components/CampusEventForm';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import sharedStyles from '@features/campus/components/skeletons/CampusShared.module.css';

/**
 * Dedicated Campus Events page — the full event history and categorisation:
 * Upcoming / Ongoing / Past. Reuses the shared discovery hooks and section
 * components; no duplicate data structures.
 */
export default function CampusEventsPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();
  const isCampusRep = Boolean(currentUser?.isCampusRep);

  const upcoming = useCampusEvents('upcoming');
  const ongoing = useCampusEvents('ongoing');
  const past = useCampusEvents('past');
  const deleteEvent = useDeleteCampusEvent();

  const [eventFormState, setEventFormState] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);

  const handleDeleteEvent = async () => {
    if (!deleteCandidate?.id) return;
    try {
      await deleteEvent.mutateAsync(deleteCandidate.id);
      showToast('Event deleted', 'success');
    } catch (err) {
      showToast(err?.message || "Couldn't delete event", 'error');
    } finally {
      setDeleteCandidate(null);
    }
  };

  return (
    <main className={`centre centre-wide ${sharedStyles.hubContainer}`}>
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
                onClick={() => setEventFormState({})}
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
          onEdit={(ev) => setEventFormState({ event: ev })}
          onDelete={setDeleteCandidate}
          hasNextPage={ongoing.hasNextPage}
          isFetchingNextPage={ongoing.isFetchingNextPage}
          fetchNextPage={ongoing.fetchNextPage}
        />

        <CampusEventSection
          scope="upcoming"
          title="Upcoming events"
          emoji="📅"
          events={upcoming.events}
          isLoading={upcoming.isLoading}
          emptyText="No upcoming events yet. Check back soon!"
          canManage={isCampusRep}
          onEdit={(ev) => setEventFormState({ event: ev })}
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
        <CampusEventForm
          event={eventFormState.event || null}
          onClose={() => setEventFormState(null)}
          onSaved={() => setEventFormState(null)}
        />
      )}

      <ConfirmModal
        visible={Boolean(deleteCandidate)}
        title="Delete Event"
        description={deleteCandidate ? `"${deleteCandidate.title}" will be permanently removed.` : ''}
        confirmText="Delete"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={handleDeleteEvent}
        onCancel={() => setDeleteCandidate(null)}
      />
    </main>
  );
}
