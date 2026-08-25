import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldOff, Search } from '@shared/components/icons';
import { apiClient } from '@shared/api/apiClient';
import BlockedContactRow from './BlockedContactRow';
import UnblockConfirmDialog from './UnblockConfirmDialog';
import styles from './BlockedContacts.module.css';

const PAGE_SIZE = 20;

/** Matches the row-removal transition in BlockedContacts.module.css. */
const REMOVE_ANIMATION_MS = 220;

/**
 * Settings -> Privacy -> Blocked Contacts.
 *
 * Shows only the current user's own blocked list. The endpoint takes its
 * subject from the JWT and has no userId parameter, so there is no request this
 * screen could make for somebody else's list.
 *
 * Always fetched fresh on mount — a stale block list is worse than a slow one,
 * since it would offer Unblock for a block that is already gone.
 */
export default function BlockedContacts() {
  const [contacts, setContacts] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  const [pendingUnblock, setPendingUnblock] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  // Guards against a late response from an unmounted screen overwriting state.
  const isMounted = useRef(true);
  useEffect(() => {
    // Set on mount as well as cleared on unmount. Clearing only on cleanup
    // breaks under StrictMode's double-invoke in development: the first
    // simulated unmount latches this false, the real mount never restores it,
    // and every state guard below silently drops its update — leaving the
    // screen on "Loading..." forever even though the request had returned.
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const loadPage = useCallback(async (offset) => {
    const res = await apiClient.get(
      `/api/settings/blocked-contacts?limit=${PAGE_SIZE}&offset=${offset}`,
    );
    return {
      contacts: res?.contacts ?? [],
      hasMore: Boolean(res?.hasMore),
      nextOffset: res?.nextOffset ?? null,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const page = await loadPage(0);
        if (cancelled || !isMounted.current) return;
        setContacts(page.contacts);
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset ?? PAGE_SIZE);
      } catch (err) {
        if (cancelled || !isMounted.current) return;
        setError(err?.message || "Couldn't load your blocked contacts");
      } finally {
        if (!cancelled && isMounted.current) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadPage]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const page = await loadPage(nextOffset);
      if (!isMounted.current) return;
      // De-duplicate on id: a concurrent unblock can shift the offset window
      // and re-serve a row that is already on screen.
      setContacts((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.contacts.filter((c) => !seen.has(c.id))];
      });
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset ?? nextOffset + PAGE_SIZE);
    } catch (err) {
      if (isMounted.current) setError(err?.message || "Couldn't load more");
    } finally {
      if (isMounted.current) setIsLoadingMore(false);
    }
  };

  const handleConfirmUnblock = async () => {
    if (!pendingUnblock) return;
    const target = pendingUnblock;
    setIsSubmitting(true);
    try {
      await apiClient.delete(`/api/blocks/${target.id}`);
      if (!isMounted.current) return;

      setPendingUnblock(null);
      setIsSubmitting(false);

      // Play the exit transition, then drop the row. Deliberately no success
      // toast: this screen can be open in public, and "X unblocked" is exactly
      // the kind of thing a bystander should not read off a shoulder.
      setRemovingId(target.id);
      setTimeout(() => {
        if (!isMounted.current) return;
        setContacts((prev) => prev.filter((c) => c.id !== target.id));
        setRemovingId(null);
      }, REMOVE_ANIMATION_MS);
    } catch (err) {
      if (!isMounted.current) return;
      setIsSubmitting(false);
      setPendingUnblock(null);
      setError(err?.message || "Couldn't unblock this contact");
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleContacts = normalizedQuery
    ? contacts.filter((c) => {
        const name = (c.isDeleted ? 'Deleted Account' : c.displayName || '').toLowerCase();
        const handle = (c.username || '').toLowerCase();
        return name.includes(normalizedQuery) || handle.includes(normalizedQuery);
      })
    : contacts;

  if (isLoading) {
    return (
      <div className={`${styles.panel} animate-in`}>
        <div className={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div className={`${styles.panel} animate-in`}>
      {error && <div className={styles.error}>{error}</div>}

      {contacts.length === 0 ? (
        <div className={styles.empty}>
          <ShieldOff size={44} className={styles.emptyIcon} aria-hidden="true" />
          <p className={styles.emptyText}>You haven't blocked anyone.</p>
        </div>
      ) : (
        <>
          {/* Filters what is already loaded — enough for a list this size, and
              it avoids a request per keystroke. */}
          {contacts.length > 5 && (
            <div className={styles.searchWrap}>
              <Search size={16} className={styles.searchIcon} aria-hidden="true" />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search blocked contacts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search blocked contacts"
              />
            </div>
          )}

          <div className={styles.list}>
            {visibleContacts.map((contact) => (
              <BlockedContactRow
                key={contact.id}
                contact={contact}
                onUnblock={setPendingUnblock}
                isRemoving={removingId === contact.id}
              />
            ))}
          </div>

          {normalizedQuery && visibleContacts.length === 0 && (
            <p className={styles.noMatches}>No contacts match "{query}".</p>
          )}

          {hasMore && !normalizedQuery && (
            <button
              type="button"
              className={styles.loadMoreBtn}
              onClick={handleLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      <UnblockConfirmDialog
        contact={pendingUnblock}
        isSubmitting={isSubmitting}
        onConfirm={handleConfirmUnblock}
        onCancel={() => setPendingUnblock(null)}
      />
    </div>
  );
}
