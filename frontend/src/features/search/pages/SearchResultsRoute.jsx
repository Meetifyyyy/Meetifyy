import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Users, Activity, UsersRound, UserPlus, UserCheck, MapPin, Clock, UsersIcon, ThumbsUp, MessageCircle } from 'lucide-react';
import { useGlobalSearch } from '@features/search/hooks/useGlobalSearch';
import { useData } from '@shared/context/DataContext';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { PostResult, CommunityResult, UserResult, CollegeResult, CrewResult } from '../components/SearchResultCards';
import GlobalSearch from '../components/GlobalSearch';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import PageLayout from '@layout/PageLayout';
import PageHeader from '@layout/PageHeader';
import ActivityJoinedModal from '@features/crew/components/modals/ActivityJoinedModal';
import styles from './SearchResultsRoute.module.css';

// Compact horizontal activity row
function ActivityRow({ activity, onClick }) {
  const { joinCrewActivity, requestToJoinActivity, currentUser, users } = useData();
  const navigate = useNavigate();
  const [showJoinedModal, setShowJoinedModal] = useState(false);
  const isJoined = activity.participants?.includes(currentUser?.id);
  const hasRequested = activity.pendingRequests?.includes(currentUser?.id);
  const isApproval = activity.participationType === 'approval';

  const eventImage = activity.coverImage || activity.image || activity.hostAvatar;

  const goingCount = Math.max(
    activity.participants?.length || 0,
    activity.slotsFilled || 0,
    1
  );

  const goingAvatars = useMemo(() => {
    const countToShow = Math.min(3, goingCount);
    const avatars = [];

    if (activity.participants && users) {
      activity.participants.forEach(id => {
        const u = users[id];
        if (u && isImageUrl(u.avatar) && !avatars.includes(u.avatar)) {
          avatars.push(u.avatar);
        }
      });
    }

    if (isImageUrl(activity.hostAvatar) && !avatars.includes(activity.hostAvatar)) {
      avatars.push(activity.hostAvatar);
    }

    if (avatars.length < countToShow && users) {
      Object.values(users).forEach(u => {
        if (isImageUrl(u.avatar) && !avatars.includes(u.avatar) && avatars.length < countToShow) {
          avatars.push(u.avatar);
        }
      });
    }

    return avatars.slice(0, countToShow);
  }, [activity.participants, activity.hostAvatar, users, goingCount]);

  return (
    <div className={styles.activityRow} onClick={onClick}>
      <div className={styles.activityRowIcon}>
        {isImageUrl(eventImage) ? (
          <img src={eventImage} alt={activity.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
        ) : (
          <div className={styles.activityFallbackIcon}>
            <Activity size={20} color="var(--color-primary)" />
          </div>
        )}
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
            <span className={styles.activityRowMetaItemLocation} title={activity.location}>
              <MapPin size={11} style={{ flexShrink: 0 }} />
              <span className={styles.locationText}>{activity.location}</span>
            </span>
          )}
          <span className={styles.goingContainer}>
            <span className={styles.goingAvatars}>
              {Array.from({ length: Math.min(3, goingCount) }).map((_, idx) => {
                const avatarUrl = goingAvatars[idx];
                return (
                  <span
                    key={idx}
                    className={styles.goingAvatarCircle}
                    style={{ zIndex: 10 - idx }}
                  >
                    {isImageUrl(avatarUrl) ? (
                      <img src={avatarUrl} alt="Going" />
                    ) : (
                      <span className={styles.goingAvatarFallback}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
            <span className={styles.goingText}>{goingCount} going</span>
          </span>
        </div>
      </div>
      <button
        className={`${styles.rowActionBtn} ${(isJoined || hasRequested) ? styles.rowActionBtnActive : ''}`}
        onClick={async (e) => {
          e.stopPropagation();
          if (hasRequested) return;
          if (isJoined) {
            const chatId = String(activity.id).startsWith('act_') ? activity.id : `act_${activity.id}`;
            navigate(`/messages/${chatId}`);
            return;
          }
          if (isApproval) {
            requestToJoinActivity(activity.id);
          } else {
            await joinCrewActivity(activity.id);
            setShowJoinedModal(true);
          }
        }}
      >
        {isJoined ? 'Joined' : hasRequested ? 'Requested' : isApproval ? 'Request' : 'Join'}
      </button>
      <ActivityJoinedModal
        isOpen={showJoinedModal}
        onClose={() => setShowJoinedModal(false)}
        activity={activity}
      />
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
        style={(!isImageUrl(comm.avatar)) ? (comm.color ? { background: comm.color } : { background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }) : { background: 'var(--color-bg-white)' }}
      >
        {isImageUrl(comm.avatar)
          ? <img src={comm.avatar} alt={comm.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
          : <span style={{ fontWeight: 700, color: '#FFFFFF' }}>{comm.avatar || comm.name?.charAt(0).toUpperCase()}</span>
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

// Person row in sidebar / full width
function PersonRow({ user }) {
  const { toggleFollow, currentUser, users } = useData();
  const navigate = useNavigate();
  // Always read from latest users state so button updates immediately
  const latestMe = users?.[currentUser?.username];
  const isFollowing = latestMe?.followingList?.includes(user.username);

  return (
    <div className={styles.personRow} onClick={() => navigate(`/profile/${user.username}`)}>
      <div className={styles.sidebarAvatar}>
        {isImageUrl(user.avatar)
          ? <img src={user.avatar} alt={user.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
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
          {user.bio || 'Student • Explorer'}
        </span>
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
    <PageLayout containerRef={containerRef}>
      <PageHeader
        title="Search"
        subtitle="Find people, activities, and communities ✨"
        backPath="/home"
        searchBar={<GlobalSearch variant="pageHeader" />}
        tabs={sections}
        activeTab={activeSection}
        onTabChange={setActiveSection}
        tabVariant="underline"
      />

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
                                ? <img src={author.avatar} alt={author.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                                : <DefaultAvatar />
                              }
                            </div>
                            <div className={styles.topPostInfo}>
                              <span className={styles.topPostName}>{author?.displayName || 'Someone'}</span>
                              <p className={styles.topPostText}>{post.text?.substring(0, 80)}{post.text?.length > 80 ? '...' : ''}</p>
                              <div className={styles.topPostMeta}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><ThumbsUp size={13} /> {post.likes || 0}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><MessageCircle size={13} /> {post.comments || 0}</span>
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
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)', width: '100%' }}>
                      <Skeleton type="circle" width="40px" height="40px" />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <Skeleton type="text" width="35%" height="1rem" />
                        <Skeleton type="text" width="60%" height="0.8rem" />
                      </div>
                      <Skeleton type="circle" width="32px" height="32px" />
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
                        if (r.type === 'user') return <PersonRow key={`top-u-${r.item.id}`} user={r.item} />;
                        if (r.type === 'community') return <CommunityRow key={`top-c-${r.item.id}`} comm={r.item} onClick={() => navigate(`/communities/${r.item.id}`)} />;
                        if (r.type === 'college') return <CollegeResult key={`top-col-${r.item.id}`} result={r} onClick={handleNavigate} />;
                        if (r.type === 'post') return <PostResult key={`top-p-${r.item.id}`} result={r} onClick={handleNavigate} />;
                        if (r.type === 'crew') return <ActivityRow key={`top-cr-${r.item.id}`} activity={r.item} onClick={() => navigate(`/crew/${r.item.id}`, { state: { activity: r.item } })} />;
                        return null;
                      })}
                    </div>
                  ) : <div className={styles.sectionEmpty}>No top matches for "{q}"</div>}
                </div>
              )}
              {activeSection === 'users' && (
                <div className={styles.resultsContainer}>
                  {results.users.length > 0
                    ? <div className={styles.list}>{results.users.map(r => <PersonRow key={`u-${r.item.id}`} user={r.item} />)}</div>
                    : <div className={styles.sectionEmpty}>No people for "{q}"</div>}
                </div>
              )}
              {activeSection === 'activities' && (
                <div className={styles.resultsContainer}>
                  {results.crew.length > 0
                    ? <div className={styles.list}>{results.crew.map(r => <ActivityRow key={`cr-${r.item.id}`} activity={r.item} onClick={() => navigate(`/crew/${r.item.id}`, { state: { activity: r.item } })} />)}</div>
                    : <div className={styles.sectionEmpty}>No activities for "{q}"</div>}
                </div>
              )}
              {activeSection === 'community' && (
                <div className={styles.resultsContainer}>
                  {results.communities.length > 0
                    ? <div className={styles.list}>{results.communities.map(r => <CommunityRow key={`c-${r.item.id}`} comm={r.item} onClick={() => navigate(`/communities/${r.item.id}`)} />)}</div>
                    : <div className={styles.sectionEmpty}>No communities for "{q}"</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
