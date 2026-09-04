import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useIsVerified } from '@shared/hooks/useIsVerified';
import { useCampusUsers } from '@shared/hooks/useProfile';
import { useCampusCommunities } from '@shared/hooks/useCommunities';
import { useCampusEvents, useDeleteCampusEvent } from '@shared/hooks/useCampusEvents';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import CampusEventSection from '@features/campus-events/components/CampusEventSection';
import eventStyles from '@features/campus-events/components/CampusEvents.module.css';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { Plus, Users, CalendarPlus, ChevronRight } from '@shared/components/icons';
import { useActivities } from '@shared/hooks/useCrew';
import CrewCard from '@features/crew/components/cards/CrewCard';
import CrewCardSkeleton from '@features/crew/components/cards/CrewCardSkeleton';
import { mapActivity } from '@shared/utils/mapActivity';
import VerificationGate from '@shared/components/VerificationGate/VerificationGate';
import { resolveCommunityAvatar } from '@shared/utils/avatar';

/**
 * Both are creation surfaces reachable only from the "+" menu, and between them
 * they dragged the whole image-upload pipeline (browser-image-compression), two
 * custom pickers and a 700-line form onto the route's critical path — roughly
 * 100 kB of JavaScript parsed before the first campus event could paint, for a
 * screen most visitors only read.
 */
const CampusEventForm = lazy(() => import('@features/campus-events/components/CampusEventForm'));
const CreateCommunityModal = lazy(() => import('@features/communities/components/modals/CreateCommunityModal'));

/** How many campus activities the preview section shows. */
const ACTIVITY_PREVIEW_COUNT = 4;

/**
 * "You may know" fills its row rather than painting a fixed four and leaving a
 * gap. The count is measured from the container, so these are only the bounds.
 *
 * The floor applies only where the row can actually scroll — on a phone it is
 * an overflow-x carousel, and there a partly-visible face is the affordance
 * that says so. Above 768px the same row is `overflow-x: hidden`, so anything
 * that does not fit is silently sliced in half; that column is narrow enough
 * around 1024px to hold only three, which is why the fourth avatar was being
 * cut through the middle there. `useFittingCount` reads which case it is in
 * from the element rather than guessing at a breakpoint.
 *
 * The ceiling bounds how many avatar requests a wide window can ask for — the
 * pool is already in memory, but each extra face is an image.
 */
const MIN_SUGGESTED_USERS = 4;
const MAX_SUGGESTED_USERS = 12;
/** Fallback for the first measurement only; mirrors `.knowCard` width in CSS. */
const SUGGESTED_CARD_WIDTH_PX = 88;

/**
 * "Discover communities" has the opposite failure to the row above it. Its
 * cards are `flex: 1 1 0`, so two of them always fill the width and there is
 * never a gap — they just get narrower, and the stylesheet pinned the count at
 * two regardless. In the ~890-1024px range, where the sidebar has appeared but
 * the window is still small, that left each card about 120px wide: the avatar,
 * then a name and member count both ellipsed away to "Y." and "2...".
 *
 * So the measurement here is against the narrowest a card may be rather than a
 * fixed width. 170px is where the name and count stop being truncated, and it
 * happens to reproduce the old hand-placed 360px breakpoint exactly — below
 * that, one card; above it, two — so phones see no change at all.
 */
const MIN_COMMUNITY_CARD_WIDTH_PX = 170;
const MAX_COMMUNITY_CARDS = 4;

const CampusCommunityItem = memo(function CampusCommunityItem({ comm, onSelect }) {
  const [imgError, setImgError] = useState(false);
  const avatarUrl = resolveCommunityAvatar(comm);
  const initial = comm?.name ? comm.name.charAt(0).toUpperCase() : '';
  const count = comm?.memberCount ?? comm?.membersCount ?? (Array.isArray(comm?.members) ? comm.members.length : (typeof comm?.members === 'number' ? comm.members : 1));

  const handleClick = useCallback(() => onSelect(comm.id), [onSelect, comm.id]);
  const handleImgError = useCallback(() => setImgError(true), []);

  return (
    <div className={styles.communityCardItem} onClick={handleClick}>
      <div
        className={styles.communityAvatarWrapper}
        style={{ background: (!avatarUrl || imgError) ? (comm.color || 'var(--color-primary, #8f0c13)') : 'var(--color-bg-white)' }}
      >
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={comm.name}
            className={styles.communityAvatarImg}
            width={52}
            height={52}
            loading="lazy"
            decoding="async"
            onError={handleImgError}
          />
        ) : (
          <span className={styles.communityAvatarLetter}>{initial}</span>
        )}
      </div>
      <div className={styles.communityInfo}>
        <h4 className={styles.communityCardName} title={comm.name}>
          {comm.name}
        </h4>
        <span className={styles.communityCardSubtitle}>
          {count} {count === 1 ? 'member' : 'members'}
        </span>
      </div>
    </div>
  );
});

