import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Search, Clock, X, RefreshCw, AlertCircle, Calendar, ArrowLeft, Loader2, Sparkles, Users, Compass, Globe2, FileText } from 'lucide-react';
import { useGlobalSearch } from '@features/search/hooks/useGlobalSearch';
import Avatar, { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { isImageUrl } from '@shared/utils/avatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import RightPanel, { NotificationsActivity, OnlineFriends, UpcomingEvents } from '@layout/RightPanel';
import FollowButton from '@shared/components/ui/FollowButton';
import { useData } from '@shared/hooks/useData';
import { useDebouncedState } from '@shared/hooks/useDebounce';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { searchApi } from '@shared/api/apiClient';
import Post from '@features/feed/components/post/Post';
import CrewCard from '@features/crew/components/cards/CrewCard';
import styles from './SearchResultsRoute.module.css';

const QUICK_CHIPS = [
  { id: 'all', label: 'All', Icon: null },
  { id: 'people', label: 'People', Icon: Users },
  { id: 'activities', label: 'Activities', Icon: Compass },
  { id: 'communities', label: 'Communities', Icon: Globe2 },
  { id: 'posts', label: 'Posts', Icon: FileText },
];

// ── Pure helpers (module scope so they're stable refs, never recreated per render) ──
const DEFAULT_COVERS = [
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1551818255-e6e10975bc17?q=80&w=800&auto=format&fit=crop',
];

function getDefaultCover(idOrTitle = '') {
  let hash = 0;
  const str = String(idOrTitle || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return DEFAULT_COVERS[Math.abs(hash) % DEFAULT_COVERS.length];
}

function formatDateTime(activity) {
  if (!activity) return '';
  const startRaw = activity.startDate || activity.date;
  if (!startRaw) {
    if (!activity.createdAt) return '';
    const postedD = new Date(activity.createdAt);
    if (isNaN(postedD.getTime())) return '';
    return `Posted ${postedD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  const startD = new Date(startRaw);
  if (isNaN(startD.getTime())) return '';
  const endRaw = activity.endDate;
  const endD = endRaw ? new Date(endRaw) : startD;
  const startDateFormatted = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const startTimeStr = activity.time || startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (endD && !isNaN(endD.getTime())) {
    const endDateFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endTimeStr = activity.endTime || endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (startDateFormatted === endDateFormatted) {
      if (startTimeStr === endTimeStr) return `${startDateFormatted} • ${startTimeStr}`;
      return `${startDateFormatted} • ${startTimeStr} – ${endTimeStr}`;
    }
    return `${startDateFormatted} • ${startTimeStr} → ${endDateFormatted} • ${endTimeStr}`;
  }
  return `${startDateFormatted} • ${startTimeStr}`;
}

// ── Memoized row components ──────────────────────────────────────────────────
// React.memo + stable props (data refs are stable between renders via the query
// cache; onOpen is a useCallback) means unchanged rows skip re-rendering entirely
// when the user types or a background refetch resolves.

const UserRow = React.memo(function UserRow({ data, onOpen }) {
  return (
    <div className={styles.resultCard} onClick={() => onOpen('user', data)}>
      <Avatar src={data.avatar} name={data.displayName} size="44px" disableHover />
      <div className={styles.feedInfo}>
        <span className={styles.feedName} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {data.displayName}
          <CollegeRepresentativeBadge isCampusRep={data.isCampusRep} user={data} size="sm" />
        </span>
        <span className={styles.feedSub}>@{data.username}</span>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <FollowButton targetUsername={data.username} initialFollowing={data.isFollowing} size="sm" />
      </div>
    </div>
  );
});

const CommunityRow = React.memo(function CommunityRow({ data, onOpen }) {
  const [imgError, setImgError] = useState(false);
  const avatar = data.avatarKey || data.avatar;
  const memberCount = data.memberCount || data.membersCount || data.members || 0;
  const hasDescription = Boolean(data.description && data.description.trim() && data.description.toLowerCase() !== data.name?.toLowerCase());

  return (
    <div className={styles.resultCard} onClick={() => onOpen('community', data)}>
      <div className={styles.communityIconBox}>
        {avatar && isImageUrl(avatar) && !imgError ? (
          <img
            src={getProcessedAvatarUrl(avatar)}
            alt={data.name || 'Community'}
            className={styles.communityAvatarImg}
            onError={() => setImgError(true)}
          />
        ) : (
          <span>{data.name?.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className={styles.feedInfo}>
        <div className={styles.rowHeaderTitle}>
          <span className={styles.feedName}>{data.name}</span>
        </div>
        {hasDescription && (
          <span className={styles.feedDesc}>
            {data.description}
          </span>
        )}
        <span className={styles.feedSub}>
          <Users size={13} /> {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
    </div>
  );
});

const ActivityRow = React.memo(function ActivityRow({ data, storeActivity, usersById, onOpen }) {
  const activityData = storeActivity || data;
  const coverUrl = activityData.coverImage || getDefaultCover(activityData.title || activityData.id);
  const timeFormatted = formatDateTime(activityData);

  const seenIds = new Set();
  const displayUsers = [];
  if (activityData.hostAvatar || activityData.hostName || activityData.creator) {
    const hId = activityData.hostId || activityData.creatorId || 'host';
    const hAv = activityData.hostAvatar || activityData.creator?.avatar;
    const hName = activityData.hostName || activityData.creator?.displayName;
    if (hAv || hName) {
      displayUsers.push({ id: hId, avatar: hAv, displayName: hName });
      seenIds.add(hId);
    }
  }
  const participantIds = activityData.participants || (activityData.members || []).map(m => m.userId || m.id || m);
  const memberObjs = activityData._membersData || activityData.members || [];
  participantIds.forEach(id => {
    const cleanId = typeof id === 'object' ? id.id || id.userId : id;
    if (!cleanId || seenIds.has(cleanId)) return;
    // O(1) map lookup instead of Object.values(users).find() per participant per render.
    const uObj = usersById.get(cleanId) || memberObjs.find(m => m?.id === cleanId || m?.userId === cleanId || m?.user?.id === cleanId);
    const userRef = uObj?.user || uObj;
    if (userRef) {
      displayUsers.push({
        id: cleanId,
        avatar: userRef?.avatar || userRef?.profileImage,
        displayName: userRef?.displayName || userRef?.name || userRef?.username,
      });
      seenIds.add(cleanId);
    }
  });

  const finalAvatars = displayUsers.slice(0, 5);
  const totalCount = participantIds.length || (activityData.members || []).length || activityData.slotsFilled || (displayUsers.length > 0 ? displayUsers.length : 1);
  const isPastOrEnded = activityData.status === 'ENDED' || activityData.status === 'CANCELLED' || activityData.status === 'COMPLETED' || (activityData.startDate && new Date(activityData.startDate) < new Date());
  const goingLabelText = `${totalCount} ${isPastOrEnded ? 'participated' : 'going'}`;

  return (
    <div className={styles.resultCard} onClick={() => onOpen('activity', activityData)}>
      <div className={styles.activityCoverThumb}>
        <img
          src={coverUrl}
          alt={activityData.title || 'Activity'}
          className={styles.activityCoverImg}
          loading="lazy"
          decoding="async"
          onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_COVERS[0]; }}
        />
      </div>
      <div className={styles.feedInfo}>
        <div className={styles.rowHeaderTitle}>
          <span className={styles.feedName}>{activityData.title}</span>
        </div>
        {timeFormatted && (
          <div className={styles.activityTimeLabel}>
            <Calendar size={13} /> {timeFormatted}
          </div>
        )}
        <div className={styles.activityFooterRow}>
          <div className={styles.goingLine}>
            <div className={styles.goingAvatarsGroup}>
              {finalAvatars.map((u, i) => (
                <div key={u.id || i} className={styles.goingAvatarWrap} style={{ zIndex: 5 - i }}>
                  {u.avatar && isImageUrl(u.avatar) ? (
                    <img
                      src={getProcessedAvatarUrl(u.avatar)}
                      alt={u.displayName || 'Participant'}
                      className={styles.goingAvatarImg}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }}
                    />
                  ) : (
                    <DefaultAvatar />
                  )}
                </div>
              ))}
            </div>
            <span className={styles.goingText}>{goingLabelText}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function SearchResultsRoute() {
  const { users, crewActivities } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawQ = searchParams.get('q') || '';
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const loadMoreRef = useRef(null);

  const {
    value: inputVal,
    debouncedValue: debouncedQuery,
    setValue: setInputVal,
    resetValue: resetInputVal,
    setImmediateValue: setImmediateInputVal,
  } = useDebouncedState(rawQ, 200);

  const [activeChip, setActiveChip] = useState('all');

  // Arrived here via the mobile header hand-off (first keystroke there navigates here).
  const [shouldAutoFocus] = useState(() => Boolean(location.state?.autoFocus));

  useEffect(() => {
    if (location.state?.autoFocus) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const saved = localStorage.getItem('meetifyy_recent_searches');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string' && s.length >= 2).slice(0, 10) : [];
    } catch {
      return [];
    }
  });

  // Load persisted recent searches from backend on boot
  useEffect(() => {
    let mounted = true;
    searchApi.getRecentSearches()
      .then((serverRecents) => {
        if (mounted && Array.isArray(serverRecents) && serverRecents.length > 0) {
          const validRecents = serverRecents.filter(s => typeof s === 'string' && s.length >= 2);
          setRecentSearches(validRecents);
          localStorage.setItem('meetifyy_recent_searches', JSON.stringify(validRecents));
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Track the raw URL search parameter to prevent circular update loops
  const prevRawQRef = useRef(rawQ);
  // Track the last debounced value we acted on. The write-to-URL effect below
  // depends on both `debouncedQuery` AND `rawQ`, so it re-runs whenever the URL
  // changes too — even when the change came from OUTSIDE this input (back/forward
  // nav, or the header GlobalSearch on desktop). In that case `debouncedQuery` is
  // stale, and writing it back to the URL clobbers the newer value → a ping-pong
  // that flickers the search bar and breaks the clear button. This ref lets the
  // effect write ONLY when the debounced value itself actually moved (user typed).
  const prevDebouncedRef = useRef(debouncedQuery);

  // Synchronize inputVal from rawQ when rawQ changes externally (back/forward
  // navigation, deep link, initial load). Never while this input is focused —
  // the field the user is typing in is the source of truth, and echoing a
  // slightly-stale URL value back into it is what made the text jump/revert.
  useEffect(() => {
    if (rawQ === prevRawQRef.current) return;
    prevRawQRef.current = rawQ;
    if (document.activeElement === searchInputRef.current) return;
    setImmediateInputVal(rawQ);
  }, [rawQ, setImmediateInputVal]);

  // Sync debounced query to URL searchParams without ping-ponging.
  // Guard: act only when the DEBOUNCED value genuinely changed (the user typed).
  // If this effect re-ran only because `rawQ` changed externally, `debouncedQuery`
  // still equals what we last saw, so we bail out instead of writing a stale value
  // back over the fresher URL.
  useEffect(() => {
    if (debouncedQuery === prevDebouncedRef.current) return;
    prevDebouncedRef.current = debouncedQuery;
    const trimmed = debouncedQuery.trim();
    if (trimmed !== rawQ) {
      prevRawQRef.current = trimmed;
      setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
    }
  }, [debouncedQuery, rawQ, setSearchParams]);

  const {
    results,
    isLoading,
    isSearching,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGlobalSearch(debouncedQuery, 30, activeChip);

  // Stable identity (functional setState, no dependency on recentSearches) so the
  // memoized row `onOpen` handler below never changes ref while typing — rows stay memoized.
  const addRecentSearch = useCallback((term) => {
    if (!term || typeof term !== 'string') return;
    const cleanTerm = term.trim();
    if (cleanTerm.length < 2) return;
    setRecentSearches((prev) => {
      const updated = [cleanTerm, ...prev.filter(s => typeof s === 'string' && s.length >= 2 && s.toLowerCase() !== cleanTerm.toLowerCase())].slice(0, 10);
      localStorage.setItem('meetifyy_recent_searches', JSON.stringify(updated));
      return updated;
    });
    searchApi.addRecentSearch(cleanTerm).catch(() => {});
  }, []);

  const handleSelectSearch = useCallback((term) => {
    const trimmed = term.trim();
    if (trimmed) {
      setImmediateInputVal(trimmed);
      prevRawQRef.current = trimmed;
      setSearchParams({ q: trimmed }, { replace: true });
      if (trimmed.length >= 2) {
        addRecentSearch(trimmed);
      }
    } else {
      resetInputVal('');
      prevRawQRef.current = '';
      setSearchParams({}, { replace: true });
    }
  }, [addRecentSearch, resetInputVal, setImmediateInputVal, setSearchParams]);


  const removeRecentSearch = (e, term) => {
    e.stopPropagation();
    e.preventDefault();
    const updated = recentSearches.filter(s => s !== term);
    setRecentSearches(updated);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify(updated));
    searchApi.removeRecentSearch(term).catch(() => {});
  };

  const clearAllRecent = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setRecentSearches([]);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify([]));
    searchApi.clearRecentSearches().catch(() => {});
  };

  // O(1) lookup maps built once per store change, so the activity rows resolve
  // participants/store-data without an O(n) scan per row per render.
  const usersById = useMemo(() => {
    const m = new Map();
    Object.values(users || {}).forEach((u) => { if (u?.id) m.set(u.id, u); });
    return m;
  }, [users]);

  const activitiesById = useMemo(() => {
    const m = new Map();
    (crewActivities || []).forEach((a) => { if (a?.id != null) m.set(String(a.id), a); });
    return m;
  }, [crewActivities]);

  // Single stable open handler for all memoized rows.
  const openEntity = useCallback((kind, data) => {
    if (kind === 'user') {
      addRecentSearch(data.username);
      navigate(`/profile/${data.username}`);
    } else if (kind === 'community') {
      if (data.name) addRecentSearch(data.name);
      navigate(`/communities/${data.id}`);
    } else if (kind === 'activity') {
      if (data.title) addRecentSearch(data.title);
      navigate(`/crew/${data.id}`);
    } else if (kind === 'post') {
      navigate(`/post/${data.id}`);
    }
  }, [addRecentSearch, navigate]);

  const handlePostClick = useCallback((data) => {
    openEntity('post', data);
  }, [openEntity]);

  // Interleave search & discovery feed evenly across entity categories
  const activeFeed = useMemo(() => {
    const uList = (results.users || []).map(r => ({ kind: 'user', data: r.item, id: `su-${r.item.id}` }));
    const cList = (results.communities || []).map(r => ({ kind: 'community', data: r.item, id: `sc-${r.item.id}` }));
    const aList = (results.crew || []).map(r => ({ kind: 'activity', data: r.item, id: `sa-${r.item.id}` }));
    const pList = (results.posts || []).map(r => ({ kind: 'post', data: r.item, id: `sp-${r.item.id}` }));

    const feed = [];
    const maxItems = Math.max(uList.length, cList.length, aList.length, pList.length);

    for (let i = 0; i < maxItems; i++) {
      if (uList[i]) feed.push(uList[i]);
      if (aList[i]) feed.push(aList[i]);
      if (cList[i]) feed.push(cList[i]);
      if (pList[i]) feed.push(pList[i]);
    }

    return feed;
  }, [results]);

  // Auto-fetch the next page when the sentinel row scrolls into view.
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        fetchNextPage();
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filteredFeed = useMemo(() => {
    if (activeChip === 'all') return activeFeed;
    if (activeChip === 'people') return activeFeed.filter(item => item.kind === 'user');
    if (activeChip === 'activities') return activeFeed.filter(item => item.kind === 'activity');
    if (activeChip === 'communities') return activeFeed.filter(item => item.kind === 'community');
    if (activeChip === 'posts') return activeFeed.filter(item => item.kind === 'post');
    return activeFeed;
  }, [activeFeed, activeChip]);

  const hasQuery = inputVal.trim().length > 0;
  const sectionLabel = hasQuery
    ? `Showing results for "${inputVal.trim()}"`
    : 'Suggested for you';

  return (
    <>
      <main ref={containerRef} className="centre animate-in">
        <div className={styles.searchShell}>
        {/* Sticky Search Header */}
        <div className={styles.header} role="search">
          <div className={styles.topRow}>
            <button
              className={styles.backBtn}
              aria-label="Go back"
              onClick={() => goBack('/home')}
            >
              <ArrowLeft size={20} />
            </button>
            <div className={styles.searchPill}>
              <Search size={18} className={styles.searchPillIcon} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                autoFocus={shouldAutoFocus}
                className={styles.searchInput}
                placeholder="Search..."
                value={inputVal}
                aria-label="Search field"
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && inputVal.trim()) {
                    addRecentSearch(inputVal);
                  }
                }}
              />
              {isSearching && !isLoading && (
                <Loader2 size={16} className={styles.updatingSpinner} aria-label="Updating results" />
              )}
              {inputVal && (
                <button
                  type="button"
                  className={styles.clearBtn}
                  aria-label="Clear search text"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectSearch('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Quick Filter Chips — shown only when user has typed search query */}
          {hasQuery && (
            <div className={styles.filterRow} role="tablist" aria-label="Search entity filters">
              {QUICK_CHIPS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={activeChip === id}
                  className={`${styles.filterChip} ${activeChip === id ? styles.filterChipActive : ''}`}
                  onClick={() => setActiveChip(id)}
                >
                  {Icon && <Icon size={14} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Recent Searches Bar */}
          {!hasQuery && recentSearches.length > 0 && (
            <div className={styles.recentRow}>
              <div className={styles.recentLabel}>
                <Clock size={13} />
                <span>Recent Searches</span>
                <button className={styles.clearAllBtn} onClick={clearAllRecent}>
                  Clear all
                </button>
              </div>
              <div className={styles.recentList}>
                {recentSearches.map((term) => (
                  <span key={term} className={styles.recentChip} onClick={() => handleSelectSearch(term)}>
                    {term}
                    <X size={11} aria-label={`Remove recent search ${term}`} onClick={(e) => removeRecentSearch(e, term)} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Scrollable Results Body */}
        <div className={styles.body}>
          {isLoading ? (
            <div className={styles.resultsList}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className={styles.skeletonCard}>
                  <Skeleton type="circle" width="46px" height="46px" />
                  <div className={styles.skeletonCol}>
                    <Skeleton type="text" width="40%" height="16px" />
                    <Skeleton type="text" width="65%" height="13px" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError && filteredFeed.length === 0 ? (
            <div className={styles.stateContainer}>
              <div className={`${styles.stateIconRing} ${styles.stateIconRingDanger}`}>
                <AlertCircle size={28} />
              </div>
              <h3 className={styles.stateTitle}>Network error</h3>
              <p className={styles.stateSub}>Could not load search results. Check your connection and try again.</p>
              <button className={styles.stateBtn} onClick={() => refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : filteredFeed.length === 0 ? (
            <div className={styles.stateContainer}>
              <div className={styles.stateIconRing}>
                <Search size={28} />
              </div>
              <h3 className={styles.stateTitle}>No results found</h3>
              <p className={styles.stateSub}>Try searching for another keyword or browse popular communities.</p>
              <button className={styles.stateBtn} onClick={() => handleSelectSearch('')}>
                Show all items
              </button>
            </div>
          ) : (
            <div className={styles.resultsList}>
              <div className={styles.sectionLabel}>{sectionLabel}</div>
              {filteredFeed.map(({ kind, data, id }) => {
                if (kind === 'user') {
                  return <UserRow key={id} data={data} onOpen={openEntity} />;
                }
                if (kind === 'activity') {
                  const activityData = activitiesById.get(String(data.id)) || data;
                  return (
                    <div key={id} className={styles.crewCardWrapper}>
                      <CrewCard
                        activity={activityData}
                        onClick={() => openEntity('activity', activityData)}
                      />
                    </div>
                  );
                }
                if (kind === 'community') {
                  return <CommunityRow key={id} data={data} onOpen={openEntity} />;
                }
                if (kind === 'post') {
                  return (
                    <div key={id} style={{ marginBottom: '8px' }}>
                      <Post postData={data} onClick={handlePostClick} />
                    </div>
                  );
                }
                return null;
              })}

              {hasNextPage && (
                <div ref={loadMoreRef} className={styles.loadMoreRow}>
                  {isFetchingNextPage ? (
                    <Loader2 size={18} className={styles.updatingSpinner} aria-label="Loading more results" />
                  ) : (
                    <button className={styles.loadMoreBtn} onClick={() => fetchNextPage()}>
                      Load more
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </main>
      <RightPanel className="animate-in">
        <OnlineFriends />
        <NotificationsActivity />
        <UpcomingEvents />
      </RightPanel>
    </>
  );
}
