/**
 * The invite picker for an activity, used both on the activity page and right
 * after one is created.
 *
 * It is the share sheet's frame (bottom sheet on phones, centred dialog on
 * desktop; the same handle, header, search and avatar grid, styled by
 * ShareSheet.module.css) with a different job: pick people, then one Invite
 * button. There is no app row and no copy-link, since an invite goes to a
 * person, not out of the app.
 *
 * Who can be picked is the viewer's following list plus their one-to-one chats
 * (see useInvitablePeople). When `activityId` is given, people already in the
 * activity, already invited, or in the decline cool-down are shown but cannot
 * be selected; that status is host-only information, so the picker waits for
 * it rather than let someone be picked on a guess.
 */
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { activitiesApi } from '@shared/api/apiClient';
import ShareModalAvatar, { isGroupTarget } from '@shared/components/avatar/ShareModalAvatar';
import { Check } from '@shared/components/icons';
import { useInvitablePeople } from '@shared/hooks/useInvitablePeople';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import styles from '../share/ShareSheet.module.css';

/** What to show under a person who cannot be picked, by invitation status. */
const UNAVAILABLE_LABEL = {
  MEMBER: 'Joined',
  PENDING: 'Invited',
  COOLDOWN: 'Declined',
};

/**
 * @param {string} [props.activityId] Omit for an activity that is still being
 *   created: nobody is in it yet but the host.
 * @param {(userIds: string[]) => Promise<unknown>} props.onSendInvites Rejects
 *   when the invitations could not be sent; the sheet then stays open with the
 *   selection intact.
 * @param {() => void} props.onClose
 */
export default function InviteFriendsModal({ activityId, onSendInvites, onClose }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  const people = useInvitablePeople(search);
  const statuses = useQuery({
    queryKey: ['activity-invitation-statuses', activityId],
    queryFn: () => activitiesApi.getInvitationStatuses(activityId),
    enabled: Boolean(activityId),
    // Re-read on every opening: someone may have joined since the last one.
    staleTime: 0,
  });

  // Closing while the invitations are going out would drop the result.
  const close = useCallback(() => {
    if (!inFlight.current) onClose();
  }, [onClose]);
  useOverlayBack(true, close);
  useScrollLock(true);
  const sheetRef = useSheetDrag(close);

  const statusOf = (id) => {
    const entry = statuses.data?.[id];
    return typeof entry === 'string' ? entry : entry?.status;
  };
  const isUnavailable = (id) => Boolean(UNAVAILABLE_LABEL[statusOf(id)]);
  const statusUnknown = Boolean(activityId) && (statuses.isPending || statuses.isError);

  // A status can arrive after someone was picked; they drop out of the pick.
  const picked = selected.filter((id) => !isUnavailable(id));

  const toggle = (id) => {
    setFailed(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const send = async () => {
    if (inFlight.current || picked.length === 0) return;
    inFlight.current = true;
    setSending(true);
    setFailed(false);
    try {
      await onSendInvites(picked);
      inFlight.current = false;
      onClose();
    } catch {
      inFlight.current = false;
      setSending(false);
      setFailed(true);
      if (activityId) statuses.refetch();
    }
  };

  const term = search.trim();

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
          <div className={styles.headerRow}>
            <h2 id="invite-sheet-title" className={styles.title}>Invite friends</h2>
            <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <label className={styles.search}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.5" y2="16.5" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              aria-label="Search people"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <div className={styles.grid} role="listbox" aria-multiselectable="true" aria-label="Invite">
            {people.people.map((user) => {
              const isPicked = picked.includes(user.id);
              const blocked = isUnavailable(user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={isPicked}
                  className={`${styles.person} ${isPicked ? styles.picked : ''} ${blocked ? styles.personDisabled : ''}`}
                  disabled={blocked || statusUnknown || sending}
                  onClick={() => toggle(user.id)}
                >
                  <span className={`${styles.avatarWrap} ${isGroupTarget(user) ? styles.avatarWrapGroup : ''}`}>
                    <ShareModalAvatar conv={user} size="60px" />
                    {isPicked && (
                      <span className={styles.check} aria-hidden="true">
                        <Check size={13} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className={styles.personName}>{user.displayName || user.username}</span>
                  {blocked && <span className={styles.personState}>{UNAVAILABLE_LABEL[statusOf(user.id)]}</span>}
                </button>
              );
            })}

            {people.isLoading && <p className={styles.empty} role="status">Loading…</p>}
            {people.isError && (
              <p className={styles.empty} role="alert">
                Couldn’t load people.{' '}
                <button type="button" className={styles.linkBtn} onClick={() => people.refetch()}>Retry</button>
              </p>
            )}
            {!people.isLoading && !people.isError && people.people.length === 0 && (
              <p className={styles.empty}>{term ? 'No matching people.' : 'People you follow or chat with appear here.'}</p>
            )}
            {people.hasMore && (
              <button
                type="button"
                className={`${styles.linkBtn} ${styles.more}`}
                disabled={people.isLoadingMore}
                onClick={() => people.loadMore()}
              >
                {people.isLoadingMore ? 'Loading…' : 'Show more'}
              </button>
            )}
          </div>

          {(picked.length > 0 || failed || (activityId && statuses.isError)) && (
            <div className={styles.footer}>
              {activityId && statuses.isError && (
                <p className={styles.notice} role="alert">
                  Couldn’t check who is already in.{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => statuses.refetch()}>Retry</button>
                </p>
              )}
              {failed && <p className={styles.notice} role="alert">Couldn’t send the invitations. Try again.</p>}
              {picked.length > 0 && (
                <button type="button" className={styles.sendBtn} onClick={send} disabled={sending}>
                  {sending ? 'Inviting…' : picked.length === 1 ? 'Invite' : `Invite ${picked.length}`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
