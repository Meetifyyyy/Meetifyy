import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { useDebounce } from '@shared/hooks/useDebounce';
import { selectableUsers } from '@shared/lib/conversationTargets';
import { useAuth } from '@shared/context/AuthContext';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import styles from './NewMessageModal.module.css';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import { filterCompatibleUsers } from '@shared/lib/studentYearPolicy';

const RECENT_LIMIT = 10;
const GROUP_NAME_MAX = 120;

const nameOf = (u) => u?.displayName || u?.name || u?.username || '';
const firstName = (u) => nameOf(u).split(/\s+/)[0];

function UserAvatar({ user, className }) {
  return (
    <span className={className}>
      {isImageUrl(user.avatar) ? (
        <img
          src={getProcessedAvatarUrl(user.avatar)}
          alt=""
          className={styles.avatarImg}
          onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.svg'; }}
        />
      ) : (
        <DefaultAvatar />
      )}
    </span>
  );
}

function SelectMark({ selected }) {
  return (
    <span className={`${styles.selectMark} ${selected ? styles.selectMarkOn : ''}`} aria-hidden="true">
      {selected && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}

/**
 * "New message": pick one person to open a chat, or several to start a group.
 *
 * Layout follows the Instagram DM sheet: search on top, a strip of people the
 * viewer already knows, the full list with round select marks, and a sticky
 * action bar once anyone is picked. Picking one offers "Chat with …"; picking
 * more turns it into "Create group", which asks for a name as a second step.
 *
 * Phones get a bottom sheet you can drag down to dismiss; desktop gets a
 * centred panel.
 */
export default function NewMessageModal({ onClose, onStartChat, onCreateGroup }) {
  // Rendered only while open, so `true` is the open state.
  useOverlayBack(true, onClose);
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(true);

  // Phones: drag the sheet down to dismiss.
  const sheetRef = useSheetDrag(onClose);

  const { currentUser } = useAuth();
  const users = useUsersMap();
  const [searchQuery, setSearchQuery] = useState('');
  // One request per pause in typing rather than one per keystroke.
  const debouncedQuery = useDebounce(searchQuery.trim(), 250);

  const [step, setStep] = useState('pick'); // 'pick' | 'name'
  // Objects, not ids, so the action bar and chips can show who is picked
  // even after a new search has replaced the rows they were picked from.
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const searchRef = useRef(null);
  const nameRef = useRef(null);

  /**
   * The recipient list, ASKED OF THE SERVER.
   *
   * Typing used to filter a small preloaded map in JavaScript, so anyone
   * outside those few dozen rows could not be found. `/api/users/connections`
   * is the recipient picker's source for every Share and Invite surface and
   * applies -- in the QUERY -- the block filter, the verification filter and
   * first-year isolation, so the rules cannot drift between pickers and a
   * restricted account is never in the payload to begin with.
   */
  const { data: searchedUsers = [], isFetching } = useQuery({
    queryKey: ['new-message-recipients', debouncedQuery],
    queryFn: () => usersApi.getConnections(debouncedQuery, 50).catch(() => []),
    enabled: Boolean(currentUser?.id),
    staleTime: 30_000,
    // Keeps the previous term's rows on screen while the next request is in
    // flight, so the list does not blink empty between keystrokes.
    placeholderData: keepPreviousData,
  });

  // Picker rules as a SECOND line, for rows still sitting in the React Query
  // cache from before the viewer's batch resolved. A no-op when the payload
  // lacks the flag, so it can only remove a row the server would also remove;
  // `startDM` and the group create refuse a restricted recipient regardless.
  const eligible = useCallback(
    (list) =>
      filterCompatibleUsers(currentUser, selectableUsers(list)).filter(
        (u) => String(u.id) !== String(currentUser?.id) && u.username !== currentUser?.username,
      ),
    [currentUser],
  );

  const filteredUsers = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const matchesLocally = (u) =>
      !needle ||
      u?.name?.toLowerCase().includes(needle) ||
      u?.displayName?.toLowerCase().includes(needle) ||
      u?.username?.toLowerCase().includes(needle);

    // Server rows first, so an account the viewer has never spoken to is
    // reachable, then the locally-known people. Deduped by id.
    const merged = [];
    const seen = new Set();
    const push = (u) => {
      if (!u?.id) return;
      const key = String(u.id);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(u);
    };
    (Array.isArray(searchedUsers) ? searchedUsers : []).forEach(push);
    Object.values(users || {}).filter(matchesLocally).forEach(push);
    return eligible(merged);
  }, [searchedUsers, users, searchQuery, eligible]);

  // People the viewer already knows (open threads, campus), for the strip.
  const recentUsers = useMemo(
    () => eligible(Object.values(users || {}).filter((u) => u?.id)).slice(0, RECENT_LIMIT),
    [users, eligible],
  );

  const selectedIds = useMemo(() => new Set(selected.map((u) => String(u.id))), [selected]);

  const toggle = (user) => {
    setSelected((prev) =>
      prev.some((u) => String(u.id) === String(user.id))
        ? prev.filter((u) => String(u.id) !== String(user.id))
        : [...prev, user],
    );
  };

  const goBack = useCallback(() => {
    setStep('pick');
    setCreateError('');
  }, []);

  const handlePrimary = () => {
    if (selected.length === 1) onStartChat(selected[0]);
    else if (selected.length > 1) setStep('name');
  };

  const trimmedName = groupName.trim();
  const handleCreate = async (e) => {
    e?.preventDefault();
    if (!trimmedName || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      await onCreateGroup(trimmedName, selected.map((u) => u.id));
    } catch (err) {
      setCreateError(err?.message || "Couldn't create the group. Try again.");
    } finally {
      setCreating(false);
    }
  };

  // Focus: the search on desktop when it opens (on phones that would throw up
  // the keyboard over the list), the name field on the name step, and back to
  // whatever opened the dialog when it closes.
  useEffect(() => {
    const opener = document.activeElement;
    if (window.matchMedia?.('(min-width: 769px)').matches) searchRef.current?.focus();
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (step === 'name') nameRef.current?.focus();
  }, [step]);

  // Escape steps back from the name step before it closes the dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (step === 'name') goBack();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, goBack, onClose]);

  const searching = Boolean(searchQuery.trim());
  const primaryLabel =
    selected.length === 1 ? `Chat with ${firstName(selected[0])}` : `Create group · ${selected.length}`;

  return (
    <div className={styles.overlay} data-scroll-lock-ignore onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-message-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
          <div className={styles.headerRow}>
            {step === 'name' ? (
              <button type="button" className={styles.iconBtn} onClick={goBack} aria-label="Back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            ) : (
              <span className={styles.iconSpacer} aria-hidden="true" />
            )}
            <h2 id="new-message-title" className={styles.title}>
              {step === 'name' ? 'Name your group' : 'New message'}
            </h2>
            <button type="button" className={`${styles.iconBtn} ${styles.closeBtnDesktop}`} onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {step === 'pick' ? (
          <>
            <div className={styles.searchBar}>
              <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="20" y1="20" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                className={styles.searchInput}
                placeholder="Search..."
                aria-label="Search people"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {searchQuery && (
                <button type="button" className={styles.clearBtn} onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }} aria-label="Clear search">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            <div className={styles.scroller}>
              {!searching && recentUsers.length > 0 && (
                <section aria-label="Recent">
                  <h3 className={styles.sectionLabel}>Recent</h3>
                  <div className={styles.recentStrip}>
                    {recentUsers.map((user) => {
                      const on = selectedIds.has(String(user.id));
                      return (
                        <button
                          key={`recent-${user.id}`}
                          type="button"
                          className={`${styles.recentItem} ${on ? styles.recentItemOn : ''}`}
                          onClick={() => toggle(user)}
                          aria-pressed={on}
                          aria-label={nameOf(user)}
                        >
                          <span className={styles.recentAvatarWrap}>
                            <UserAvatar user={user} className={styles.recentAvatar} />
                            {on && <span className={styles.recentCheck}><SelectMark selected /></span>}
                          </span>
                          <span className={styles.recentName}>{firstName(user)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section aria-label={searching ? 'Search results' : 'All people'}>
                <h3 className={styles.sectionLabel}>{searching ? 'Results' : 'All people'}</h3>
                {filteredUsers.length === 0 ? (
                  <div className={styles.empty}>
                    {isFetching ? (
                      <div className="spinner" aria-label="Searching" />
                    ) : (
                      <p>
                        {searching
                          ? `No accounts found matching "${searchQuery.trim()}".`
                          : 'No accounts available to message right now.'}
                      </p>
                    )}
                  </div>
                ) : (
                  <ul className={styles.list}>
                    {filteredUsers.map((user, i) => {
                      const on = selectedIds.has(String(user.id));
                      return (
                        <li key={user.id || i}>
                          <button
                            type="button"
                            className={`${styles.userItem} ${on ? styles.userItemOn : ''}`}
                            onClick={() => toggle(user)}
                            aria-pressed={on}
                          >
                            <UserAvatar user={user} className={styles.userAvatar} />
                            <span className={styles.userInfo}>
                              <span className={styles.userName}>{nameOf(user)}</span>
                              <span className={styles.userUsername}>@{user.username}</span>
                            </span>
                            <SelectMark selected={on} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            <div className={`${styles.actionBar} ${selected.length ? styles.actionBarShown : ''}`} aria-hidden={!selected.length}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handlePrimary}
                disabled={!selected.length}
                tabIndex={selected.length ? 0 : -1}
              >
                {selected.length ? primaryLabel : 'Chat'}
              </button>
            </div>
          </>
        ) : (
          <form className={styles.nameStep} onSubmit={handleCreate}>
            <div className={styles.memberStack} aria-label={`${selected.length} members`}>
              {selected.slice(0, 5).map((user) => (
                <UserAvatar key={`stack-${user.id}`} user={user} className={styles.stackAvatar} />
              ))}
              {selected.length > 5 && <span className={styles.stackMore}>+{selected.length - 5}</span>}
            </div>
            <p className={styles.memberNames}>
              {selected.map(firstName).slice(0, 3).join(', ')}
              {selected.length > 3 ? ` and ${selected.length - 3} more` : ''}
            </p>

            <label className={styles.nameLabel} htmlFor="new-group-name">Group name</label>
            <input
              ref={nameRef}
              id="new-group-name"
              type="text"
              className={styles.nameInput}
              placeholder="E.g., Weekend Hike"
              value={groupName}
              maxLength={GROUP_NAME_MAX}
              onChange={(e) => { setGroupName(e.target.value); setCreateError(''); }}
              aria-invalid={Boolean(createError)}
              aria-describedby="new-group-name-hint"
            />
            <div id="new-group-name-hint" className={styles.nameHint}>
              {createError ? (
                <span className={styles.nameError} role="alert">{createError}</span>
              ) : (
                <span>{groupName.length}/{GROUP_NAME_MAX}</span>
              )}
            </div>

            <button type="submit" className={styles.primaryBtn} disabled={!trimmedName || creating}>
              {creating ? 'Creating…' : 'Create group'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