/**
 * Returns `[count, ref]` — how many cards of at least `itemWidth` fit across
 * the element `ref` is attached to, capped at `max`. `min` is only a floor
 * where the row can scroll; where it clips, the true fit wins even if that is
 * fewer. When `itemSelector` matches a card already on screen its measured
 * width is used instead — for a fixed-width card that beats any constant, and
 * it keeps the number from living in both the stylesheet and here.
 *
 * Both rows this serves were previously sized by hand-placed breakpoints, and
 * both got it wrong: one left a gap it had rules to fill but no cards to fill
 * it with, the other crushed its cards rather than dropping one. Measuring the
 * container replaces all of it — the count is whatever actually fits, at any
 * width, in either orientation, with no breakpoint to keep in sync.
 *
 * The gap is read back from the DOM too, because it is a `clamp()` that changes
 * with the viewport.
 */
function useFittingCount({ min, max, itemWidth, itemSelector, signal }) {
  const [count, setCount] = useState(min);
  // A callback ref, not a ref object: the communities row only exists once
  // there are communities to put in it, and an effect keyed on `ref.current`
  // would never re-run when that container finally mounted — the row would be
  // stuck at its initial count for the life of the page. The state setter is
  // stable, so using it as the ref costs no extra renders.
  const [node, setNode] = useState(null);

  // Layout effect, not effect: this runs before paint, so the row is drawn once
  // at its real length instead of flashing four faces and then growing.
  useLayoutEffect(() => {
    if (!node) return undefined;

    let frame = 0;

    const measure = () => {
      frame = 0;
      const style = getComputedStyle(node);
      const inner =
        node.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      if (inner <= 0) return;

      const gap = parseFloat(style.columnGap) || 0;
      const rendered = itemSelector ? node.querySelector(itemSelector) : null;
      const unit = rendered?.getBoundingClientRect().width || itemWidth;
      if (unit <= 0) return;

      // n cards need n widths and n-1 gaps, so the row fits
      // floor((inner + gap) / (unit + gap)) of them.
      const fits = Math.floor((inner + gap) / (unit + gap));

      // The floor is only allowed to overflow the row where the overflow is
      // reachable. When the row clips instead of scrolling, one card is still
      // better than a row of halves.
      const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll';
      const floor = scrolls ? min : 1;
      const next = Math.max(floor, Math.min(max, fits));
      // Only a change in the *count* is a render. A drag-resize crosses
      // hundreds of pixels and perhaps two card boundaries.
      setCount((prev) => (prev === next ? prev : next));
    };

    measure();

    // ResizeObserver fires once per frame while dragging, and the callback
    // reads layout — coalescing to one read per frame keeps that off the
    // critical path and avoids interleaving reads with React's writes.
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  // `signal` re-measures when the row's contents arrive: until the first card
  // exists there is nothing for `itemSelector` to measure and the constant is
  // standing in for it.
  }, [node, min, max, itemWidth, itemSelector, signal]);

  return [count, setNode];
}

const SuggestedUserCard = memo(function SuggestedUserCard({ user, onSelect }) {
  const handleClick = useCallback(() => onSelect(user.username), [onSelect, user.username]);
  return (
    <div className={styles.knowCard} data-know-card onClick={handleClick} style={{ cursor: 'pointer' }}>
      <Avatar
        src={user.avatar}
        name={user.displayName || user.username}
        size="88px"
      />
      <span className={styles.knowName}>{user.displayName}</span>
    </div>
  );
});

