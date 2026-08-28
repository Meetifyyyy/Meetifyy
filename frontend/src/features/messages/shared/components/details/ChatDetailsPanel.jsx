import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';

import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './ChatDetailsPanel.module.css';
import { useAcademicSummary } from '@shared/academics/useAcademicSummary';
import sidebarStyles from '../sidebar/ConversationList.module.css';
import { Pin, Trash2, ChevronRight, User, Search, Ban, UserPlus, UserCheck, Image as ImageIcon, ArrowLeft, MoreVertical } from '@shared/components/icons';
import InviteModal from '../modals/InviteModal';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import { showToast } from '@shared/utils/toast';

import ChatGalleryPage from './ChatGalleryPage';
import MediaThumb from '@shared/components/media/MediaThumb';
import GroupChangeOwnerPage from './GroupChangeOwnerPage';
import GroupEditPage from './GroupEditPage';
import GroupSettingsPage from './GroupSettingsPage';
import GroupJoinRequestsPage from './GroupJoinRequestsPage';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useCrewActivities, useCrewActions } from '@shared/hooks/useCrew';
import { useGroupActions } from '@shared/hooks/useGroupActions';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
} from '@shared/constants/mediaLimits';
import { commitDraftImage } from '@shared/utils/draftImageCache';
import { sortGroupMembers } from '@shared/utils/memberSort';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';

/**
 * The horizontal gallery preview shown in chat details.
 *
 * Defined once. It was previously inlined twice — identically — in the DM and
 * group branches of the panel, so the raw-URL bug below had to be fixed in two
 * places and any future change would need remembering in both.
 */
function GalleryStrip({ mediaList, onOpen }) {
  const hasMedia = Array.isArray(mediaList) && mediaList.length > 0;
  return (
    <div className={styles.galleryCard}>
      <div className={styles.galleryHeader} onClick={onOpen}>
        <span className={styles.galleryTitle}>Gallery</span>
        <ChevronRight className={styles.galleryChevron} size={20} />
      </div>
      {hasMedia ? (
        <div className={styles.galleryRow}>
          {mediaList.map((item, idx) => (
            <MediaThumb
              key={`${item.url}-${idx}`}
              src={item.url}
              poster={item.thumbnailUrl}
              type={item.type}
              alt=""
              onClick={onOpen}
              className={styles.galleryThumbnail}
            />
          ))}
        </div>
      ) : (
        <div className={styles.noMediaContainer}>
          <ImageIcon size={18} className={styles.noMediaIcon} />
          <span>No media</span>
        </div>
      )}
    </div>
  );
}

