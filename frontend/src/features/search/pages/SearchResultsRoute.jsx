import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Activity, Clock, X, RefreshCw, AlertCircle, Heart, MessageSquare, MapPin, Calendar, Users, Lock, Globe, ArrowLeft } from 'lucide-react';
import { useGlobalSearch } from '@features/search/hooks/useGlobalSearch';
import Avatar, { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import { isImageUrl } from '@shared/utils/avatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import PageLayout from '@layout/PageLayout';
import FollowButton from '@shared/components/ui/FollowButton';
import { useData } from '@shared/hooks/useData';
import { searchApi } from '@shared/api/apiClient';
import styles from './SearchResultsRoute.module.css';

const QUICK_CHIPS = [
  { id: 'all', label: '🔥 All' },
  { id: 'people', label: '👥 People' },
  { id: 'activities', label: '🏕 Activities' },
  { id: 'communities', label: '🌍 Communities' },
  { id: 'posts', label: '📝 Posts' },
];

export default function SearchResultsRoute() {
  const { users, crewActivities } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawQ = searchParams.get('q') || '';
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const [inputVal, setInputVal] = useState(rawQ);
  const [activeChip, setActiveChip] = useState('all');

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

  // Sync URL search params with input value with 200ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = inputVal.trim();
      if (trimmed !== rawQ) {
        if (trimmed) {
          setSearchParams({ q: trimmed }, { replace: true });
        } else {
          setSearchParams({}, { replace: true });
        }
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [inputVal, rawQ, setSearchParams]);

  useEffect(() => {
    setInputVal(rawQ);
  }, [rawQ]);

  const { results, isSearching, isError, refetch } = useGlobalSearch(inputVal, 30, activeChip);

  const handleSelectSearch = (term) => {
    const trimmed = term.trim();
    setInputVal(trimmed);
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
    if (trimmed && trimmed.length >= 2) {
      addRecentSearch(trimmed);
    }
  };

  const addRecentSearch = (term) => {
    if (!term || typeof term !== 'string') return;
    const cleanTerm = term.trim();
    if (cleanTerm.length < 2) return;
    const updated = [cleanTerm, ...recentSearches.filter(s => typeof s === 'string' && s.length >= 2 && s.toLowerCase() !== cleanTerm.toLowerCase())].slice(0, 10);
    setRecentSearches(updated);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify(updated));
    searchApi.addRecentSearch(cleanTerm).catch(() => {});
  };

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

  const filteredFeed = useMemo(() => {
    if (activeChip === 'all') return activeFeed;
    if (activeChip === 'people') return activeFeed.filter(item => item.kind === 'user');
    if (activeChip === 'activities') return activeFeed.filter(item => item.kind === 'activity');
    if (activeChip === 'communities') return activeFeed.filter(item => item.kind === 'community');
    if (activeChip === 'posts') return activeFeed.filter(item => item.kind === 'post');
    return activeFeed;
  }, [activeFeed, activeChip]);

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
      return null;
    }
  };

  const DEFAULT_COVERS = [
    'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1551818255-e6e10975bc17?q=80&w=800&auto=format&fit=crop',
  ];

  const getDefaultCover = (idOrTitle = '') => {
    let hash = 0;
    const str = String(idOrTitle || '');
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % DEFAULT_COVERS.length;
    return DEFAULT_COVERS[idx];
  };

  const formatDateTime = (activity) => {
    if (!activity) return '';
    const startRaw = activity.startDate || activity.date || activity.createdAt;
    if (!startRaw) return '';
    
    const startD = new Date(startRaw);
    if (isNaN(startD.getTime())) return '';

    const endRaw = activity.endDate;
    const endD = endRaw ? new Date(endRaw) : null;

    const startDateFormatted = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const startTimeStr = activity.time || startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    if (endD && !isNaN(endD.getTime())) {
      const endDateFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endTimeStr = activity.endTime || endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      if (startDateFormatted === endDateFormatted) {
        return `${startDateFormatted} • ${startTimeStr} – ${endTimeStr}`;
      } else {
        return `${startDateFormatted} • ${startTimeStr} → ${endDateFormatted} • ${endTimeStr}`;
      }
    }

    return `${startDateFormatted} • ${startTimeStr}`;
  };

  return (
    <PageLayout containerRef={containerRef}>
      <div className={styles.searchPageContainer}>
        {/* Sticky Search Header */}
        <div className={styles.searchHeaderArea} role="search">
          <div className={styles.topBarRow}>
            <button
              className={styles.backBtn}
              aria-label="Go back"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={20} />
            </button>
            <div className={styles.searchBarBox}>
              <Search size={18} className={styles.searchIcon} aria-hidden="true" />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search people, communities, activities, posts..."
                value={inputVal}
                aria-label="Search field"
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && inputVal.trim()) {
                    addRecentSearch(inputVal);
                  }
                }}
              />
              {inputVal && (
                <button
                  className={styles.clearBtn}
                  aria-label="Clear search text"
                  onClick={() => handleSelectSearch('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Quick Filter Chips — shown only when user has typed search query */}
          {inputVal.trim().length > 0 && (
            <div className={styles.chipsBar} role="tablist" aria-label="Search entity filters">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  role="tab"
                  aria-selected={activeChip === chip.id}
                  className={`${styles.chipBtn} ${activeChip === chip.id ? styles.chipBtnActive : ''}`}
                  onClick={() => setActiveChip(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {/* Recent Searches Bar */}
          {!inputVal.trim() && recentSearches.length > 0 && (
            <div className={styles.recentBar}>
              <div className={styles.recentTitle}>
                <Clock size={13} />
                <span>Recent Searches</span>
              </div>
              <div className={styles.recentChips}>
                {recentSearches.map((term) => (
                  <span key={term} className={styles.recentChipItem} onClick={() => handleSelectSearch(term)}>
                    {term}
                    <X size={11} aria-label={`Remove recent search ${term}`} onClick={(e) => removeRecentSearch(e, term)} />
                  </span>
                ))}
                <button className={styles.clearAllBtn} onClick={clearAllRecent}>
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Seamless Mixed Feed Container */}
        <div className={styles.feedContainer}>
          {isSearching ? (
            <div className={styles.feedList}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className={styles.skeletonRow}>
                  <Skeleton type="circle" width="44px" height="44px" />
                  <div className={styles.skeletonCol}>
                    <Skeleton type="text" width="40%" height="16px" />
                    <Skeleton type="text" width="65%" height="13px" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className={styles.emptyStateContainer}>
              <AlertCircle size={36} className={styles.emptyIcon} />
              <h3 className={styles.emptyTitle}>Network Error</h3>
              <p className={styles.emptySub}>Could not load search results. Check your connection and try again.</p>
              <button className={styles.resetBtn} onClick={() => refetch()}>
                <RefreshCw size={14} style={{ marginRight: '6px' }} /> Retry
              </button>
            </div>
          ) : filteredFeed.length === 0 ? (
            <div className={styles.emptyStateContainer}>
              <Search size={36} className={styles.emptyIcon} />
              <h3 className={styles.emptyTitle}>No results found</h3>
              <p className={styles.emptySub}>Try searching for another keyword or browse popular communities.</p>
              <button className={styles.resetBtn} onClick={() => handleSelectSearch('')}>
                Show all items
              </button>
            </div>
          ) : (
            <div className={styles.feedList}>
              {filteredFeed.map(({ kind, data, id }) => {
                if (kind === 'user') {
                  return (
                    <div
                      key={id}
                      className={styles.feedRow}
                      onClick={() => {
                        addRecentSearch(data.username);
                        navigate(`/profile/${data.username}`);
                      }}
                    >
                      <Avatar src={data.avatar} name={data.displayName} size="44px" disableHover />
                      <div className={styles.feedInfo}>
                        <span className={styles.feedName}>{data.displayName}</span>
                        <span className={styles.feedSub}>@{data.username}</span>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <FollowButton targetUsername={data.username} initialFollowing={data.isFollowing} size="sm" />
                      </div>
                    </div>
                  );
                }

                if (kind === 'activity') {
                  const matchedStoreAct = (crewActivities || []).find(a => String(a.id) === String(data.id));
                  const activityData = matchedStoreAct || data;

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
                    const uObj = Object.values(users || {}).find(u => u.id === cleanId) || memberObjs.find(m => m?.id === cleanId || m?.userId === cleanId || m?.user?.id === cleanId);
                    const userRef = uObj?.user || uObj;
                    if (userRef) {
                      displayUsers.push({
                        id: cleanId,
                        avatar: userRef?.avatar || userRef?.profileImage,
                        displayName: userRef?.displayName || userRef?.name || userRef?.username
                      });
                      seenIds.add(cleanId);
                    }
                  });

                  const finalAvatars = displayUsers.slice(0, 5);
                  const totalCount = participantIds.length || (activityData.members || []).length || activityData.slotsFilled || (displayUsers.length > 0 ? displayUsers.length : 1);
                  const isPastOrEnded = activityData.status === 'ENDED' || activityData.status === 'CANCELLED' || activityData.status === 'COMPLETED' || (activityData.startDate && new Date(activityData.startDate) < new Date());
                  const goingLabelText = `${totalCount} ${isPastOrEnded ? 'participated' : 'going'}`;

                  return (
                    <div
                      key={id}
                      className={styles.feedRow}
                      onClick={() => {
                        if (activityData.title) addRecentSearch(activityData.title);
                        navigate(`/crew/${activityData.id}`);
                      }}
                    >
                      <div className={styles.activityCoverThumb}>
                        <img
                          src={coverUrl}
                          alt={activityData.title || 'Activity'}
                          className={styles.activityCoverImg}
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = DEFAULT_COVERS[0];
                          }}
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
                                      alt={u.displayName || "Participant"}
                                      className={styles.goingAvatarImg}
                                      onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }}
                                    />
                                  ) : (
                                    <DefaultAvatar />
                                  )}
                                </div>
                              ))}
                            </div>
                            <span className={styles.goingText}>
                              {goingLabelText}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (kind === 'community') {
                  return (
                    <div
                      key={id}
                      className={styles.feedRow}
                      onClick={() => {
                        if (data.name) addRecentSearch(data.name);
                        navigate(`/communities/${data.id}`);
                      }}
                    >
                      <div className={styles.communityIconBox}>
                        {data.name?.charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.feedInfo}>
                        <div className={styles.rowHeaderTitle}>
                          <span className={styles.feedName}>{data.name}</span>
                        </div>
                        <span className={styles.feedSub}>
                          {data.description ? `${data.description.substring(0, 60)}... • ` : ''}
                          {data.memberCount || data.members || 0} members
                        </span>
                      </div>
                    </div>
                  );
                }

                if (kind === 'post') {
                  const author = data.author;
                  return (
                    <div
                      key={id}
                      className={styles.feedRow}
                      onClick={() => {
                        navigate(`/post/${data.id}`);
                      }}
                    >
                      <Avatar src={author?.avatar} name={author?.displayName || 'Post'} size="44px" disableHover />
                      <div className={styles.feedInfo}>
                        <div className={styles.rowHeaderTitle}>
                          <span className={styles.feedName}>{author?.displayName || 'Post'}</span>
                          {author?.username && <span className={styles.feedSubHandle}>@{author.username}</span>}
                        </div>
                        <p className={styles.postSnippetText}>
                          {data.text}
                        </p>
                        <div className={styles.metaRow}>
                          <span className={styles.metaStat}>
                            <Heart size={12} /> {data.likesCount || data.likeCount || 0}
                          </span>
                          <span className={styles.metaStat}>
                            <MessageSquare size={12} /> {data.commentsCount || data.commentCount || 0}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
