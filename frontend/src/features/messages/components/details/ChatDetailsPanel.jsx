import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';

import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './ChatDetailsPanel.module.css';
import { Pin, Trash2, LogOut, ChevronRight, User, Search, Ban, UserPlus, Image as ImageIcon } from 'lucide-react';
import InviteModal from '../modals/InviteModal';
import SafetyNumberModal from '../modals/SafetyNumberModal';
import { showToast } from '@shared/utils/toast';

import ChatGalleryPage from './ChatGalleryPage';
import GroupChangeOwnerPage from './GroupChangeOwnerPage';
import GroupEditPage from './GroupEditPage';
import GroupSettingsPage from './GroupSettingsPage';
import { useData } from '@shared/hooks/useData';
import { toast } from 'sonner';
import { useR2Upload } from '@shared/hooks/useR2Upload';


export default function ChatDetailsPanel({ conversation, onBack, onBlockUser, onClearChat, onSearch }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { users, crewActivities, endCrewActivity, leaveGroup, updateGroupInfo, updateGroupEditPermission, updateGroupSettings, removeGroupMember, changeGroupOwner, promoteToAdmin, demoteFromAdmin, endGroup, acceptGroupJoinRequest, declineGroupJoinRequest } = useData();

  // General States
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmType, setConfirmType] = useState(''); // 'leaveGroup' | 'endActivity' | 'removeMember' | 'changeOwner' | 'endGroup'
  const [targetUserId, setTargetUserId] = useState(null);
  
  // Modal States
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  
  // Header Menu States
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // Member Menu States
  const [activeMemberMenu, setActiveMemberMenu] = useState(null);
  const memberMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
      if (memberMenuRef.current && !memberMenuRef.current.contains(event.target)) {
        setActiveMemberMenu(null);
      }
    };
    if (showMenu || activeMemberMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu, activeMemberMenu]);

  // Group Settings Edit States
  const [editName, setEditName] = useState(conversation.name || '');
  const [editDesc, setEditDesc] = useState(conversation.description || '');
  const [editAvatar, setEditAvatar] = useState(conversation.avatar || '');
  const fileInputRef = useRef(null);

  // Settings page states
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [showEditGroupPage, setShowEditGroupPage] = useState(false);
  const [showGalleryPage, setShowGalleryPage] = useState(false);
  const [showChangeOwnerPage, setShowChangeOwnerPage] = useState(false);
  const [groupUpdatesActive, setGroupUpdatesActive] = useState(conversation.groupUpdatesActive !== false);
  const [whoCanJoin, setWhoCanJoin] = useState(conversation.whoCanJoin || 'Anyone');
  const [visibility, setVisibility] = useState(() => {
    if (conversation.visibility) return conversation.visibility;
    if (conversation.id && String(conversation.id).startsWith('c_')) {
      const uniName = currentUser?.university || currentUser?.college?.name || 'your university';
      return `Visible only to ${uniName}`;
    }
    return 'Hidden group';
  });
  const [allowSharing, setAllowSharing] = useState(conversation.allowSharing !== false);
  const [editGroupPermission, setEditGroupPermission] = useState(conversation.editGroupPermission || 'Everyone');
  const [showImageSearch, setShowImageSearch] = useState(false);

  // Sync states when conversation updates or changes
  useEffect(() => {
    setEditName(conversation.name || '');
    setEditDesc(conversation.description || '');
    setEditAvatar(conversation.avatar || '');
    setWhoCanJoin(conversation.whoCanJoin || 'Anyone');
    setVisibility(
      conversation.visibility ||
      (conversation.id && String(conversation.id).startsWith('c_') ? 'Visible only to Gla University' : 'Hidden group')
    );
    setAllowSharing(conversation.allowSharing !== false);
    setShowEditGroupPage(false);
    setShowSettingsPage(false);
    setShowGalleryPage(false);
    setShowChangeOwnerPage(false);
  }, [conversation.id]);

  // Extract shared media from message history
  const mediaList = useMemo(() => {
    const list = [];
    if (conversation.messages && conversation.messages.length > 0) {
      conversation.messages.forEach(msg => {
        if (msg.text) {
          const urls = msg.text.match(/\bhttps?:\/\/\S+/gi) || [];
          urls.forEach(url => {
            const cleanUrl = url.split(/[?#]/)[0];
            const isImg = /\.(png|jpe?g|gif|webp)/i.test(cleanUrl) || url.includes('giphy.com') || url.includes('unsplash.com') || url.startsWith('data:image/');
            const isVid = /\.(mp4|mov|webm)/i.test(cleanUrl) || url.startsWith('data:video/');
            if (isImg) list.push({ type: 'image', url });
            else if (isVid) list.push({ type: 'video', url });
          });
        }
        if (msg.text && msg.text.startsWith('data:image/')) {
          list.push({ type: 'image', url: msg.text });
        } else if (msg.text && msg.text.startsWith('data:video/')) {
          list.push({ type: 'video', url: msg.text });
        }
        if (msg.linkPreview?.image) {
          list.push({ type: 'image', url: msg.linkPreview.image });
        }
      });
    }

    const seen = new Set();
    return list.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [conversation.messages]);

  if (!conversation) return null;

  // Determine chat type
  const isEventGroup = !!conversation.isActivityChat;
  const isGroup = !!conversation.isGroup && !isEventGroup;
  const isOneOnOne = !isGroup && !isEventGroup;

  // Fetch related activity if event group
  const activity = isEventGroup && conversation.activityId
    ? crewActivities.find(a => a.id === conversation.activityId)
    : null;

  const isHost = activity ? activity.hostId === currentUser?.id : false;
  const isOwner = conversation.ownerId === currentUser?.id || conversation.hostId === currentUser?.id || isHost;
  const isAdmin = isOwner || (conversation.admins || []).includes(currentUser?.id);
  const canEditGroupInfo = isAdmin || editGroupPermission === 'Everyone';
  const rawParticipants = conversation.members || conversation.participants || (activity ? activity.participants : []) || [];
  const memberIds = rawParticipants.map(p => p?.userId || p?.id || p);
  const isClosed = conversation.status === 'Closed';
  const isMember = isGroup ? memberIds.map(String).includes(String(currentUser?.id)) : true;

  // Formatted date for group creation
  const formattedDate = conversation.createdAt 
    ? new Date(conversation.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Recently';

  // Handlers
  const handleAvatarClick = () => {
    if (isAdmin) {
      setShowImageSearch(true);
    }
  };

  const { upload: uploadGroupIcon } = useR2Upload('group-icons');

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const publicUrl = await uploadGroupIcon(file);
        setEditAvatar(publicUrl);
      } catch {
        toast.error('Failed to upload avatar.');
      }
    }
    e.target.value = '';
  };

  const handleRemoveMember = (userId) => {
    setTargetUserId(userId);
    setConfirmType('removeMember');
    setShowConfirm(true);
  };

  const handleLeaveGroup = () => {
    setConfirmType('leaveGroup');
    setShowConfirm(true);
  };

  const handleEndActivity = () => {
    setConfirmType('endActivity');
    setShowConfirm(true);
  };

  const handleEndGroup = () => {
    setConfirmType('endGroup');
    setShowConfirm(true);
  };

  const handleConfirmAction = async () => {
    setShowConfirm(false);
    if (confirmType === 'leaveGroup') {
      await leaveGroup(conversation.id);
      onBack();
    } else if (confirmType === 'endGroup') {
      await endGroup(conversation.id);
    } else if (confirmType === 'endActivity' && activity) {
      await endCrewActivity(activity.id);
      onBack();
    } else if (confirmType === 'removeMember' && targetUserId) {
      await removeGroupMember(conversation.id, targetUserId);
      setTargetUserId(null);
    } else if (confirmType === 'changeOwner' && targetUserId) {
      await changeGroupOwner(conversation.id, targetUserId);
      setTargetUserId(null);
      setShowChangeOwnerPage(false);
      showToast('Owner changed successfully');
    }
  };

  const formatEventDateTime = () => {
    if (!activity) return '';
    try {
      const d = new Date(activity.date);
      if (isNaN(d.getTime())) return `${activity.date} • ${activity.time}`;
      const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (!activity.time) return dateFormatted;

      if (activity.endDate && activity.endTime) {
        const endD = new Date(activity.endDate);
        const endDateFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (dateFormatted === endDateFormatted) {
          return `${dateFormatted} • ${activity.time} - ${activity.endTime}`;
        } else {
          return `${dateFormatted} • ${activity.time} - ${endDateFormatted} • ${activity.endTime}`;
        }
      }

      // Fallback for old activities using duration
      let endTimeStr = '';
      if (activity.duration) {
        const match = activity.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const ampm = match[3].toUpperCase();
          if (ampm === 'PM' && h < 12) h += 12;
          if (ampm === 'AM' && h === 12) h = 0;

          let addHours = 0;
          if (activity.duration.includes('1 hour')) addHours = 1;
          else if (activity.duration.includes('2 hours')) addHours = 2;
          else if (activity.duration.includes('Half day')) addHours = 4;
          else if (activity.duration.includes('All day')) addHours = 8;
          else {
             const hrsMatch = activity.duration.match(/(\d+)/);
             if (hrsMatch) addHours = parseInt(hrsMatch[1], 10);
          }

          if (addHours > 0) {
            h += addHours;
            const endAmPm = h >= 12 && h < 24 ? 'PM' : 'AM';
            let endH = h % 12;
            if (endH === 0) endH = 12;
            const endMStr = m < 10 ? '0' + m : m;
            endTimeStr = ` - ${endH}:${endMStr} ${endAmPm}`;
          }
        }
      }

      return `${dateFormatted} • ${activity.time}${endTimeStr}`;
    } catch {
      return `${activity.date} • ${activity.time}`;
    }
  };

  // Find target user for one-on-one
  const targetUser = useMemo(() => {
    if (!isOneOnOne) return null;
    if (conversation.targetUser) return conversation.targetUser;
    const found = Object.values(users).find(u => 
      (conversation.username && u.username === conversation.username) || 
      (conversation.userId && u.id === conversation.userId) ||
      u.id === conversation.id
    );
    if (found) return found;
    return {
      id: conversation.id,
      name: conversation.name || 'User',
      displayName: conversation.name || 'User',
      username: conversation.name ? conversation.name.toLowerCase().replace(/\s+/g, '') : 'user',
      avatar: conversation.avatar || '',
      bio: conversation.bio || null,
      major: conversation.major || null,
      university: conversation.university || conversation.college || null
    };
  }, [isOneOnOne, conversation, users]);

  if (showGalleryPage) {
    return (
      <ChatGalleryPage
        mediaList={mediaList}
        onBack={() => setShowGalleryPage(false)}
      />
    );
  }

  if (showChangeOwnerPage) {
    return (
      <GroupChangeOwnerPage
        conversation={conversation}
        users={users}
        memberIds={memberIds}
        onBack={() => setShowChangeOwnerPage(false)}
        targetUserId={targetUserId}
        showConfirm={showConfirm}
        confirmType={confirmType}
        onSetConfirmTarget={(uid) => {
          setTargetUserId(uid);
          setConfirmType('changeOwner');
          setShowConfirm(true);
        }}
        onCancelConfirm={() => setShowConfirm(false)}
        onConfirmAction={handleConfirmAction}
      />
    );
  }

  if (showEditGroupPage) {
    return (
      <GroupEditPage
        conversation={conversation}
        editName={editName}
        setEditName={setEditName}
        editDesc={editDesc}
        setEditDesc={setEditDesc}
        editAvatar={editAvatar}
        setEditAvatar={setEditAvatar}
        isAdmin={isAdmin}
        isGroup={isGroup}
        isEventGroup={isEventGroup}
        fileInputRef={fileInputRef}
        showImageSearch={showImageSearch}
        setShowImageSearch={setShowImageSearch}
        onBack={() => {
          setEditName(conversation.name || '');
          setEditDesc(conversation.description || '');
          setEditAvatar(conversation.avatar || '');
          setShowEditGroupPage(false);
        }}
        onSave={() => {
          if (editName.trim()) {
            const nameChanged = editName.trim() !== conversation.name;
            const descChanged = editDesc.trim() !== (conversation.description || '');
            const avatarChanged = editAvatar !== (conversation.avatar || '');

            const changes = [];
            if (nameChanged) changes.push('group name');
            if (avatarChanged) changes.push('avatar');
            if (descChanged) changes.push('description');

            if (changes.length > 0) {
              let toastMsg = '';
              if (changes.length === 1) {
                toastMsg = `Updated ${changes[0]}`;
              } else if (changes.length === 2) {
                toastMsg = `Updated ${changes[0]} and ${changes[1]}`;
              } else {
                toastMsg = 'Updated group info';
              }
              showToast(toastMsg);
            }

            updateGroupInfo(conversation.id, editName.trim(), editAvatar, editDesc.trim());
          }
          setShowEditGroupPage(false);
        }}
        handleAvatarClick={handleAvatarClick}
        handleFileChange={handleFileChange}
      />
    );
  }

  if (showSettingsPage) {
    return (
      <GroupSettingsPage
        conversation={conversation}
        groupUpdatesActive={groupUpdatesActive}
        setGroupUpdatesActive={setGroupUpdatesActive}
        whoCanJoin={whoCanJoin}
        setWhoCanJoin={setWhoCanJoin}
        visibility={visibility}
        setVisibility={setVisibility}
        allowSharing={allowSharing}
        setAllowSharing={setAllowSharing}
        editGroupPermission={editGroupPermission}
        setEditGroupPermission={setEditGroupPermission}
        isAdmin={isAdmin}
        isOwner={isOwner}
        isEventGroup={isEventGroup}
        isGroup={isGroup}
        activity={activity}
        users={users}
        memberIds={memberIds}
        targetUserId={targetUserId}
        showConfirm={showConfirm}
        confirmType={confirmType}
        onBack={() => setShowSettingsPage(false)}
        onShowChangeOwnerPage={() => setShowChangeOwnerPage(true)}
        onSetConfirmTarget={(uid, type) => {
          setTargetUserId(uid);
          setConfirmType(type);
          setShowConfirm(true);
        }}
        onCancelConfirm={() => setShowConfirm(false)}
        onConfirmAction={handleConfirmAction}
        handleLeaveGroup={handleLeaveGroup}
        handleEndActivity={handleEndActivity}
        handleEndGroup={handleEndGroup}
      />
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} title="Back to Chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <h2 className={styles.headerTitle}>
          {isOneOnOne ? 'Chat Details' : isEventGroup ? 'Activity Details' : 'Group Info'}
        </h2>
        <div className={styles.headerRight}>
          {isEventGroup && (
            <div className={styles.menuContainer} ref={menuRef}>
              <button 
                type="button"
                className={styles.moreBtn} 
                onClick={() => setShowMenu(!showMenu)}
                title="Options"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="12" cy="5" r="1"></circle>
                  <circle cx="12" cy="19" r="1"></circle>
                </svg>
              </button>
              {showMenu && (
                <div className={styles.dropdownMenu}>
                  <button type="button" className={styles.dropdownItem} onClick={() => { alert('Group pinned.'); setShowMenu(false); }}>
                    <Pin size={15} />
                    <span>Pin Group</span>
                  </button>
                  <button type="button" className={styles.dropdownItem} onClick={() => { if (onClearChat) onClearChat(); setShowMenu(false); onBack(); }}>
                    <Trash2 size={15} />
                    <span>Clear Chat History</span>
                  </button>
                  {!isClosed && (
                    isHost ? (
                      <button type="button" className={`${styles.dropdownItem} ${styles.dangerItem}`} onClick={() => { handleEndActivity(); setShowMenu(false); }}>
                        <LogOut size={15} />
                        <span>End Group</span>
                      </button>
                    ) : (
                      <button type="button" className={`${styles.dropdownItem} ${styles.dangerItem}`} onClick={() => { handleLeaveGroup(); setShowMenu(false); }}>
                        <LogOut size={15} />
                        <span>Leave Group</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          )}
          {!isEventGroup && <div style={{ width: '40px' }} />}
        </div>
      </div>

      <div className={styles.scrollBody} key="details-scroll">
        {/* Large Avatar Block */}
        <div className={styles.avatarSection}>
          {isEventGroup ? (
            <Avatar
              src={conversation.avatar}
              name={conversation.name}
              size="120px"
              isGroup={true}
            />
          ) : (
            <Avatar
              src={conversation.avatar || targetUser?.avatar}
              name={conversation.name || targetUser?.displayName}
              size="120px"
              isGroup={isGroup}
              onClick={!isClosed && isMember ? handleAvatarClick : undefined}
              disableHover={isClosed || !isMember}
              className={`${isGroup && isAdmin && !isClosed && isMember ? styles.avatarWrapperClickable : ''}`}
            >
              {isGroup && isAdmin && !isClosed && isMember && (
                <div className={styles.avatarOverlay}>Change Photo</div>
              )}
            </Avatar>
          )}
          
          <h1 className={styles.primaryName}>
            {isOneOnOne && targetUser ? (targetUser.displayName || targetUser.name || conversation.name) : conversation.name}
            {isClosed && <span style={{ marginLeft: '10px', fontSize: '0.85rem', backgroundColor: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '12px', verticalAlign: 'middle', fontWeight: 'bold' }}>Closed</span>}
          </h1>

          {isOneOnOne && targetUser && (
            <>
              <div className={styles.secondaryName}>@{targetUser.username}</div>
              <div className={styles.actionButtonsRow}>
                <div className={styles.actionIconContainer}>
                  <button
                    type="button"
                    className={styles.actionIconButton}
                    onClick={() => navigate(`/profile/${targetUser.username}`)}
                    title="View Profile"
                  >
                    <User size={24} />
                  </button>
                  <span className={styles.actionIconLabel}>Profile</span>
                </div>

                <div className={styles.actionIconContainer}>
                  <button
                    type="button"
                    className={styles.actionIconButton}
                    onClick={() => {
                      if (onSearch) onSearch();
                    }}
                    title="Search Messages"
                  >
                    <Search size={24} />
                  </button>
                  <span className={styles.actionIconLabel}>Search</span>
                </div>

                <div className={styles.actionIconContainer}>
                  <button
                    type="button"
                    className={`${styles.actionIconButton} ${conversation.blocked ? styles.blockedBtn : ''}`}
                    onClick={() => {
                      if (onBlockUser) {
                        onBlockUser();
                        onBack();
                      }
                    }}
                    title={conversation.blocked ? "Unblock Contact" : "Block Contact"}
                  >
                    <Ban size={24} />
                  </button>
                  <span className={`${styles.actionIconLabel} ${conversation.blocked ? styles.blockedLabel : ''}`}>
                    {conversation.blocked ? 'Unblock' : 'Block'}
                  </span>
                </div>
              </div>
            </>
          )}

          {isGroup && !isClosed && (
            <div className={styles.actionButtonsRow}>
              <div className={styles.actionIconContainer}>
                <button
                  type="button"
                  className={styles.actionIconButton}
                  onClick={() => setShowInviteModal(true)}
                  title="Invite"
                >
                  <UserPlus size={24} />
                </button>
                <span className={styles.actionIconLabel}>Invite</span>
              </div>

              <div className={styles.actionIconContainer}>
                <button
                  type="button"
                  className={styles.actionIconButton}
                  onClick={() => {
                    if (onSearch) onSearch();
                  }}
                  title="Search Messages"
                >
                  <Search size={24} />
                </button>
                <span className={styles.actionIconLabel}>Search</span>
              </div>
            </div>
          )}

          {isEventGroup && activity && (
            <div className={styles.eventInfoRow}>
              {(activity.date || activity.dateLabel) && (
                <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
              )}
              <div className={styles.eventDateTime}>{formatEventDateTime()}</div>
            </div>
          )}
        </div>

        {/* Dynamic Details depending on style */}

        {/* 1. ONE-ON-ONE CHAT DETAILS */}
        {isOneOnOne && targetUser && (
          <div className={styles.detailsList}>
            {targetUser.bio && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Bio</h3>
                <p className={styles.sectionValue}>{targetUser.bio}</p>
              </div>
            )}

            {(targetUser.university || targetUser.college) && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>College</h3>
                <p className={styles.sectionValue}>{typeof (targetUser.university || targetUser.college) === 'object' ? (targetUser.college?.name || targetUser.university?.name) : (targetUser.university || targetUser.college)}</p>
              </div>
            )}

            {targetUser.major && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Major</h3>
                <p className={styles.sectionValue}>{targetUser.major}</p>
              </div>
            )}

            {/* End-to-End Encryption Section */}
            <div className={styles.section} style={{ marginTop: '1rem' }}>
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  cursor: 'pointer'
                }}
                onClick={() => setShowSafetyModal(true)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ color: '#10b981' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>End-to-End Encrypted</h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Click to verify safety numbers
                    </p>
                  </div>
                </div>
                <ChevronRight size={20} color="var(--text-secondary)" />
              </div>
            </div>

            {/* Gallery Section */}
            <div className={styles.galleryCard}>
              <div className={styles.galleryHeader} onClick={() => setShowGalleryPage(true)}>
                <span className={styles.galleryTitle}>Gallery</span>
                <ChevronRight className={styles.galleryChevron} size={20} />
              </div>
              {mediaList && mediaList.length > 0 ? (
                <div className={styles.galleryRow}>
                  {mediaList.map((item, idx) => (
                    <div key={idx} className={styles.galleryThumbnail} onClick={() => setShowGalleryPage(true)}>
                      {item.type === 'video' ? (
                        <div className={styles.videoGridWrapper} style={{ width: '100%', height: '100%' }}>
                          <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <div className={styles.playBadge}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                          </div>
                        </div>
                      ) : (
                        <img src={item.url} alt="" className={styles.galleryThumbImg} />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.noMediaContainer}>
                  <ImageIcon size={18} className={styles.noMediaIcon} />
                  <span>No media</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. GROUP CHAT DETAILS */}
        {isGroup && (
          <div className={styles.detailsList}>
            {conversation.description && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Description</h3>
                <p className={styles.sectionValue}>{conversation.description}</p>
              </div>
            )}

            {/* Gallery Section */}
            <div className={styles.galleryCard}>
              <div className={styles.galleryHeader} onClick={() => setShowGalleryPage(true)}>
                <span className={styles.galleryTitle}>Gallery</span>
                <ChevronRight className={styles.galleryChevron} size={20} />
              </div>
              {mediaList && mediaList.length > 0 ? (
                <div className={styles.galleryRow}>
                  {mediaList.map((item, idx) => (
                    <div key={idx} className={styles.galleryThumbnail} onClick={() => setShowGalleryPage(true)}>
                      {item.type === 'video' ? (
                        <div className={styles.videoGridWrapper} style={{ width: '100%', height: '100%' }}>
                          <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <div className={styles.playBadge}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                          </div>
                        </div>
                      ) : (
                        <img src={item.url} alt="" className={styles.galleryThumbImg} />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.noMediaContainer}>
                  <ImageIcon size={18} className={styles.noMediaIcon} />
                  <span>No media</span>
                </div>
              )}
            </div>

            {isMember && (
              <button
                type="button"
                className={styles.settingsBtn}
                onClick={() => setShowSettingsPage(true)}
                style={{ marginBottom: '1.25rem' }}
              >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Group Settings</span>
              </button>
            )}

            {/* Join Requests */}
            {isAdmin && conversation.pendingRequests && conversation.pendingRequests.length > 0 && (
              <div className={styles.section} style={{ borderColor: 'var(--color-primary)' }}>
                <h3 className={styles.sectionTitle} style={{ color: 'var(--color-primary)' }}>Join Requests ({conversation.pendingRequests.length})</h3>
                <div className={styles.memberList}>
                  {conversation.pendingRequests.map(uid => {
                    const userObj = Object.values(users).find(u => u.id === uid);
                    if (!userObj) return null;
                    
                    return (
                      <div key={uid} className={styles.memberItem}>
                        <Link to={`/profile/${userObj.username}`} className={styles.memberLink}>
                          <Avatar 
                            src={userObj.avatar} 
                            name={userObj.name} 
                            size="38px" 
                          />
                          <div className={styles.memberMeta}>
                            <span className={styles.memberName}>{userObj.displayName || userObj.name}</span>
                            <span className={styles.memberUsername}>@{userObj.username}</span>
                          </div>
                        </Link>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className={styles.saveHeaderBtn}
                            style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', marginTop: 0 }}
                            onClick={() => acceptGroupJoinRequest(conversation.id, uid)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className={styles.cancelBtn}
                            style={{ margin: 0, padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}
                            onClick={() => declineGroupJoinRequest(conversation.id, uid)}
                          >
                            Ignore
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Members ({memberIds.length})</h3>
              <div className={styles.memberList}>
                {memberIds.map(uid => {
                  const userObj = Object.values(users).find(u => u.id === uid);
                  if (!userObj) return null;
                  
                  const isUserOwner = uid === conversation.ownerId || (activity && uid === activity.hostId);
                  const isUserAdmin = (conversation.admins || []).includes(uid);
                  
                  const canPromote = isOwner && !isUserOwner && !isUserAdmin;
                  const canDemote = isOwner && isUserAdmin;
                  const canRemove = isAdmin && uid !== currentUser?.id && !isUserOwner && (isOwner || !isUserAdmin);
                  const hasActions = (canPromote || canDemote || canRemove) && !isClosed && isMember;
                  
                  return (
                    <div key={uid} className={styles.memberItem}>
                      <Link to={`/profile/${userObj.username}`} className={styles.memberLink}>
                        <Avatar 
                          src={userObj.avatar} 
                          name={userObj.name} 
                          size="38px" 
                        />
                        <div className={styles.memberMeta}>
                          <span className={styles.memberName}>{userObj.displayName || userObj.name}</span>
                          <span className={styles.memberUsername}>@{userObj.username}</span>
                        </div>
                      </Link>

                      <div className={styles.memberRight}>
                        {isUserOwner && <span className={styles.roleTag}>Owner</span>}
                        {isUserAdmin && <span className={styles.roleTag} style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>Admin</span>}
                        
                        {hasActions && (
                          <div className={styles.menuContainer} ref={activeMemberMenu === uid ? memberMenuRef : null}>
                            <button 
                              className={styles.moreBtn}
                              style={{ marginLeft: '4px' }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveMemberMenu(activeMemberMenu === uid ? null : uid);
                              }}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="1"></circle>
                                <circle cx="12" cy="5" r="1"></circle>
                                <circle cx="12" cy="19" r="1"></circle>
                              </svg>
                            </button>
                            {activeMemberMenu === uid && (
                              <div className={styles.dropdownMenu} style={{ top: '100%', right: '0' }}>
                                {canPromote && (
                                  <button 
                                    className={styles.dropdownItem}
                                    onClick={() => {
                                      promoteToAdmin(conversation.id, uid);
                                      setActiveMemberMenu(null);
                                    }}
                                  >
                                    Promote to Admin
                                  </button>
                                )}
                                {canDemote && (
                                  <button 
                                    className={styles.dropdownItem}
                                    onClick={() => {
                                      demoteFromAdmin(conversation.id, uid);
                                      setActiveMemberMenu(null);
                                    }}
                                  >
                                    Demote to Member
                                  </button>
                                )}
                                {canRemove && (
                                  <button 
                                    className={styles.dropdownItem}
                                    style={{ color: '#ef4444' }}
                                    onClick={() => {
                                      handleRemoveMember(uid);
                                      setActiveMemberMenu(null);
                                    }}
                                  >
                                    Remove from Group
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {!isClosed && isMember && (
              <div className={styles.actionSection}>
                {isOwner ? (
                  <button 
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={handleEndGroup}
                  >
                    End Group
                  </button>
                ) : (
                  <button 
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={handleLeaveGroup}
                  >
                    Leave Group
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 3. EVENT GROUP DETAILS */}
        {isEventGroup && activity && (
          <div className={styles.detailsList}>
            {(conversation.description || activity.description) && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Description</h3>
                <p className={styles.sectionValue}>{conversation.description || activity.description}</p>
              </div>
            )}

            {/* Gallery Section */}
            <div className={styles.galleryCard}>
              <div className={styles.galleryHeader} onClick={() => setShowGalleryPage(true)}>
                <span className={styles.galleryTitle}>Gallery</span>
                <ChevronRight className={styles.galleryChevron} size={20} />
              </div>
              <div className={styles.galleryRow}>
                {mediaList.map((item, idx) => (
                  <div key={idx} className={styles.galleryThumbnail} onClick={() => setShowGalleryPage(true)}>
                    {item.type === 'video' ? (
                      <div className={styles.videoGridWrapper} style={{ width: '100%', height: '100%' }}>
                        <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div className={styles.playBadge}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        </div>
                      </div>
                    ) : (
                      <img src={item.url} alt="" className={styles.galleryThumbImg} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {isHost && (
              <button
                type="button"
                className={styles.settingsBtn}
                onClick={() => setShowSettingsPage(true)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Edit Group Settings</span>
              </button>
            )}

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Members ({memberIds.length})</h3>
              <div className={styles.memberList}>
                {memberIds.map(uid => {
                  const userObj = Object.values(users).find(u => u.id === uid);
                  if (!userObj) return null;
                  
                  const isActivityHost = uid === activity.hostId;
                  
                  return (
                    <div key={uid} className={styles.memberItem}>
                      <Link to={`/profile/${userObj.username}`} className={styles.memberLink}>
                        <Avatar 
                          src={userObj.avatar} 
                          name={userObj.name} 
                          size="38px" 
                        />
                        <div className={styles.memberMeta}>
                          <span className={styles.memberName}>{userObj.displayName || userObj.name}</span>
                          <span className={styles.memberUsername}>@{userObj.username}</span>
                        </div>
                      </Link>

                      <div className={styles.memberRight}>
                        {isActivityHost && <span className={styles.roleTag}>Owner</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {isGroup && (
          <div className={styles.dateInfo}>Created on {formattedDate}</div>
        )}
      </div>

      <ConfirmModal
        title={
          confirmType === 'endGroup' ? 'End Group?' :
          confirmType === 'leaveGroup' ? 'Leave Group' : 
          confirmType === 'endActivity' ? 'End Activity' : 
          confirmType === 'changeOwner' ? 'Change Group Owner?' :
          'Remove Member'
        }
        desc={
          confirmType === 'endGroup' ? 'This group will be closed permanently. Previous chats and media will remain accessible.' :
          confirmType === 'leaveGroup' ? 'Are you sure you want to leave this group?' : 
          confirmType === 'endActivity' ? 'Are you sure you want to end this activity? This will remove all members.' : 
          confirmType === 'changeOwner' ? `Ownership of this group will be transferred to ${(Object.values(users).find(u => u.id === targetUserId)?.displayName || Object.values(users).find(u => u.id === targetUserId)?.name || 'This member')}.` :
          'Are you sure you want to remove this member from the group?'
        }
        visible={showConfirm}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmAction}
        confirmText={
          confirmType === 'endGroup' ? 'End Group' :
          confirmType === 'leaveGroup' ? 'Leave' : 
          confirmType === 'endActivity' ? 'End' : 
          confirmType === 'changeOwner' ? 'Change Owner' :
          'Remove'
        }
      />
      
      <InviteModal 
        isOpen={showInviteModal} 
        onClose={() => setShowInviteModal(false)} 
        group={conversation} 
      />

      <SafetyNumberModal
        isOpen={showSafetyModal}
        onClose={() => setShowSafetyModal(false)}
        targetUser={targetUser}
      />
    </div>
  );
}
