/**
 * Inviting people to a group, from the group's details.
 *
 * The share sheet's frame and look (bottom sheet on phones, centred dialog on
 * desktop; the same handle, search, avatar grid and footer, styled by
 * ShareSheet.module.css): tap to pick any number of people, then one button.
 * What it sends and to whom are the invite's own rules:
 *
 * - Who is offered: the viewer's connections (`/api/users/connections`, ranked
 *   by closeness, searched in the database before its limit, verified and
 *   unblocked only), so someone with no chat yet can be invited. Never the
 *   viewer, never a current member.
 * - One request per person (`POST /api/dm/invite`): the server finds or opens
 *   the chat and builds the card from the group itself. Each person's client
 *   id is fixed for this opening, so a retry returns the invite already sent
 *   rather than a second card, and a person once sent to is not sent again.
 * - Someone who joined in the meantime reads "In group", not a failure. A
 *   group that has ended, or that the viewer is no longer in, stops the sheet:
 *   a retry could not change either.
 * - With nobody picked, the footer offers an invite link (Copy link, Share
 *   via, …): meetifyy.app/g/<code>, which lasts seven days and an admin can
 *   reset. It used to be the group's own address, which could be neither.
 *   The server hands a member back their own link while it has a day left,
 *   so asking for it each time the sheet opens makes no new link.
 *
 * It replaces a list with an Invite button on every row, where each tap sent
 * at once and failures came back as toasts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@config';
import { dmApi, groupApi, usersApi } from '@shared/api/apiClient';
import ShareModalAvatar, { isGroupTarget } from '@shared/components/avatar/ShareModalAvatar';
import { Check } from '@shared/components/icons';
import ShareTargets from '@shared/components/share/ShareTargets';
import styles from '@shared/components/share/ShareSheet.module.css';
import { useAuth } from '@shared/context/AuthContext';
import { useDebounce } from '@shared/hooks/useDebounce';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import { selectableUsers } from '@shared/lib/conversationTargets';
import { publicOrigin } from '@shared/utils/publicOrigin';
import { newForwardOperationId } from '@features/messages/shared/utils/forwardDelivery';

/** How long the "Invited" confirmation shows before the sheet closes itself. */
const SENT_CLOSE_MS = 900;

/** Under a person's name, by how their invite went. */
const STATE_LABEL = { sent: 'Invited', member: 'In group', failed: 'Not sent' };

/** Refusals no retry can change: the sheet stops and says why. */
const STOP_REASON = {
  NOT_A_MEMBER: 'You’re no longer in this group.',
  GROUP_CLOSED: 'This group has ended.',
  GROUP_NOT_FOUND: 'This group no longer exists.',
};

function stopReason(err) {
  const code = String(err?.code || '').toUpperCase();
  return STOP_REASON[code] || STOP_REASON[String(err?.message || '')] || null;
}

/**
 * Who is in the group now: owner, admins and members, from the group details
 * (the server lists current members only) and the row the panel holds.
 *
 * Never the chat history's `participants`: that names everyone who has been
 * in the chat, removed members included, which hid exactly the people one
 * would invite back.
 */
function memberIdsOf(...sources) {
  const ids = new Set();
  const add = (value) => {
    const id = typeof value === 'string' ? value : value?.id || value?.userId || value?.user?.id;
    if (id) ids.add(String(id));
  };
  for (const source of sources) {
    if (!source) continue;
    add(source.ownerId);
    add(source.hostId);
    for (const key of ['admins', 'members', 'memberDetails']) {
      if (Array.isArray(source[key])) source[key].forEach(add);
    }
  }
  return ids;
}

/** The card an older server, without the invite route, is sent. */
function legacyInviteData(group) {
  return {
    type: 'group_invite',
    groupId: group.id,
    conversationId: group.id,
    groupName: group.name || 'Group',
    groupAvatar: group.avatar || group.avatarKey || null,
    description: group.description || '',
    whoCanJoin: group.whoCanJoin || 'ANYONE',
    memberCount: group.memberCount || group.members?.length || 1,
  };
}

