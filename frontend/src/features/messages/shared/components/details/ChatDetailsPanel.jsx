import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';

import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './ChatDetailsPanel.module.css';
import sidebarStyles from '../sidebar/ConversationList.module.css';
import { Pin, Trash2, LogOut, ChevronRight, User, Search, Ban, UserPlus, UserCheck, Check, X, Image as ImageIcon, CalendarDays, Calendar, CalendarX, ArrowLeft, MoreVertical } from 'lucide-react';
import InviteModal from '../modals/InviteModal';
import SafetyNumberModal from '../modals/SafetyNumberModal';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import { showToast } from '@shared/utils/toast';

import ChatGalleryPage from './ChatGalleryPage';
import GroupChangeOwnerPage from './GroupChangeOwnerPage';
import GroupEditPage from './GroupEditPage';
import GroupSettingsPage from './GroupSettingsPage';
import GroupJoinRequestsPage from './GroupJoinRequestsPage';
import { useData } from '@shared/hooks/useData';
import { toast } from 'sonner';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import { commitDraftImage } from '@shared/utils/draftImageCache';
import { sortGroupMembers } from '@shared/utils/memberSort';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';

export default function ChatDetailsPanel({ conversation, onBack, onBlockUser, onClearChat, onSearch, onLeaveActivity }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { users, crewActivities, endCrewActivity, leaveGroup, updateGroupInfo, updateGroupEditPermission, updateGroupSettings, removeGroupMember, changeGroupOwner, promoteToAdmin, demoteFromAdmin, endGroup, acceptGroupJoinRequest, declineGroupJoinRequest, togglePinConversation } = useData();

  // General States
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmType, setConfirmType] = useState(''); // 'leaveGroup' | 'endActivity' | 'removeMember' | 'changeOwner' | 'endGroup'
  const [targetUserId, setTargetUserId] = useState(null);
  
  // Modal States
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [reportUserTarget, setReportUserTarget] = useState(null);
  
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
  const [showRequestsPage, setShowRequestsPage] = useState(false);
  const [groupUpdatesActive, setGroupUpdatesActive] = useState(conversation.groupUpdatesActive !== false);
  const [whoCanJoin, setWhoCanJoin] = useState(conversation.whoCanJoin || 'ANYONE');
  const [visibility, setVisibility] = useState(() => {
    if (conversation.visibility) return conversation.visibility;
    if (conversation.id && String(conversation.id).startsWith('c_')) {
      return 'COLLEGE';
    }
    return 'HIDDEN';
  });
  const [allowSharing, setAllowSharing] = useState(conversation.allowSharing !== false);
  const [editGroupPermission, setEditGroupPermission] = useState(conversation.editGroupPermission || 'ADMIN');
  const [showImageSearch, setShowImageSearch] = useState(false);

  useEffect(() => {
    setEditName(conversation.name || '');
    setEditDesc(conversation.description || '');
    setEditAvatar(conversation.avatar || conversation.avatarKey || '');
    setWhoCanJoin(conversation.whoCanJoin || 'ANYONE');
    setVisibility(
      conversation.visibility ||
      (conversation.id && String(conversation.id).startsWith('c_') ? 'COLLEGE' : 'HIDDEN')
    );
    setAllowSharing(conversation.allowSharing !== false);
    setEditGroupPermission(conversation.editGroupPermission || 'ADMIN');
    setGroupUpdatesActive(conversation.groupUpdatesActive !== false);
  }, [conversation.id, conversation.name, conversation.description, conversation.avatar, conversation.avatarKey, conversation.whoCanJoin, conversation.visibility, conversation.allowSharing, conversation.editGroupPermission, conversation.groupUpdatesActive]);

  useEffect(() => {
    setShowEditGroupPage(false);
    setShowSettingsPage(false);
    setShowGalleryPage(false);
    setShowChangeOwnerPage(false);
    setShowRequestsPage(false);
  }, [conversation.id]);

  const queryClient = useQueryClient();

  // Extract shared media from message history (ONLY images and videos, EXCLUDING voice notes/audio)
  const mediaList = useMemo(() => {
    const list = [];
    const keys = [conversation?.id, conversation?.publicId, conversation?.internalId].filter(Boolean);
    let cachedMessages = [];
    for (const key of keys) {
      const qData = queryClient.getQueryData(['messages', key]);
      if (qData?.pages) {
        cachedMessages = qData.pages.flatMap(p => p?.messages || []);
        if (cachedMessages.length > 0) break;
      }
    }
    const messages = cachedMessages.length > 0 ? cachedMessages : (conversation?.messages || []);

    messages.forEach(msg => {
      const text = msg.text || msg.payload?.text || '';
      const mediaUrl = msg.mediaUrl || msg.payload?.mediaUrl || (msg.type === 'media' ? (msg.text || msg.payload?.text) : null) || '';
      const mediaType = (msg.mediaType || msg.payload?.mediaType || msg.type || '').toLowerCase();
      const createdAt = msg.createdAt || msg.timestamp || new Date();

      // Skip voice notes & audio files completely
      const isAudio = (
        mediaType.includes('audio') || 
        mediaType.includes('voice') || 
        msg.type === 'voice' || 
        msg.type === 'VOICE' || 
        msg.isVoiceNote ||
        /\.(mp3|wav|ogg|m4a|aac|flac)/i.test(mediaUrl) ||
        mediaUrl.startsWith('data:audio/')
      );
      if (isAudio) return;

      // Direct media attachments (uploaded image/video in chat)
      if (mediaUrl && typeof mediaUrl === 'string') {
        const isVid = mediaType.includes('video') || /\.(mp4|mov|mkv)/i.test(mediaUrl) || mediaUrl.startsWith('data:video/');
        const isImg = mediaType.includes('image') || /\.(png|jpe?g|gif|webp|svg)/i.test(mediaUrl) || mediaUrl.startsWith('data:image/');
        if (isVid) list.push({ type: 'video', url: mediaUrl, createdAt: new Date(createdAt).getTime() });
        else if (isImg) list.push({ type: 'image', url: mediaUrl, createdAt: new Date(createdAt).getTime() });
      }

      // Embedded links & data URLs in text
      if (text && typeof text === 'string') {
        const urls = text.match(/\bhttps?:\/\/\S+/gi) || [];
        urls.forEach(url => {
          const cleanUrl = url.split(/[?#]/)[0];
          const isImg = /\.(png|jpe?g|gif|webp)/i.test(cleanUrl) || url.includes('giphy.com') || url.includes('unsplash.com') || url.startsWith('data:image/');
          const isVid = /\.(mp4|mov)/i.test(cleanUrl) || url.startsWith('data:video/');
          if (isImg) list.push({ type: 'image', url, createdAt: new Date(createdAt).getTime() });
          else if (isVid) list.push({ type: 'video', url, createdAt: new Date(createdAt).getTime() });
        });

        if (text.startsWith('data:image/')) {
          list.push({ type: 'image', url: text, createdAt: new Date(createdAt).getTime() });
        } else if (text.startsWith('data:video/')) {
          list.push({ type: 'video', url: text, createdAt: new Date(createdAt).getTime() });
        }
      }

      // Link previews
      if (msg.linkPreview?.image) {
        list.push({ type: 'image', url: msg.linkPreview.image, createdAt: new Date(createdAt).getTime() });
      }
    });

    const seen = new Set();
    const uniqueList = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!seen.has(item.url)) {
        seen.add(item.url);
        uniqueList.push(item);
      }
    }

    // Sort LATEST FIRST (most recent media items first)
    return uniqueList.sort((a, b) => b.createdAt - a.createdAt);
  }, [conversation?.messages]);

  if (!conversation) return null;

  // Determine chat type
  const isEventGroup = !!conversation.isActivityChat || !!conversation.activityId || String(conversation.id).startsWith('act_');
  const isGroup = conversation.type === 'GROUP' || conversation.type === 'ACTIVITY' || !!conversation.isGroup || isEventGroup;
  const isOneOnOne = !isGroup;

  // Fetch related activity if event group
  const activity = isEventGroup && (conversation.activityId || String(conversation.id).replace(/^act_/, ''))
    ? crewActivities.find(a => a.id === (conversation.activityId || String(conversation.id).replace(/^act_/, '')))
    : null;

  const actStatus = (activity?.status || conversation.activity?.status || conversation.status || '').toUpperCase();
  const isEnded = actStatus === 'ENDED' || actStatus === 'CLOSED' || actStatus === 'COMPLETED' || actStatus === 'CANCELLED';
  const actDate = conversation.startDate || conversation.date || activity?.startDate || activity?.date || conversation.activity?.startDate;

  const isHost = activity ? activity.creatorId === currentUser?.id || activity.hostId === currentUser?.id : false;
  const activityHasStarted = activity
    ? (() => {
        const startRaw = activity.startDate || activity.date;
        if (!startRaw) return false;
        return new Date(startRaw) <= new Date();
      })()
    : false;

  const { data: groupDetails } = useQuery({
    queryKey: ['groupDetails', conversation?.id || conversation?.publicId],
    queryFn: async () => {
      const idToFetch = conversation.id || conversation.publicId;
      if (!idToFetch) return null;
      return await groupApi.getDetails(idToFetch);
    },
    enabled: Boolean(isGroup && (conversation?.id || conversation?.publicId)),
    staleTime: 1000 * 60 * 5, // 5 mins
  });

  const memberMap = useMemo(() => {
    if (!groupDetails?.memberDetails) return {};
    return groupDetails.memberDetails.reduce((acc, m) => {
      acc[m.userId] = m;
      return acc;
    }, {});
  }, [groupDetails]);

  // Derived Values

  const myRole = isGroup
    ? (memberMap[currentUser?.id]?.role || (conversation.ownerId === currentUser?.id || conversation.hostId === currentUser?.id ? 'OWNER' : ((conversation.admins || []).includes(currentUser?.id) ? 'ADMIN' : (conversation.isMember !== false ? 'MEMBER' : null))))
    : null;
  const isOwner = isGroup
    ? (myRole === 'OWNER' || conversation.ownerId === currentUser?.id || conversation.hostId === currentUser?.id)
    : (conversation.hostId === currentUser?.id);
  const isAdmin = isGroup
    ? (isOwner || myRole === 'ADMIN' || (conversation.admins || []).includes(currentUser?.id))
    : isOwner;
  const isMember = isGroup ? (conversation.isMember !== false && Boolean(memberMap[currentUser?.id] || conversation.isMember || isOwner || isAdmin)) : true;
  const isClosed = conversation.status === 'Closed';
  const canEditGroupInfo = isAdmin || (editGroupPermission || '').toUpperCase() === 'EVERYONE';
  const rawParticipants = isGroup ? (groupDetails?.memberDetails || []) : (conversation.members || conversation.participants || (activity ? activity.participants : []) || []);
  const sortedParticipants = useMemo(() => {
    return sortGroupMembers(rawParticipants, {
      ownerId: isGroup ? groupDetails?.ownerId : conversation.ownerId,
      hostId: conversation.hostId || (activity ? activity.hostId : null),
      admins: isGroup ? groupDetails?.admins : conversation.admins,
      users
    });
  }, [rawParticipants, isGroup, groupDetails?.ownerId, groupDetails?.admins, conversation.ownerId, conversation.hostId, activity, conversation.admins, users]);
  const memberIds = sortedParticipants.map(p => p?.userId || p?.id || (typeof p === 'string' ? p : ''));

  // Formatted date for group creation
  const formattedDate = conversation.createdAt 
    ? new Date(conversation.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Recently';

  // Handlers
  const handleAvatarClick = () => {
    if (canEditGroupInfo) {
      setShowImageSearch(true);
    }
  };



  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const originalAvatar = conversation.avatarKey || conversation.avatar || '';
      const tempUrl = URL.createObjectURL(file);
      setEditAvatar(tempUrl);
      
      // Optimistically update the cache without waiting
      updateGroupInfo(conversation.id, undefined, tempUrl, undefined, originalAvatar);

      // Perform heavy compression and upload in the background
      (async () => {
        try {
          const { publicUrl } = await processAndUploadImage(file, 'avatars', { maxWidthOrHeight: 512 });
          setEditAvatar(publicUrl);
          await updateGroupInfo(conversation.id, undefined, publicUrl, undefined, originalAvatar);
        } catch {
          showToast('Failed to upload avatar');
          setEditAvatar(originalAvatar);
          updateGroupInfo(conversation.id, undefined, originalAvatar, undefined);
        }
      })();
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
      // For activity chats: if activity already started, stay in read-only view.
      // If not started yet, leaving removes the person from the group entirely → go back.
      if (!isEventGroup || !activityHasStarted) {
        onBack();
      }
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

  if (showRequestsPage) {
    return (
      <GroupJoinRequestsPage
        conversation={conversation}
        pendingRequests={conversation.pendingRequests || []}
        users={users}
        onAccept={(reqUserId) => acceptGroupJoinRequest(conversation.id, reqUserId)}
        onReject={(reqUserId) => declineGroupJoinRequest(conversation.id, reqUserId)}
        onBack={() => setShowRequestsPage(false)}
      />
    );
  }

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
        isUploadingAvatar={isUploadingAvatar}
        isAdmin={isAdmin}
        canEditGroupInfo={canEditGroupInfo}
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
        onSave={async () => {
          const trimmedName = editName.trim();
          if (!trimmedName) return;

          const nameChanged = trimmedName !== conversation.name;
          const descChanged = editDesc.trim() !== (conversation.description || '');
          const originalAvatar = conversation.avatar || conversation.avatarKey || '';
          
          const isBlob = typeof editAvatar === 'string' && editAvatar.startsWith('blob:');
          const avatarChanged = editAvatar && (isBlob || editAvatar !== originalAvatar);

          if (!nameChanged && !descChanged && !avatarChanged) {
            setShowEditGroupPage(false);
            return;
          }

          setIsUploadingAvatar(true);
          let finalAvatarUrl = isBlob ? undefined : (editAvatar || undefined);

          try {
            if (isBlob) {
              const uploadedUrl = await commitDraftImage(editAvatar, 'avatars');
              if (uploadedUrl) {
                finalAvatarUrl = uploadedUrl;
              }
            }

            await updateGroupInfo(
              conversation.id,
              nameChanged ? trimmedName : undefined,
              finalAvatarUrl,
              descChanged ? editDesc.trim() : undefined
            );
            const changes = [];
            if (nameChanged) changes.push('group name');
            if (avatarChanged) changes.push('avatar');
            if (descChanged) changes.push('description');

            if (changes.length > 0) {
              const toastMsg = changes.length === 1 
                ? `Updated ${changes[0]}` 
                : (changes.length === 2 ? `Updated ${changes[0]} and ${changes[1]}` : 'Updated group info');
              showToast(toastMsg);
            }
          } catch (err) {
            showToast('Failed to update group info');
          } finally {
            setIsUploadingAvatar(false);
            setShowEditGroupPage(false);
          }
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
        isMember={isMember}
        isClosed={isClosed}
        canEditGroupInfo={canEditGroupInfo}
        isEventGroup={isEventGroup}
        isGroup={isGroup}
        activity={activity}
        activityHasStarted={activityHasStarted}
        users={users}
        memberIds={memberIds}
        targetUserId={targetUserId}
        showConfirm={showConfirm}
        confirmType={confirmType}
        updateGroupSettings={updateGroupSettings}
        updateGroupEditPermission={updateGroupEditPermission}
        onBack={() => setShowSettingsPage(false)}
        onGoToEdit={() => setShowEditGroupPage(true)}
        onGoToChangeOwner={() => setShowChangeOwnerPage(true)}
        onSetConfirmTarget={(uid, type) => {
          setTargetUserId(uid);
          setConfirmType(type);
          setShowConfirm(true);
        }}
        onCancelConfirm={() => setShowConfirm(false)}
        onConfirmAction={handleConfirmAction}
        handleLeaveGroup={isEventGroup && onLeaveActivity ? onLeaveActivity : handleLeaveGroup}
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
          <ArrowLeft size={20} />
        </button>
        <h2 className={styles.headerTitle}>
          {isOneOnOne ? 'Chat Details' : isEventGroup ? 'Activity Details' : 'Group Info'}
        </h2>
        <div className={styles.headerRight}>
          {!isOneOnOne && (
            <div className={styles.menuContainer} ref={menuRef}>
              <button 
                type="button"
                className={styles.moreBtn} 
                onClick={() => setShowMenu(!showMenu)}
                title="Options"
              >
                <MoreVertical size={20} />
              </button>
              {showMenu && (
                <div className={styles.dropdownMenu}>
                  <button type="button" className={styles.dropdownItem} onClick={() => { if (togglePinConversation) togglePinConversation(conversation.id); setShowMenu(false); }}>
                    <Pin size={15} />
                    <span>{conversation?.pinned || conversation?.isPinned ? 'Unpin Group' : 'Pin Group'}</span>
                  </button>
                  <button type="button" className={styles.dropdownItem} onClick={() => { if (onClearChat) onClearChat(); setShowMenu(false); onBack(); }}>
                    <Trash2 size={15} />
                    <span>Clear Chat History</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {isOneOnOne && <div style={{ width: '40px' }} />}
        </div>
      </div>

      <div className={styles.scrollBody} key="details-scroll">
        <div className={styles.avatarSection}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Avatar
              src={isGroup ? (groupDetails?.avatar || groupDetails?.avatarKey || conversation.avatarKey || conversation.avatar || (isEventGroup ? (activity?.coverImage || conversation.coverImage || conversation.icon) : null)) : (conversation.avatar || targetUser?.avatar || conversation.otherUser?.avatar || conversation.targetUser?.avatar)}
              name={conversation.name || targetUser?.displayName}
              size="120px"
              isGroup={isGroup}
              onClick={!isClosed && isMember ? handleAvatarClick : undefined}
              disableHover={isClosed || !isMember}
              className={`${isGroup && canEditGroupInfo && !isClosed && isMember ? styles.avatarWrapperClickable : ''}`}
            >
              {isGroup && canEditGroupInfo && !isClosed && isMember && (
                <div className={styles.avatarOverlay}>Change Photo</div>
              )}
            </Avatar>
          </div>
          
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
                    onClick={() => navigate(`/profile/${targetUser.username}`, { state: { from: window.location.pathname } })}
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

          {isEventGroup && (
            <button
              type="button"
              className={styles.viewActivityBtn}
              onClick={() => {
                const actId = activity?.id || conversation.activityId || (conversation.id ? String(conversation.id).replace(/^act_/, '') : null);
                if (actId) {
                  navigate(`/crew/${actId}`, { state: { activity: activity || conversation.activity } });
                }
              }}
              style={{ margin: '0.75rem 0 1rem 0' }}
            >
              {activityHasStarted ? (
                <CalendarDays size={18} />
              ) : (
                <CalendarIcon date={activity?.startDate || activity?.date || conversation.startDate || conversation.date} size="badge" />
              )}
              <span>View Activity Details</span>
            </button>
          )}

          {isGroup && !isClosed && isMember && (() => {
            const isApprovalRequired = (
              whoCanJoin === 'APPROVAL' || 
              whoCanJoin === 'Request required' || 
              whoCanJoin === 'APPROVAL_REQUIRED' || 
              conversation.whoCanJoin === 'APPROVAL' || 
              conversation.whoCanJoin === 'Request required' || 
              conversation.whoCanJoin === 'APPROVAL_REQUIRED'
            );
            const pendingCount = conversation.pendingRequests?.length || 0;

            return (
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

                {isApprovalRequired && (
                  <div className={styles.actionIconContainer}>
                    <button
                      type="button"
                      className={styles.actionIconButton}
                      onClick={() => setShowRequestsPage(true)}
                      title="Join Requests"
                      style={{ position: 'relative' }}
                    >
                      <UserCheck size={24} />
                      {pendingCount > 0 && (
                        <span className={styles.requestBadge}>
                          {pendingCount}
                        </span>
                      )}
                    </button>
                    <span className={styles.actionIconLabel}>Requests</span>
                  </div>
                )}
              </div>
            );
          })()}
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

        {/* 2. GROUP & EVENT CHAT DETAILS */}
        {isGroup && (
          <div className={styles.detailsList}>
            {(conversation.description || activity?.description) && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Description</h3>
                <p className={styles.sectionValue}>{conversation.description || activity?.description}</p>
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
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Group Settings</span>
              </button>
            )}

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Members ({memberIds.length})</h3>
              <div className={styles.memberList}>
                {memberIds.map(uid => {
                  const userObj = Object.values(users).find(u => u.id === uid);
                  if (!userObj) return null;
                  
                  const isMe = uid === currentUser?.id;
                  const isUserOwner = uid === conversation.ownerId || (activity && (uid === activity.hostId || uid === activity.creatorId));
                  const isUserAdmin = (conversation.admins || []).includes(uid);
                  
                  const canPromote = isOwner && !isMe && !isUserOwner && !isUserAdmin;
                  const canDemote = isOwner && !isMe && !isUserOwner && isUserAdmin;
                  const canRemove = !isMe && !isClosed && isMember && !isUserOwner && (isOwner || (isAdmin && !isUserAdmin));
                  const canReport = !isMe;
                  
                  return (
                    <div key={uid} className={styles.memberItem}>
                      <Link to={`/profile/${userObj.username}`} className={styles.memberLink}>
                        <Avatar 
                          src={userObj.avatar} 
                          name={userObj.name} 
                          size="38px" 
                        />
                        <div className={styles.memberMeta}>
                          <span className={styles.memberName}>
                            {userObj.displayName || userObj.name} {isMe && '(You)'}
                          </span>
                          <span className={styles.memberUsername}>@{userObj.username}</span>
                        </div>
                      </Link>

                      <div className={styles.memberRight}>
                        {isUserOwner && <span className={styles.roleTag}>Owner</span>}
                        {isUserAdmin && !isUserOwner && <span className={styles.roleTag} style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>Admin</span>}
                        
                        <div className={styles.menuContainer} ref={activeMemberMenu === uid ? memberMenuRef : null}>
                          <button 
                            type="button"
                            className={styles.moreBtn}
                            style={{ marginLeft: '4px' }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setActiveMemberMenu(activeMemberMenu === uid ? null : uid);
                            }}
                            title="Member Actions"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="1"></circle>
                              <circle cx="12" cy="5" r="1"></circle>
                              <circle cx="12" cy="19" r="1"></circle>
                            </svg>
                          </button>
                          {activeMemberMenu === uid && (
                            <div className={styles.dropdownMenu} style={{ top: '100%', right: '0', zIndex: 20 }}>
                              <button 
                                type="button"
                                className={styles.dropdownItem}
                                onClick={() => {
                                  setActiveMemberMenu(null);
                                  navigate(`/profile/${userObj.username}`, { state: { from: window.location.pathname } });
                                }}
                              >
                                View Profile
                              </button>
                              {canPromote && (
                                <button 
                                  type="button"
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
                                  type="button"
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
                                  type="button"
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
                              {canReport && (
                                <button 
                                  type="button"
                                  className={styles.dropdownItem}
                                  style={{ color: '#ef4444' }}
                                  onClick={() => {
                                    setReportUserTarget(userObj);
                                    setActiveMemberMenu(null);
                                  }}
                                >
                                  Report User
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {!isClosed && isMember && (
              <div className={styles.actionSection}>
                {isOwner ? (
                  isEventGroup && !activityHasStarted ? (
                    <button 
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={handleEndActivity}
                    >
                      Cancel Activity
                    </button>
                  ) : (
                    <button 
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={handleEndGroup}
                    >
                      End Group
                    </button>
                  )
                ) : (
                  <button 
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={isEventGroup && onLeaveActivity ? onLeaveActivity : handleLeaveGroup}
                  >
                    {isEventGroup ? (activityHasStarted ? 'Leave Group' : 'Leave Activity') : 'Leave Group'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {isGroup && (
          <div className={styles.dateInfo}>Created on {formattedDate}</div>
        )}
      </div>

      <ConfirmModal
        title={
          confirmType === 'endGroup' ? 'End Group?' :
          confirmType === 'leaveGroup'
            ? (isEventGroup ? (activityHasStarted ? 'Leave Group' : 'Leave Activity') : 'Leave Group')
            : confirmType === 'endActivity' ? 'Cancel Activity' :
          confirmType === 'changeOwner' ? 'Change Group Owner?' :
          'Remove Member'
        }
        desc={
          confirmType === 'endGroup' ? 'This group will be closed permanently. Previous chats and media will remain accessible.' :
          confirmType === 'leaveGroup'
            ? (isEventGroup
                ? (activityHasStarted
                    ? 'You can still view the chat history, but you won\'t be able to send or receive new messages.'
                    : 'You will be removed from this activity and the group chat will be removed from your inbox.')
                : 'Are you sure you want to leave this group?')
            : confirmType === 'endActivity' ? 'Are you sure you want to cancel this activity?' :
          confirmType === 'changeOwner' ? `Ownership of this group will be transferred to ${(Object.values(users).find(u => u.id === targetUserId)?.displayName || Object.values(users).find(u => u.id === targetUserId)?.name || 'This member')}.` :
          'Are you sure you want to remove this member from the group?'
        }
        visible={showConfirm}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmAction}
        confirmText={
          confirmType === 'endGroup' ? 'End Group' :
          confirmType === 'leaveGroup' ? (isEventGroup && !activityHasStarted ? 'Leave Activity' : 'Leave') :
          confirmType === 'endActivity' ? 'Cancel Activity' :
          confirmType === 'changeOwner' ? 'Change Owner' :
          'Remove'
        }
      />
      
      <InviteModal 
        isOpen={showInviteModal} 
        onClose={() => setShowInviteModal(false)} 
        group={{ ...conversation, ...groupDetails }} 
      />

      <SafetyNumberModal
        isOpen={showSafetyModal}
        onClose={() => setShowSafetyModal(false)}
        targetUser={targetUser}
      />

      {reportUserTarget && (
        <ReportModal
          isOpen={!!reportUserTarget}
          onClose={() => setReportUserTarget(null)}
          targetType="user"
          targetId={reportUserTarget.id}
          targetName={reportUserTarget.displayName || reportUserTarget.name || reportUserTarget.username}
          targetAvatar={reportUserTarget.avatar}
          reportedFrom="group_chat_members"
        />
      )}
    </div>
  );
}
