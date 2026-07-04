import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Users, Activity, UsersRound, UserPlus, UserCheck, MapPin, Clock, UsersIcon } from 'lucide-react';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useData } from '../context/DataContext';
import { useSmartBack } from '../hooks/useSmartBack';
import { PostResult, CommunityResult, UserResult, CollegeResult, CrewResult } from '../components/search/SearchResultCards';
import GlobalSearch from '../components/search/GlobalSearch';
import { isImageUrl } from '../utils/avatar';
import DefaultAvatar from '../components/common/DefaultAvatar';
import Skeleton from '../components/common/Skeleton';
import styles from './SearchResultsRoute.module.css';

// Compact horizontal activity row
function ActivityRow({ activity, onClick }) {
  const { joinCrewActivity, requestToJoinActivity, currentUser } = useData();
  const isJoined = activity.participants?.includes(currentUser?.id);
  const hasRequested = activity.pendingRequests?.includes(currentUser?.id);
  const isApproval = activity.participationType === 'approval';

  return (
    <div className={styles.activityRow} onClick={onClick}>
      <div className={styles.activityRowIcon}>
        {isImageUrl(activity.hostAvatar)
          ? <img src={activity.hostAvatar} alt={activity.hostName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          : <DefaultAvatar />
        }
      </div>
      <div className={styles.activityRowInfo}>
        <span className={styles.activityRowTitle}>{activity.title}</span>
        <div className={styles.activityRowMeta}>
          {activity.dateLabel && (
            <span className={styles.activityRowMetaItem}>
              <Clock size={11} />
              {activity.dateLabel}{activity.time ? ` • ${activity.time}` : ''}
            </span>
          )}
          {activity.location && (
            <span className={styles.activityRowMetaItem}>
              <MapPin size={11} />
              {activity.location}
            </span>
          )}
          {activity.slotsNeeded && (
            <span className={styles.activityRowMetaItem}>
              <UsersIcon size={11} />
              {Math.min(activity.slotsFilled || 0, activity.slotsNeeded)}/{activity.slotsNeeded} joined
            </span>
          )}
        </div>
      </div>
      <button
        className={`${styles.rowActionBtn} ${(isJoined || hasRequested) ? styles.rowActionBtnActive : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isJoined || hasRequested) return;
          if (isApproval) requestToJoinActivity(activity.id);
          else joinCrewActivity(activity.id);
        }}
      >
        {isJoined ? 'Joined' : hasRequested ? 'Requested' : isApproval ? 'Request' : 'Join'}
      </button>
    </div>
  );
}

// Compact horizontal community row
function CommunityRow({ comm, onClick }) {
  const { toggleJoinCommunity, currentUser } = useData();
  const isJoined = currentUser?.communities?.includes(comm.name);

  return (
    <div className={styles.communityRow} onClick={onClick}>
      <div
        className={styles.communityRowAvatar}
        style={comm.color ? { background: comm.color } : { background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }}
      >
        {isImageUrl(comm.avatar)
          ? <img src={comm.avatar} alt={comm.name} />
          : <span>{comm.name.charAt(0).toUpperCase()}</span>
        }
      </div>
      <div className={styles.communityRowInfo}>
        <span className={styles.communityRowName}>{comm.name}</span>
        <span className={styles.communityRowMembers}>
          <UsersIcon size={12} />
          {(comm.members || 0).toLocaleString()} members
        </span>
      </div>
      <button
        className={`${styles.rowActionBtn} ${isJoined ? styles.rowActionBtnActive : styles.rowActionBtnOutline}`}
        onClick={(e) => { e.stopPropagation(); toggleJoinCommunity(comm.id); }}
      >
        {isJoined ? 'Joined' : 'Join'}
      </button>
    </div>
  );
}

// Person row in sidebar
function PersonRow({ user }) {
  const { toggleFollow, currentUser, users } = useData();
  const navigate = useNavigate();
  // Always read from latest users state so button updates immediately
  const latestMe = users?.[currentUser?.username];
  const isFollowing = latestMe?.followingList?.includes(user.username);

  // Compute real mutual connections: people that both the current user and this user follow
  const mutualConnections = useMemo(() => {
    const myFollowing = latestMe?.followingList || [];
    const theirFollowing = users?.[user.username]?.followingList || [];
    const mutualUsernames = myFollowing.filter(u => theirFollowing.includes(u));
    return mutualUsernames.map(uname => users?.[uname]).filter(Boolean);
  }, [latestMe?.followingList, user.username, users]);

  return (
    <div className={styles.sidebarItem} onClick={() => navigate(`/profile/${user.username}`)}>
      <div className={styles.sidebarAvatar}>
        {isImageUrl(user.avatar)
          ? <img src={user.avatar} alt={user.displayName} />
          : <DefaultAvatar />
        }
      </div>
      <div className={styles.sidebarItemInfo}>
        <div className={styles.sidebarItemNameRow}>
          <span className={styles.sidebarItemName}>{user.displayName}</span>
          {user.verified && <span className={styles.verifiedBadge}>✓</span>}
        </div>
        <span className={styles.sidebarItemHandle}>@{user.username}</span>
        <span className={styles.sidebarItemDesc}>
          {user.bio ? user.bio.substring(0, 35) + '...' : 'Student • Explorer'}
        </span>
        {mutualConnections.length > 0 && (
          <div className={styles.mutualFriends}>
            <div className={styles.mutualAvatars}>
              {mutualConnections.slice(0, 3).map(m => (
                <div key={m.username} className={styles.mutualAvatar}>
                  {isImageUrl(m.avatar)
                    ? <img src={m.avatar} alt={m.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : m.avatar && m.avatar.length === 1
                      ? <span style={{ fontSize: '8px', fontWeight: 700 }}>{m.avatar}</span>
                      : <DefaultAvatar />
                  }
                </div>
              ))}
            </div>
            <span>{mutualConnections.length} mutual {mutualConnections.length === 1 ? 'connection' : 'connections'}</span>
          </div>
        )}
      </div>
      <button
        className={`${styles.followBtn} ${isFollowing ? styles.followBtnActive : ''}`}
        title={isFollowing ? 'Unfollow' : 'Follow'}
        onClick={(e) => { e.stopPropagation(); toggleFollow(user.username); }}
      >
        {isFollowing ? <UserCheck size={15} /> : <UserPlus size={15} />}
      </button>
    </div>
  );
}

export default function SearchResultsRoute() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const [activeSection, setActiveSection] = useState('all');
  const containerRef = useRef(null);
  const { communities, users, crewActivities, posts } = useData();

  useEffect(() => {
    if (containerRef.current) {
      setTimeout(() => {
        if (containerRef.current) containerRef.current.scrollTo({ top: 0 });
      }, 10);
    }
  }, [activeSection, q]);
  
  const { results, isSearching } = useGlobalSearch(q, 20);
  
  const handleNavigate = (path) => navigate(path);

  const hasResults = 
    results.posts.length > 0 || results.communities.length > 0 ||
    results.users.length > 0 || results.colleges.length > 0 || results.crew.length > 0;

  const topMatches = useMemo(() => {
    const sorted = [];
    if (results.posts.length > 0) sorted.push(...results.posts.slice(0, 3).map(r => ({ ...r, type: 'post' })));
    if (results.users.length > 0) sorted.push(...results.users.slice(0, 3).map(r => ({ ...r, type: 'user' })));
    if (results.communities.length > 0) sorted.push(...results.communities.slice(0, 2).map(r => ({ ...r, type: 'community' })));
    if (results.colleges.length > 0) sorted.push(...results.colleges.slice(0, 2).map(r => ({ ...r, type: 'college' })));
    if (results.crew.length > 0) sorted.push(...results.crew.slice(0, 2).map(r => ({ ...r, type: 'crew' })));
    return sorted;
  }, [results]);

  const suggestedUsers = useMemo(() => {
    if (!users) return [];
    return Object.values(users)
      .filter(u => u.username !== 'current_user')
      .sort((a, b) => (b.followers || 0) - (a.followers || 0))
      .slice(0, 4);
  }, [users]);

  const popularCommunities = useMemo(() => {
    if (!communities) return [];
    return Object.values(communities)
      .filter(c => !c.isUniversity)
      .sort((a, b) => (b.members || 0) - (a.members || 0))
      .slice(0, 5);
  }, [communities]);

  const trendingActivities = useMemo(() => {
    if (!crewActivities) return [];
    const now = new Date();
    return crewActivities
      .filter(a => !a.date || new Date(a.date) > now)
      .sort((a, b) => (b.slotsFilled || 0) - (a.slotsFilled || 0))
      .slice(0, 4);
  }, [crewActivities]);

  const topPosts = useMemo(() => {
    if (!posts) return [];
    return [...posts].sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 3);
  }, [posts]);

  const sections = [
    { id: 'all', label: 'All', icon: Search },
    { id: 'users', label: 'People', icon: Users },
    { id: 'activities', label: 'Activities', icon: Activity },
    { id: 'community', label: 'Communities', icon: UsersRound },
  ];

  // What to show in left column when on explore page (no query)
  const showActivitiesOnly = !q.trim() && activeSection === 'activities';
  const showCommunitiesOnly = !q.trim() && activeSection === 'community';
  const showPeopleOnly = !q.trim() && activeSection === 'users';

  return (
    <div ref={containerRef} className={`centre centre-wide ${styles.container}`}>
      {/* Header */}
      <div className={styles.headerArea}>
        {/* Mobile back row — hidden on desktop */}
        <div className={styles.mobileBackRow}>
          <button className={styles.backBtn} onClick={() => goBack('/home')} aria-label="Go back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h1 className={styles.backTitle}>Search</h1>
        </div>

        {/* Desktop title */}
        <h1 className={styles.pageTitle}>Search</h1>
        <p className={styles.pageSubtitle}>Find people, activities, and communities ✨</p>
        
        <div className={styles.searchRow}>
          <div className={styles.searchWrapper}>
            <GlobalSearch variant="mobileSearchPage" />
          </div>
        </div>

        <div className={styles.sectionTabs}>
          {sections.map(sec => {
            const Icon = sec.icon;
            return (
              <button
                key={sec.id}
                className={`${styles.sectionTabBtn} ${activeSection === sec.id ? styles.activeSectionTab : ''}`}
                onClick={() => setActiveSection(sec.id)}
              >
                <Icon size={15} className={styles.tabIcon} />
                {sec.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Explore page (no search query) */}
      {!q.trim() ? (
        <div className={styles.explorePage}>
          {/* People-only view */}
          {showPeopleOnly && (
            <div className={styles.fullWidthSection}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>People you may know</h2>
              </div>
              <div className={styles.sidebarBlock}>
                <div className={styles.sidebarList}>
                  {suggestedUsers.map((u, idx) => (
                    <PersonRow key={u.id} user={u} idx={idx} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Activities-only view */}
          {showActivitiesOnly && (
            <div className={styles.fullWidthSection}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Trending Activities</h2>
                <button className={styles.viewAllBtn} onClick={() => navigate('/crew')}>View all</button>
              </div>
              <div className={styles.rowList}>
                {trendingActivities.map(activity => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    onClick={() => navigate(`/crew/${activity.id}`, { state: { activity } })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Communities-only view */}
          {showCommunitiesOnly && (
            <div className={styles.fullWidthSection}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Popular Communities</h2>
                <button className={styles.viewAllBtn} onClick={() => navigate('/communities')}>View all</button>
              </div>
              <div className={styles.rowList}>
                {popularCommunities.map(c => (
                  <CommunityRow
                    key={c.id}
                    comm={c}
                    onClick={() => navigate(`/communities/${c.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All / default two-column view */}
          {(activeSection === 'all') && (
            <div className={styles.exploreColumns}>
              {/* Left Column */}
              <div className={styles.exploreMain}>
                {/* Top Posts */}
                {topPosts.length > 0 && (
                  <div className={styles.sectionBlock}>
                    <div className={styles.sectionHeader}>
                      <h2 className={styles.sectionTitle}>Top Posts</h2>
                      <button className={styles.viewAllBtn} onClick={() => navigate('/home')}>View all</button>
                    </div>
                    <div className={styles.topPostsList}>
                      {topPosts.map((post) => {
                        const author = users ? Object.values(users).find(u => u.id === post.authorId) : null;
                        return (
                          <button key={post.id} className={styles.topPostCard} onClick={() => navigate(`/post/${post.id}`)}>
                            <div className={styles.topPostAvatar}>
                              {author && isImageUrl(author.avatar)
                                ? <img src={author.avatar} alt={author.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                : <DefaultAvatar />
                              }
                            </div>
                            <div className={styles.topPostInfo}>
                              <span className={styles.topPostName}>{author?.displayName || 'Someone'}</span>
                              <p className={styles.topPostText}>{post.text?.substring(0, 80)}{post.text?.length > 80 ? '...' : ''}</p>
                              <div className={styles.topPostMeta}>
                                <span>❤️ {post.likes || 0}</span>
                                <span>💬 {post.comments || 0}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Trending Activities */}
                {trendingActivities.length > 0 && (
                  <div className={styles.sectionBlock}>
                    <div className={styles.sectionHeader}>
                      <h2 className={styles.sectionTitle}>Trending Activities</h2>
                      <button className={styles.viewAllBtn} onClick={() => navigate('/crew')}>View all</button>
                    </div>
                    <div className={styles.rowList}>
                      {trendingActivities.map(activity => (
                        <ActivityRow
                          key={activity.id}
                          activity={activity}
                          onClick={() => navigate(`/crew/${activity.id}`, { state: { activity } })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column */}
              <div className={styles.exploreSidebar}>
                {/* People */}
                <div className={styles.sidebarBlock}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>People</h2>
                    <button className={styles.viewAllBtn} onClick={() => setActiveSection('users')}>View all</button>
                  </div>
                  <div className={styles.sidebarList}>
                    {suggestedUsers.map((u, idx) => (
                      <PersonRow key={u.id} user={u} idx={idx} />
                    ))}
                  </div>
                </div>

                {/* Communities */}
                {popularCommunities.length > 0 && (
                  <div className={styles.sidebarBlock}>
                    <div className={styles.sectionHeader}>
                      <h2 className={styles.sectionTitle}>Communities</h2>
                      <button className={styles.viewAllBtn} onClick={() => navigate('/communities')}>View all</button>
                    </div>
                    <div className={styles.rowList}>
                      {popularCommunities.slice(0, 4).map(c => (
                        <CommunityRow
                          key={c.id}
                          comm={c}
                          onClick={() => navigate(`/communities/${c.id}`)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Search results for active query */
        <div className={styles.searchResults}>
          {isSearching ? (
            <div className={styles.sectionContent}>
              <div className={styles.resultsContainer}>
                <div className={styles.list}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} style={{ display: 'flex', gap: '1rem', padding: '1.2rem', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg-white)', borderRadius: '12px', marginBottom: '0.5rem' }}>
                      <Skeleton type="circle" width="48px" height="48px" />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <Skeleton type="text" width="40%" height="1.1rem" style={{ marginBottom: '6px' }} />
                        <Skeleton type="text" width="70%" height="0.8rem" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : !hasResults ? (
            <div className={styles.empty}>
              <Search size={48} className={styles.emptyIcon} />
              <p>No results for "{q}"</p>
              <span>Check spelling or try a different term.</span>
            </div>
          ) : (
            <div className={styles.sectionContent}>
              {activeSection === 'all' && (
                <div className={styles.resultsContainer}>
                  {topMatches.length > 0 ? (
                    <div className={styles.list}>
                      {topMatches.map(r => {
                        if (r.type === 'user') return <UserResult key={`top-u-${r.item.id}`} result={r} onClick={handleNavigate} />;
                        if (r.type === 'community') return <CommunityResult key={`top-c-${r.item.id}`} result={r} onClick={handleNavigate} />;
                        if (r.type === 'college') return <CollegeResult key={`top-col-${r.item.id}`} result={r} onClick={handleNavigate} />;
                        if (r.type === 'post') return <PostResult key={`top-p-${r.item.id}`} result={r} onClick={handleNavigate} />;
                        if (r.type === 'crew') return <CrewResult key={`top-cr-${r.item.id}`} result={r} onClick={handleNavigate} />;
                        return null;
                      })}
                    </div>
                  ) : <div className={styles.sectionEmpty}>No top matches for "{q}"</div>}
                </div>
              )}
              {activeSection === 'users' && (
                <div className={styles.resultsContainer}>
                  {results.users.length > 0
                    ? <div className={styles.list}>{results.users.map(r => <UserResult key={`u-${r.item.id}`} result={r} onClick={handleNavigate} />)}</div>
                    : <div className={styles.sectionEmpty}>No people for "{q}"</div>}
                </div>
              )}
              {activeSection === 'activities' && (
                <div className={styles.resultsContainer}>
                  {results.posts.length > 0
                    ? <div className={styles.list}>{results.posts.map(r => <PostResult key={`p-${r.item.id}`} result={r} onClick={handleNavigate} />)}</div>
                    : <div className={styles.sectionEmpty}>No activities for "{q}"</div>}
                </div>
              )}
              {activeSection === 'community' && (
                <div className={styles.resultsContainer}>
                  {results.communities.length > 0
                    ? <div className={styles.list}>{results.communities.map(r => <CommunityResult key={`c-${r.item.id}`} result={r} onClick={handleNavigate} />)}</div>
                    : <div className={styles.sectionEmpty}>No communities for "{q}"</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