export default function InviteModal({ isOpen, onClose, group }) {
  const open = Boolean(isOpen);
  useOverlayBack(open, onClose);
  useScrollLock(open);
  const sheetRef = useSheetDrag(onClose, { enabled: open });

  const { currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState([]);
  const [status, setStatus] = useState({}); // userId -> sending | sent | member | failed
  const [phase, setPhase] = useState('idle'); // idle | sending | sent | failed
  const [stopped, setStopped] = useState(null);
  // While the search field has focus the keyboard is up; the link row would
  // ride up above it and take the space the results need.
  const [searching, setSearching] = useState(false);

  /** This opening's id, the base of every invite's client id. */
  const operationRef = useRef(newForwardOperationId());
  const inFlight = useRef(false);
  const closeTimer = useRef(null);

  // The panel keeps this mounted while closed, so every opening starts clean,
  // and results still arriving from the last one are not taken for this one's.
  useEffect(() => {
    if (open) return;
    operationRef.current = newForwardOperationId();
    inFlight.current = false;
    clearTimeout(closeTimer.current);
    setSearchTerm('');
    setSelected([]);
    setStatus({});
    setPhase('idle');
    setStopped(null);
    setSearching(false);
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const groupId = group?.id || group?.publicId || group?.internalId;
  const { data: details } = useQuery({
    queryKey: ['groupDetails', groupId],
    queryFn: () => groupApi.getDetails(groupId),
    enabled: Boolean(open && groupId),
    staleTime: 10_000,
  });
  const memberIds = useMemo(() => memberIdsOf(group, details), [group, details]);
  const inviteLink = useQuery({
    queryKey: ['groupInviteLink', groupId],
    queryFn: () => groupApi.createInviteLink(groupId),
    enabled: Boolean(open && groupId),
    // Well inside the day the server keeps handing the same link back for.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // One request per pause in typing. The term is matched by the database
  // before the limit, so a name outside the first page is still found.
  const term = useDebounce(searchTerm.trim(), 250);
  const people = useQuery({
    queryKey: ['all-users-for-invite', term],
    queryFn: () => usersApi.getConnections(term, 50),
    enabled: open,
    staleTime: 30_000,
    // The previous term's rows stay while the next request is in flight, so
    // the grid does not blink empty between keystrokes.
    placeholderData: keepPreviousData,
  });

  const recipients = useMemo(
    () =>
      // `selectableUsers` drops deleted accounts a cached response may still hold.
      selectableUsers(people.data || []).filter(
        (u) => String(u.id) !== String(currentUser?.id) && !memberIds.has(String(u.id)),
      ),
    [people.data, currentUser?.id, memberIds],
  );

  const sendOne = useCallback(
    async (userId) => {
      const clientId = `inv_${operationRef.current}_${userId}`.slice(0, 128);
      try {
        await dmApi.sendGroupInvite({ targetUserId: userId, groupId, clientId });
        return 'sent';
      } catch (err) {
        if (err?.code === 'ALREADY_MEMBER') return 'member';
        // A server from before this route: the older two steps, with the chat
        // found or created on the server, under the same client id.
        if (err?.status !== 404 || stopReason(err)) throw err;
        const dm = await dmApi.startDM(userId);
        await dmApi.sendMessage(dm?.publicId || dm?.id, {
          text: '',
          clientId,
          inviteData: legacyInviteData({ ...group, id: groupId }),
        });
        return 'sent';
      }
    },
    [group, groupId],
  );

  const send = useCallback(async () => {
    if (inFlight.current || stopped || !groupId) return;
    const targets = selected.filter((id) => status[id] !== 'sent' && status[id] !== 'member');
    if (targets.length === 0) return;
    const operation = operationRef.current;
    inFlight.current = true;
    setPhase('sending');
    setStatus((prev) => ({ ...prev, ...Object.fromEntries(targets.map((id) => [id, 'sending'])) }));

    const results = await Promise.allSettled(targets.map((id) => sendOne(id)));
    if (operationRef.current !== operation) return; // closed meanwhile
    inFlight.current = false;

    const next = {};
    let stop = null;
    results.forEach((r, i) => {
      next[targets[i]] = r.status === 'fulfilled' ? r.value : 'failed';
      if (r.status === 'rejected') stop = stop || stopReason(r.reason);
    });
    setStatus((prev) => ({ ...prev, ...next }));
    // A chat may have been opened for someone: the list picks it up.
    if (results.some((r) => r.status === 'fulfilled' && r.value === 'sent')) {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
    if (stop) {
      setStopped(stop);
      setPhase('failed');
      return;
    }
    const ok = results.every((r) => r.status === 'fulfilled');
    setPhase(ok ? 'sent' : 'failed');
    if (ok) closeTimer.current = setTimeout(onClose, SENT_CLOSE_MS);
  }, [groupId, onClose, queryClient, selected, sendOne, status, stopped]);

  const toggle = useCallback((id) => {
    setPhase('idle');
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const linkCode = inviteLink.data?.code;
  const linkPayload = useMemo(() => {
    if (!group || !linkCode) return null;
    const name = group.name?.trim() || 'this group';
    return {
      url: `${publicOrigin()}/g/${encodeURIComponent(linkCode)}`,
      title: `${name} on ${config.app.name}`,
      text: `Join ${name} on ${config.app.name}.`,
    };
  }, [group, linkCode]);

  if (!open) return null;

  const close = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    onClose();
  };
  const busy = phase === 'sending';
  const failedCount = selected.filter((id) => status[id] === 'failed').length;
  // Picked and not yet through: someone already invited is not counted again.
  const pending = selected.filter((id) => status[id] !== 'sent' && status[id] !== 'member').length;
  const label = busy
    ? 'Inviting…'
    : phase === 'sent'
      ? 'Invited'
      : phase === 'failed'
        ? `Retry ${failedCount} ${failedCount === 1 ? 'invite' : 'invites'}`
        : pending <= 1
          ? 'Invite'
          : `Invite ${pending}`;

  return createPortal(
    <div className={styles.backdrop} onClick={close}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-invite-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
          <div className={styles.headerRow}>
            {/* As on the share sheet: no visible title, still announced. */}
            <h2 id="group-invite-title" className={`${styles.title} ${styles.srOnly}`}>
              {group?.name ? `Invite to ${group.name}` : 'Invite people'}
            </h2>
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
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
            />
          </label>

          <div className={styles.grid} role="listbox" aria-multiselectable="true" aria-label="Invite">
            {recipients.map((user) => {
              const picked = selected.includes(user.id);
              const state = STATE_LABEL[status[user.id]];
              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={picked}
                  className={`${styles.person} ${picked ? styles.picked : ''}`}
                  onClick={() => toggle(user.id)}
                  disabled={busy || Boolean(stopped)}
                >
                  <span className={`${styles.avatarWrap} ${isGroupTarget(user) ? styles.avatarWrapGroup : ''}`}>
                    <ShareModalAvatar conv={user} size="60px" />
                    {picked && (
                      <span className={styles.check} aria-hidden="true">
                        <Check size={13} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className={styles.personName}>{user.displayName || user.name || user.username}</span>
                  {state && (
                    <span className={`${styles.personState} ${status[user.id] === 'failed' ? styles.personFailed : ''}`}>
                      {state}
                    </span>
                  )}
                </button>
              );
            })}

            {recipients.length === 0 && (
              people.isError ? (
                <p className={styles.empty} role="alert">
                  Couldn’t load people.{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => people.refetch()}>Retry</button>
                </p>
              ) : people.isFetching ? (
                <p className={styles.empty} role="status">Searching…</p>
              ) : (
                <p className={styles.empty}>{term ? 'No matching people.' : 'No one to invite yet.'}</p>
              )
            )}
          </div>

          {(selected.length > 0 || !searching || stopped) && (
            <div className={styles.footer}>
              {stopped && <p className={styles.notice} role="alert">{stopped}</p>}
              {selected.length > 0 && !stopped ? (
                <button
                  type="button"
                  className={styles.sendBtn}
                  onClick={send}
                  disabled={busy || phase === 'sent' || pending === 0}
                >
                  {label}
                </button>
              ) : (
                !stopped && (linkPayload ? (
                  <ShareTargets payload={linkPayload} />
                ) : (
                  // Holds the row's place while the link is fetched, so the
                  // sheet does not jump when it arrives.
                  <div className={styles.linkPending} role="status">
                    {inviteLink.isError ? (
                      <>
                        <span>Couldn’t get an invite link.</span>
                        <button type="button" className={styles.linkBtn} onClick={() => inviteLink.refetch()} disabled={inviteLink.isFetching}>
                          Retry
                        </button>
                      </>
                    ) : (
                      <span>Getting the invite link…</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
