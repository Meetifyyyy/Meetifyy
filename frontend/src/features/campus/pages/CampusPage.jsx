import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useCampusUsers } from '@shared/hooks/useProfile';
import { useCampusCommunities } from '@shared/hooks/useCommunities';
import { useCampusEvents, useDeleteCampusEvent } from '@shared/hooks/useCampusEvents';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import CreateCommunityModal from '@features/communities/components/modals/CreateCommunityModal';
import CampusEventSection from '@features/campus-events/components/CampusEventSection';
import CampusEventForm from '@features/campus-events/components/CampusEventForm';
import eventStyles from '@features/campus-events/components/CampusEvents.module.css';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { Plus, Users, CalendarPlus, ChevronRight } from '@shared/components/icons';

export default function CampusPage() {
  const navigate = useNavigate();
  const { currentUser, collegeName: authCollegeName } = useAuth();
  const isCampusRep = Boolean(currentUser?.isCampusRep);

  const { campusUsers } = useCampusUsers(50);
  const { campusCommunities } = useCampusCommunities();

  // Lightweight discovery surface: only upcoming events here. The full
  // Upcoming/Ongoing/Past breakdown lives on the dedicated /campus/events page.
  const upcoming = useCampusEvents('upcoming');
  const deleteEvent = useDeleteCampusEvent();

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [eventFormState, setEventFormState] = useState(null); // null | { event? }
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isPlusMenuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsPlusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPlusMenuOpen]);

  const userCollegeId = currentUser?.collegeId || 'unknown';
  const collegeCommunity = campusCommunities[userCollegeId];
  const collegeName = collegeCommunity?.name || authCollegeName;

  // A fresh four faces on every visit rather than the same head of the list.
  // The seed is fixed for the lifetime of the page, so a background refetch of
  // campusUsers reshuffles nothing under the user's cursor.
  const shuffleSeed = useRef(Math.floor(Math.random() * 2 ** 32));

  const suggestedUsers = useMemo(() => {
    const pool = (campusUsers || []).filter(u => u.id !== currentUser?.id);
    // mulberry32 — a tiny deterministic PRNG so the order is stable per mount.
    let seed = shuffleSeed.current;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 4);
  }, [campusUsers, currentUser]);

  const handleCreateGroup = async (id) => {
    navigate(`/communities/${id}`, { state: { from: '/campus' } });
  };

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
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      {/* HEADER SECTION */}
      <div className={styles.headerBanner}>
        <header className={styles.header}>
          <h1 className={styles.collegeTitle} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1 }}>
            <span>{collegeName}</span>
            <CollegeRepresentativeBadge isCampusRep={isCampusRep} collegeName={collegeName} size="inherit" />
          </h1>

          <div className={`${styles.headerActions} ${styles.headerActionsRelative}`} ref={menuRef}>
            <button
              className={styles.headerSquareBtn}
              onClick={() => setIsPlusMenuOpen(prev => !prev)}
              aria-label="Create menu"
            >
              <Plus size={20} />
            </button>

            {isPlusMenuOpen && (
              <div className={styles.plusDropdownMenu}>
                {isCampusRep && (
                  <button
                    className={styles.plusMenuItem}
                    onClick={() => { setIsPlusMenuOpen(false); setEventFormState({}); }}
                  >
                    <CalendarPlus size={18} className={styles.plusMenuIcon} />
                    <span>Create event</span>
                  </button>
                )}
                <button
                  className={styles.plusMenuItem}
                  onClick={() => { setIsPlusMenuOpen(false); setIsGroupModalOpen(true); }}
                >
                  <Users size={18} className={styles.plusMenuIcon} />
                  <span>Create community</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* NAVIGATION TABS */}
        <div className={styles.stickyNav}>
          <button className={styles.navTab} onClick={() => navigate('/campus/events')}>
            <span className={styles.tabEmoji}>🎟️</span>
            <span>Events</span>
          </button>
          <button className={styles.navTab} onClick={() => navigate('/campus/directory')}>
            <span className={styles.tabEmoji}>🤩</span>
            <span>Directory</span>
          </button>
          <button className={styles.navTab} onClick={() => navigate('/campus/communities')}>
            <span className={styles.tabEmoji}>🫧</span>
            <span>Communities</span>
          </button>
        </div>
      </div>

      {/* CAMPUS BODY SECTIONS */}
      <div className={styles.campusBody}>

        {/* Campus Events — lightweight discovery: upcoming only. */}
        <section className={styles.section}>
          <div className={styles.sectionHeaderRow} style={{ justifyContent: 'space-between' }}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🎟️</span>
              <h2 className={styles.sectionTitleText}>campus events</h2>
            </div>
            {Boolean(upcoming.events && upcoming.events.length > 0) && (
              <button className={eventStyles.createBtn} style={{ background: 'transparent', color: 'var(--color-primary, #8f0c13)', border: '1px solid var(--color-border, rgba(0,0,0,0.12))' }} onClick={() => navigate('/campus/events')}>
                See all <ChevronRight size={15} />
              </button>
            )}
          </div>

          <CampusEventSection
            scope="upcoming"
            showCount={false}
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
        </section>

        {/* Wrapper for Side by Side Sections on Desktop */}
        <div className={styles.sideBySideDesktop}>
          {/* you may know */}
          <section className={styles.section}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🤩</span>
              <h2 className={styles.sectionTitleText}>you may know</h2>
            </div>
            <div className={styles.knowListContainer}>
              {suggestedUsers.map(user => (
                <div key={user.id} className={styles.knowCard} onClick={() => navigate(`/profile/${user.username}`, { state: { from: '/campus' } })} style={{ cursor: 'pointer' }}>
                  <Avatar
                    src={user.avatar}
                    name={user.displayName || user.username}
                    size="88px"
                    showInitials
                  />
                  <span className={styles.knowName}>{user.displayName}</span>
                </div>
              ))}
              {suggestedUsers.length === 0 && (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>No suggestions available.</span>
              )}
            </div>
            <button className={styles.viewDirBtn} onClick={() => navigate('/campus/directory')}>
              View directory
            </button>
          </section>

          {/* discover communities */}
          <section className={styles.section}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🫧</span>
              <h2 className={styles.sectionTitleText}>discover communities</h2>
            </div>
            <div className={styles.discoverGroupsCard} onClick={() => setIsGroupModalOpen(true)}>
              <div className={styles.dashedAddSquare}>
                <Users size={20} />
                <span className={styles.plusOverlay}>+</span>
              </div>
              <span className={styles.discoverGroupsText}>Create a campus community</span>
            </div>
          </section>
        </div>
      </div>

      {isGroupModalOpen && (
        <CreateCommunityModal
          onClose={() => setIsGroupModalOpen(false)}
          onCreated={handleCreateGroup}
          isCampusCommunity={true}
        />
      )}

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