export default function ChatDetailsPanel({ conversation, onBack, onBlockUser, onClearChat, onSearch, onLeaveActivity }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const users = useUsersMap();
  const crewActivities = useCrewActivities();
  const { endCrewActivity } = useCrewActions();
  const {
    leaveGroup, updateGroupInfo, updateGroupEditPermission, updateGroupSettings,
    removeGroupMember, changeGroupOwner, promoteToAdmin, demoteFromAdmin, endGroup,
    acceptGroupJoinRequest, declineGroupJoinRequest, togglePinConversation,
  } = useGroupActions();

  // General States
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmType, setConfirmType] = useState(''); // 'leaveGroup' | 'endActivity' | 'removeMember' | 'changeOwner' | 'endGroup'
  const [targetUserId, setTargetUserId] = useState(null);
  
  // Modal States
  const [showInviteModal, setShowInviteModal] = useState(false);
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

  // Subscribe reactively to the live message cache so the gallery re-derives
  // whenever new media is shared. `queryClient.getQueryData` alone is a
  // non-reactive snapshot — reading it in a memo keyed only on
  // `conversation.messages` let the gallery go stale. This observer re-renders
  // the panel whenever the canonical ['messages', <pubId>] cache changes
  // (optimistic send, socket delivery, media URL swap), keeping it in sync.
  const messagesKey = conversation?.publicId || conversation?.id || conversation?.internalId || null;
  //
  // `skipToken` rather than a bare `enabled: false`: a query with no queryFn
  // at all is a configuration error to TanStack, and it logged the
  // "No queryFn was passed" warning on every single render of this panel —
  // hundreds of lines of console noise that buried real errors. skipToken is
  // the supported way to say "this observer never fetches", so the cache
  // subscription works exactly as before, silently.
  const { data: liveHistory } = useQuery({
    queryKey: ['messages', messagesKey],
    queryFn: skipToken, // subscribe to cache updates only; never refetch here
  });

  const galleryMessages = useMemo(() => {
    const fromLive = liveHistory?.pages ? liveHistory.pages.flatMap(p => p?.messages || []) : [];
    if (fromLive.length > 0) return fromLive;
    // Fallback for the brief window before the canonical cache is populated.
    for (const key of [conversation?.id, conversation?.internalId].filter(Boolean)) {
      const qd = queryClient.getQueryData(['messages', key]);
      if (qd?.pages) {
        const msgs = qd.pages.flatMap(p => p?.messages || []);
        if (msgs.length > 0) return msgs;
      }
    }
    return conversation?.messages || [];
  }, [liveHistory, conversation?.id, conversation?.internalId, conversation?.messages, queryClient]);

  // Extract shared media from message history (ONLY images and videos, EXCLUDING voice notes/audio)
  const mediaList = useMemo(() => {
    const list = [];
    const messages = galleryMessages;

    messages.forEach(msg => {
      const text = msg.text || msg.payload?.text || '';
      // Coerced to a string here: the `|| ''` fallback only covers falsy values, so
      // a truthy non-string mediaUrl (an object payload, for instance) reached
      // `mediaUrl.startsWith('data:audio/')` in the isAudio check below -- which runs
      // before the `typeof mediaUrl === 'string'` guard further down -- and threw
      // "mediaUrl.startsWith is not a function", taking the whole panel down.
      const rawMediaUrl = msg.mediaUrl || msg.payload?.mediaUrl || (msg.type === 'media' ? (msg.text || msg.payload?.text) : null) || '';
      const mediaUrl = typeof rawMediaUrl === 'string' ? rawMediaUrl : '';
      const mediaType = (msg.mediaType || msg.payload?.mediaType || msg.type || '').toLowerCase();
      // Chat uploads store a separate thumbnail alongside the original. Carrying
      // it here is what lets a video tile show a real frame instead of a black
      // rectangle, and lets an image tile load the small file rather than the full one.
      const rawThumb = msg.thumbnailUrl || msg.payload?.thumbnailUrl || '';
      const thumbnailUrl = typeof rawThumb === 'string' ? rawThumb : '';
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
        if (isVid) list.push({ type: 'video', url: mediaUrl, thumbnailUrl, createdAt: new Date(createdAt).getTime() });
        else if (isImg) list.push({ type: 'image', url: mediaUrl, thumbnailUrl, createdAt: new Date(createdAt).getTime() });
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
  }, [galleryMessages]);

  // Hooks must run on every render, so this sits ABOVE the early return below.
  // It reads the DM partner's academic fields straight off the conversation
  // rather than from the `targetUser` memo, which is computed further down.
  const targetAcademicSummary = useAcademicSummary(
    conversation && conversation.type !== 'GROUP' && conversation.type !== 'group'
      ? conversation
      : null,
  );

  // `conversation` is required, and this component must not try to defend
  // against its absence with an early return: five hooks are declared below
  // this point, so returning here changed the hook count between renders — the
  // exact thing that corrupts hook state.
  //
  // The guard that used to sit here was dead twice over. ChatAreaLayout already
  // returns an empty state when there is no conversation before it ever renders
  // this panel, and the useState calls near the top of this component read
  // `conversation.name`, so a null value would have thrown long before reaching
  // this line.

  // Determine chat type
  const isGroup = conversation.type === 'GROUP' || !!conversation.isGroup;
  const isOneOnOne = !isGroup;

  // Activity group chats have been removed.

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
  const rawParticipants = isGroup ? (groupDetails?.memberDetails || []) : (conversation.members || conversation.participants || []);
  const sortedParticipants = useMemo(() => {
    return sortGroupMembers(rawParticipants, {
      ownerId: isGroup ? groupDetails?.ownerId : conversation.ownerId,
      hostId: conversation.hostId || null,
      admins: isGroup ? groupDetails?.admins : conversation.admins,
      users
    });
  }, [rawParticipants, isGroup, groupDetails?.ownerId, groupDetails?.admins, conversation.ownerId, conversation.hostId, conversation.admins, users]);
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
      if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
        showToast(COVERED_IMAGE_SIZE_ERROR_MESSAGE, 'error');
        e.target.value = '';
        return;
      }
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
      onBack();
    } else if (confirmType === 'endGroup') {
      await endGroup(conversation.id);
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
      course: conversation.course || null,
      branch: conversation.branch || null,
      passingYear: Number.isInteger(conversation.passingYear ?? conversation.currentYear)
        ? (conversation.passingYear ?? conversation.currentYear)
        : null,
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
              showToast('Group updated', 'success');
            }
          } catch (err) {
            showToast("Couldn't update group", 'error');
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
        isGroup={isGroup}
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
          <ArrowLeft size={20} />
        </button>
        <h2 className={styles.headerTitle}>
          {isOneOnOne ? 'Chat Details' : 'Group Info'}
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
              src={isGroup ? (groupDetails?.avatar || groupDetails?.avatarKey || conversation.avatarKey || conversation.avatar || null) : (conversation.avatar || targetUser?.avatar || conversation.otherUser?.avatar || conversation.targetUser?.avatar)}
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
                    className={`${styles.actionIconButton} ${conversation.isBlockedByMe ? styles.blockedBtn : ''}`}
                    onClick={() => {
                      // Must name the target and the current state: calling
                      // this bare sent a request for user "undefined".
                      const targetId = conversation.targetUser?.id || conversation.userId;
                      if (onBlockUser && targetId) {
                        onBlockUser(targetId, Boolean(conversation.isBlockedByMe));
                        onBack();
                      }
                    }}
                    title={conversation.isBlockedByMe ? "Unblock Contact" : "Block Contact"}
                  >
                    <Ban size={24} />
                  </button>
                  <span className={`${styles.actionIconLabel} ${conversation.isBlockedByMe ? styles.blockedLabel : ''}`}>
                    {conversation.isBlockedByMe ? 'Unblock' : 'Block'}
                  </span>
                </div>
              </div>
            </>
          )}

          {isGroup && (() => {
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
                {!isClosed && isMember && (
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
                )}

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

                {!isClosed && isMember && isApprovalRequired && (
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

            {targetAcademicSummary && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Academics</h3>
                <p className={styles.sectionValue}>{targetAcademicSummary}</p>
              </div>
            )}


            <GalleryStrip mediaList={mediaList} onOpen={() => setShowGalleryPage(true)} />
          </div>
        )}

        {/* 2. GROUP & EVENT CHAT DETAILS */}
        {isGroup && (
          <div className={styles.detailsList}>
            {conversation.description && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Description</h3>
                <p className={styles.sectionValue}>{conversation.description}</p>
              </div>
            )}

            <GalleryStrip mediaList={mediaList} onOpen={() => setShowGalleryPage(true)} />

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

            <div className={`${styles.section} ${styles.membersSection}`}>
              <h3 className={styles.sectionTitle}>Members ({memberIds.length})</h3>
              <div className={styles.memberList}>
                {memberIds.map(uid => {
                  const userObj = Object.values(users).find(u => u.id === uid);
                  if (!userObj) return null;
                  
                  const isMe = uid === currentUser?.id;
                  const isUserOwner = uid === conversation.ownerId || uid === conversation.hostId;
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

        {isGroup && (
          <div className={styles.dateInfo}>Created on {formattedDate}</div>
        )}
      </div>

      <ConfirmModal
        title={
          confirmType === 'endGroup' ? 'End Group' :
          confirmType === 'leaveGroup' ? 'Leave Group' :
          confirmType === 'changeOwner' ? 'Transfer Ownership' :
          'Remove Member'
        }
        desc={
          confirmType === 'endGroup' ? 'This will close the group permanently for all members.' :
          confirmType === 'leaveGroup' ? 'You will stop receiving messages from this group.' :
          confirmType === 'changeOwner' ? `${(Object.values(users).find(u => u.id === targetUserId)?.displayName || Object.values(users).find(u => u.id === targetUserId)?.name || 'This member')} will become the new group owner.` :
          `${(Object.values(users).find(u => u.id === targetUserId)?.displayName || Object.values(users).find(u => u.id === targetUserId)?.name || 'This member')} will be removed from this group.`
        }
        visible={showConfirm}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmAction}
        confirmText={
          confirmType === 'endGroup' ? 'End Group' :
          confirmType === 'leaveGroup' ? 'Leave' :
          confirmType === 'changeOwner' ? 'Transfer' :
          'Remove'
        }
        cancelText={
          confirmType === 'leaveGroup' ? 'Stay' :
          'Cancel'
        }
        isDestructive={true}
      />
      
      <InviteModal 
        isOpen={showInviteModal} 
        onClose={() => setShowInviteModal(false)} 
        group={{ ...conversation, ...groupDetails }} 
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