export default function CampusPage() {
  const navigate = useNavigate();
  const { currentUser, collegeName: authCollegeName } = useAuth();
  const isCampusRep = Boolean(currentUser?.isCampusRep);
  // Every section below sits behind <VerificationGate>, but the hooks run
  // whether or not the gate lets its children render. useCampusUsers,
  // useCampusEvents and useCampusCommunities each own that decision; only the
  // activities feed had no gate of its own and loaded behind the locked page.
  const isVerified = useIsVerified();

  const { campusUsers } = useCampusUsers(50);
  const { campusCommunities } = useCampusCommunities();

  // Lightweight discovery surface: only upcoming events here. The full
  // Upcoming/Ongoing/Past breakdown lives on the dedicated /campus/events page.
  const upcoming = useCampusEvents('upcoming');
  const deleteEvent = useDeleteCampusEvent();

  // College-scoped crew activities. The `campus` scope is resolved entirely by
  // the server from the caller's own college — this page never filters by
  // college itself, so there is nothing here for a client to bypass. Activities
  // set to "Anyone" belong to the Crew All section and "Private" ones appear in
  // no discovery surface at all, which is why neither reaches this list.
  //
  // The section paints four cards, so it asks for four. It used to pull a full
  // twenty-row page — with every activity's members, participants and cover —
  // and throw sixteen of them away. "See all" leads to /crew?tab=college, a
  // different scope with its own cache entry, so nothing downstream was relying
  // on the discarded rows.
  const campusActivities = useActivities('campus', {
    enabled: isVerified,
    limit: ACTIVITY_PREVIEW_COUNT,
  });
  const campusActivityItems = useMemo(
    () => (campusActivities.activities || []).map(mapActivity).filter(Boolean).slice(0, ACTIVITY_PREVIEW_COUNT),
    [campusActivities.activities],
  );

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [eventFormState, setEventFormState] = useState(null); // null | { event? }
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isPlusMenuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsPlusMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsPlusMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPlusMenuOpen]);

  const collegeName = authCollegeName;

  // A fresh set of faces on every visit rather than the same head of the list.
  // The seed is fixed for the lifetime of the page, so a background refetch of
  // campusUsers reshuffles nothing under the user's cursor.
  const shuffleSeed = useRef(Math.floor(Math.random() * 2 ** 32));

  // How many of them the row has room for, remeasured on resize and rotation.
  const [visibleSuggestedCount, knowListRef] = useFittingCount({
    min: MIN_SUGGESTED_USERS,
    max: MAX_SUGGESTED_USERS,
    itemWidth: SUGGESTED_CARD_WIDTH_PX,
    itemSelector: '[data-know-card]',
    signal: campusUsers.length,
  });

  // Same treatment for the communities row. No `itemSelector` here: those cards
  // are `flex: 1 1 0`, so measuring one back would report the width it was
  // stretched to, not the width it needs — the answer would depend on the
  // question. The minimum is the input instead.
  const [visibleCommunityCount, communityListRef] = useFittingCount({
    min: 1,
    max: MAX_COMMUNITY_CARDS,
    itemWidth: MIN_COMMUNITY_CARD_WIDTH_PX,
    signal: campusCommunities.length,
  });

  // Keyed on the id alone: `currentUser` is replaced wholesale by every auth
  // refresh and presence update, and depending on the object re-ran the shuffle
  // (and rebuilt all four avatar subtrees) each time it did.
  const currentUserId = currentUser?.id;

  const suggestedUsers = useMemo(() => {
    const pool = (campusUsers || []).filter(u => u.id !== currentUserId);
    // mulberry32 — a tiny deterministic PRNG so the order is stable per mount.
    let seed = shuffleSeed.current;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Partial Fisher-Yates: only the first few slots are ever painted, so the
    // tail of a 50-user pool never needs to be shuffled.
    //
    // Shuffled to the maximum rather than to the count actually on screen, so
    // this does not depend on the measured width. Widening the window appends
    // the next faces instead of reshuffling the ones already under the reader's
    // eyes — and dragging a desktop window does not deal a new hand per frame.
    const wanted = Math.min(MAX_SUGGESTED_USERS, pool.length);
    for (let i = 0; i < wanted; i++) {
      const j = i + Math.floor(rand() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, MAX_SUGGESTED_USERS);
  }, [campusUsers, currentUserId]);

  const visibleSuggestedUsers = useMemo(
    () => suggestedUsers.slice(0, visibleSuggestedCount),
    [suggestedUsers, visibleSuggestedCount],
  );

  const openCommunity = useCallback((id) => {
    navigate(`/communities/${id}`, { state: { from: '/campus' } });
  }, [navigate]);

  const openProfile = useCallback((username) => {
    navigate(`/profile/${username}`, { state: { from: '/campus' } });
  }, [navigate]);

  const openActivity = useCallback((id) => {
    navigate(`/crew/${id}`, { state: { from: '/campus' } });
  }, [navigate]);

  const openGroupModal = useCallback(() => setIsGroupModalOpen(true), []);
  const closeGroupModal = useCallback(() => setIsGroupModalOpen(false), []);
  const closeEventForm = useCallback(() => setEventFormState(null), []);
  const editEvent = useCallback((ev) => setEventFormState({ event: ev }), []);

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

  const clearDeleteCandidate = useCallback(() => setDeleteCandidate(null), []);

  const hasUpcoming = upcoming.events.length > 0;
  const hasCommunities = campusCommunities.length > 0;

  const visibleCommunities = useMemo(
    () => campusCommunities.slice(0, visibleCommunityCount),
    [campusCommunities, visibleCommunityCount],
  );

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      <VerificationGate message="Verify your student ID to access the campus directory, events, and communities." fullPage>
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
              aria-expanded={isPlusMenuOpen}
              aria-haspopup="menu"
            >
              <Plus size={20} />
            </button>

            {isPlusMenuOpen && (
              <div className={styles.plusDropdownMenu} role="menu">
                {isCampusRep && (
                  <button
                    className={styles.plusMenuItem}
                    role="menuitem"
                    onClick={() => { setIsPlusMenuOpen(false); setEventFormState({}); }}
                  >
                    <CalendarPlus size={18} className={styles.plusMenuIcon} />
                    <span>Create event</span>
                  </button>
                )}
                <button
                  className={styles.plusMenuItem}
                  role="menuitem"
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
            {hasUpcoming && (
              <button
                className={styles.sectionArrowBtn}
                onClick={() => navigate('/campus/events')}
                aria-label="See all campus events"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>

          <CampusEventSection
            scope="upcoming"
            showCount={false}
            /* The only event section on this page, and the first content under
               the header — its lead poster is the mobile LCP element. */
            eagerFirstPoster
            events={upcoming.events}
            isLoading={upcoming.isLoading}
            emptyText="No events yet."
            canManage={isCampusRep}
            onEdit={editEvent}
            onDelete={setDeleteCandidate}
            hasNextPage={upcoming.hasNextPage}
            isFetchingNextPage={upcoming.isFetchingNextPage}
            fetchNextPage={upcoming.fetchNextPage}
          />
        </section>

        {/* Campus activities — the college-only crew activities of this campus. */}
        <section className={styles.section}>
          <div className={styles.sectionHeaderRow} style={{ justifyContent: 'space-between' }}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🎉</span>
              <h2 className={styles.sectionTitleText}>campus activities</h2>
            </div>
            {campusActivityItems.length > 0 && (
              <button
                className={styles.sectionArrowBtn}
                onClick={() => navigate('/crew?tab=college')}
                aria-label="See all campus activities"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>

          {campusActivities.isLoading && campusActivityItems.length === 0 ? (
            <>
              <CrewCardSkeleton />
              <CrewCardSkeleton />
            </>
          ) : campusActivityItems.length === 0 ? (
            <div className={eventStyles.emptyState}>
              <p className={eventStyles.emptyText}>
                No activities yet.
              </p>
            </div>
          ) : (
            campusActivityItems.map(activity => (
              <CrewCard
                key={activity.id}
                activity={activity}
                onClick={openActivity}
              />
            ))
          )}
        </section>

        {/* Wrapper for Side by Side Sections on Desktop */}
        <div className={styles.sideBySideDesktop}>
          {/* you may know */}
          <section className={`${styles.section} ${styles.sideSection}`}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🤩</span>
              <h2 className={styles.sectionTitleText}>you may know</h2>
            </div>
            <div className={styles.knowListContainer} ref={knowListRef}>
              {visibleSuggestedUsers.map(user => (
                <SuggestedUserCard key={user.id} user={user} onSelect={openProfile} />
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
          <section className={`${styles.section} ${styles.sideSection}`}>
            <div className={styles.sectionHeaderRow} style={{ justifyContent: 'space-between' }}>
              <div className={styles.sectionHeaderRow}>
                <span className={styles.sectionEmoji}>🫧</span>
                <h2 className={styles.sectionTitleText}>discover communities</h2>
              </div>
              {hasCommunities && (
                <button
                  className={styles.sectionArrowBtn}
                  onClick={() => navigate('/campus/communities')}
                  aria-label="See all campus communities"
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
            {hasCommunities && (
              <div className={styles.communitiesSectionWrapper}>
                <div className={styles.communitiesScrollContainer} ref={communityListRef}>
                  {visibleCommunities.map(comm => (
                    <CampusCommunityItem
                      key={comm.id}
                      comm={comm}
                      onSelect={openCommunity}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className={styles.discoverGroupsCard} onClick={openGroupModal}>
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
          <Suspense fallback={null}>
            <CreateCommunityModal
              onClose={closeGroupModal}
              onCreated={openCommunity}
              isCampusCommunity={true}
            />
          </Suspense>
        )}
      </VerificationGate>

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
    </main>
  );
}
