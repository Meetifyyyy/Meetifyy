import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import Avatar from '../common/Avatar';
import ConfirmModal from '../common/ConfirmModal';
import styles from './ChatDetailsPage.module.css';
import { Pin, Trash2, LogOut, Pencil, ChevronRight, User, Search, Ban, Phone, UserPlus } from 'lucide-react';
import ImageSearchModal from '../common/ImageSearchModal';
import InviteModal from './InviteModal';
import { showToast } from '../../utils/toast';

export default function ChatDetailsPage({ conversation, onBack, onBlockUser, onClearChat, onSearch }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { users, crewActivities, endCrewActivity, leaveGroup, updateGroupInfo, updateGroupEditPermission, removeGroupMember, changeGroupOwner, promoteToAdmin, demoteFromAdmin, endGroup } = useData();

  // General States
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmType, setConfirmType] = useState(''); // 'leaveGroup' | 'endActivity' | 'removeMember'
  const [targetUserId, setTargetUserId] = useState(null);
  
  // Modal States
  const [showInviteModal, setShowInviteModal] = useState(false);
  
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

  // Sync states when conversation updates or changes
  useEffect(() => {
    setEditName(conversation.name || '');
    setEditDesc(conversation.description || '');
    setEditAvatar(conversation.avatar || '');
    setShowEditGroupPage(false);
    setShowSettingsPage(false);
    setShowGalleryPage(false);
    setShowChangeOwnerPage(false);
  }, [conversation.id]);

  // Settings page states
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [showEditGroupPage, setShowEditGroupPage] = useState(false);
  const [showGalleryPage, setShowGalleryPage] = useState(false);
  const [showChangeOwnerPage, setShowChangeOwnerPage] = useState(false);
  const [groupUpdatesActive, setGroupUpdatesActive] = useState(true);
  const [joinLeaveUpdates, setJoinLeaveUpdates] = useState('Everyone');
  const [eventUpdates, setEventUpdates] = useState('Everyone');
  const [albumUpdates, setAlbumUpdates] = useState('Everyone');
  const [whoCanJoin, setWhoCanJoin] = useState('Anyone');
  const [visibility, setVisibility] = useState(() => {
    if (conversation.visibility) return conversation.visibility;
    if (conversation.id && String(conversation.id).startsWith('c_')) return 'Visible only to Gla University';
    return 'Hidden group';
  });
  const [allowSharing, setAllowSharing] = useState(true);
  const [editGroupPermission, setEditGroupPermission] = useState(conversation.editGroupPermission || 'Everyone');
  const [showImageSearch, setShowImageSearch] = useState(false);

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
    const uniqueList = list.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });

    if (uniqueList.length > 0) return uniqueList;

    // Seed premium mock gallery images if no media has been shared yet
    return [
      { type: 'image', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&auto=format&fit=crop&q=80' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=600&auto=format&fit=crop&q=80' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600&auto=format&fit=crop&q=80' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=600&auto=format&fit=crop&q=80' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&auto=format&fit=crop&q=80' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=600&auto=format&fit=crop&q=80' }
    ];
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
  const memberIds = conversation.members || conversation.participants || (activity ? activity.participants : []) || [];
  const isClosed = conversation.status === 'Closed';
  const isMember = isGroup ? (conversation.members || conversation.participants || []).includes(currentUser?.id) : true;

  // Formatted date for group creation
  const formattedDate = conversation.createdAt 
    ? new Date(conversation.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Recently';

  // Handlers
  const handleSaveGroupInfo = () => {
    const newName = editName.trim();
    const newDesc = editDesc.trim();
    if (newName && (newName !== conversation.name || newDesc !== (conversation.description || ''))) {
      updateGroupInfo(conversation.id, newName, undefined, newDesc);
    }
  };

  const handleAvatarClick = () => {
    if (isAdmin) {
      setShowImageSearch(true);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setEditAvatar(event.target.result);
        }
      };
      reader.readAsDataURL(file);
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

  let monthStr = '';
  let dayStr = '';
  if (activity && activity.date) {
    const d = new Date(activity.date);
    if (!isNaN(d.getTime())) {
      monthStr = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      dayStr = d.getDate();
    }
  }

  // Find target user for one-on-one
  const targetUser = isOneOnOne
    ? Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId)
    : null;

  if (showGalleryPage) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button 
            type="button" 
            className={styles.backBtn} 
            onClick={() => setShowGalleryPage(false)} 
            title="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h2 className={styles.headerTitle}>Gallery</h2>
          <div style={{ width: '40px' }} />
        </div>
        
        <div className={styles.scrollBody} key="gallery-scroll">
          <div className={styles.galleryGrid}>
            {mediaList.map((item, idx) => (
              <div key={idx} className={styles.galleryGridItem}>
                {item.type === 'video' ? (
                  <div className={styles.videoGridWrapper}>
                    <video src={item.url} className={styles.galleryGridMedia} controls />
                  </div>
                ) : (
                  <img src={item.url} alt="" className={styles.galleryGridMedia} onClick={() => window.open(item.url, '_blank')} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (showChangeOwnerPage) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button 
            type="button" 
            className={styles.backBtn} 
            onClick={() => setShowChangeOwnerPage(false)} 
            title="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h2 className={styles.headerTitle}>Change Owner</h2>
          <div style={{ width: '40px' }} />
        </div>
        
        <div className={styles.scrollBody} style={{ padding: '0 1rem' }}>
          <p style={{ margin: '1rem 0', color: '#888', fontSize: '0.9rem' }}>
            Select a new owner from the group members. They will have full control over the group settings.
          </p>
          <div className={styles.section} style={{ padding: '0 1rem', marginTop: '0' }}>
            <div className={styles.memberList}>
              {memberIds.map(uid => {
                const userObj = Object.values(users).find(u => u.id === uid);
                if (!userObj || uid === conversation.ownerId) return null;
                
                return (
                  <div key={uid} className={`${styles.memberItem} ${styles.noHover}`}>
                    <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: '12px' }}>
                      <Avatar src={userObj.avatar} name={userObj.name} size="38px" />
                      <div className={styles.memberMeta}>
                        <span className={styles.memberName}>{userObj.displayName || userObj.name}</span>
                        <span className={styles.memberUsername}>@{userObj.username}</span>
                      </div>
                    </div>
                    <div className={styles.memberRight}>
                      <button 
                        className={styles.settingsBtn} 
                        style={{ padding: '10px 16px', fontSize: '0.85rem', width: 'auto', marginBottom: 0, fontWeight: 'bold' }}
                        onClick={() => {
                          setTargetUserId(uid);
                          setConfirmType('changeOwner');
                          setShowConfirm(true);
                        }}
                      >
                        Make Owner
                      </button>
                    </div>
                  </div>
                );
              })}
              {memberIds.filter(uid => uid !== conversation.ownerId).length === 0 && (
                <p className={styles.sectionValue} style={{ textAlign: 'center', marginTop: '2rem' }}>
                  No other members available.
                </p>
              )}
            </div>
          </div>
        </div>
        <ConfirmModal
          title="Change Group Owner?"
          desc={`Ownership of this group will be transferred to ${(Object.values(users).find(u => u.id === targetUserId)?.displayName || Object.values(users).find(u => u.id === targetUserId)?.name || 'This member')}.`}
          visible={showConfirm && confirmType === 'changeOwner'}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleConfirmAction}
          confirmText="Change Owner"
        />
      </div>
    );
  }

  if (showEditGroupPage) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button 
            type="button" 
            className={styles.backBtn} 
            onClick={() => {
              setEditName(conversation.name || '');
              setEditDesc(conversation.description || '');
              setEditAvatar(conversation.avatar || '');
              setShowEditGroupPage(false);
            }} 
            title="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h2 className={styles.headerTitle}>Edit Group</h2>
          <button 
            type="button"
            className={styles.saveHeaderBtn}
            onClick={() => {
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
                    toastMsg = `${changes[0]} has been changed`;
                  } else if (changes.length === 2) {
                    toastMsg = `${changes[0]} and ${changes[1]} have been changed`;
                  } else {
                    const last = changes.pop();
                    toastMsg = `${changes.join(', ')} and ${last} have been changed`;
                  }
                  // Capitalize the first letter of toastMsg
                  toastMsg = toastMsg.charAt(0).toUpperCase() + toastMsg.slice(1);
                  showToast(toastMsg);
                }

                updateGroupInfo(conversation.id, editName.trim(), editAvatar, editDesc.trim());
              }
            }}
            disabled={
              editName.trim() === conversation.name && 
              editDesc.trim() === (conversation.description || '') &&
              editAvatar === (conversation.avatar || '')
            }
          >
            Save
          </button>
        </div>

        <div className={styles.scrollBody} key="edit-group-scroll">
          <div className={styles.settingsForm}>
            {/* Avatar Section inside Settings */}
            <div className={styles.avatarSection} style={{ marginBottom: '2rem' }}>
              <Avatar
                src={editAvatar}
                name={editName}
                size="120px"
                isGroup={isGroup || isEventGroup}
                onClick={handleAvatarClick}
                disableHover={true}
                className={isAdmin ? styles.avatarWrapperClickable : ''}
              />
              {isAdmin && (
                <button 
                  type="button"
                  className={styles.changePhotoBtn}
                  onClick={handleAvatarClick}
                >
                  Change Photo
                </button>
              )}
            </div>

            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFileChange} 
            />

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Group Name</h3>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  className={styles.textInput}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value.substring(0, 120))}
                  placeholder="Group Name"
                  maxLength={120}
                  style={{ paddingRight: '4.5rem' }}
                />
                <span className={styles.charCounter}>
                  {editName.length}/120
                </span>
              </div>
            </div>

            <div className={styles.section} style={{ marginTop: '1.5rem' }}>
              <h3 className={styles.sectionTitle}>Description</h3>
              <div style={{ position: 'relative' }}>
                <textarea
                  className={styles.textArea}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value.substring(0, 300))}
                  placeholder="Add a group description..."
                  maxLength={300}
                  style={{ paddingBottom: '1.8rem' }}
                />
                <span className={styles.charCounter}>
                  {editDesc.length}/300
                </span>
              </div>
            </div>
          </div>
        </div>
        {showImageSearch && (
          <ImageSearchModal
            onClose={() => setShowImageSearch(false)}
            onSelect={(url) => {
              setEditAvatar(url);
              setShowImageSearch(false);
            }}
          />
        )}
      </div>
    );
  }

  if (showSettingsPage) {
    return (
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <button 
            type="button" 
            className={styles.backBtn} 
            onClick={() => setShowSettingsPage(false)} 
            title="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h2 className={styles.headerTitle}>Settings</h2>
          <div style={{ width: '40px' }} />
        </div>

        {/* Settings options list */}
        <div className={styles.scrollBody} key="settings-scroll" style={{ padding: '1rem 0' }}>
          {isClosed ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: '#ef4444', fontWeight: 'bold' }}>
              This group has been closed by the Owner. This chat is now read-only.
            </div>
          ) : !isMember ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: '#ef4444', fontWeight: 'bold' }}>
              You are no longer a member of this group.
            </div>
          ) : (
            <>
              {/* Category: Personalisation */}
          <div className={styles.categoryBlock}>
            <div className={styles.categoryHeader}>Personalisation</div>
            <button 
              type="button" 
              className={styles.settingRow} 
              onClick={() => {
                if (canEditGroupInfo) setShowEditGroupPage(true);
              }}
              style={{ cursor: canEditGroupInfo ? 'pointer' : 'default', opacity: canEditGroupInfo ? 1 : 0.7 }}
            >
              <span className={styles.settingLabel}>Edit group</span>
              <div className={styles.settingRight}>
                <span className={styles.settingValue}>{conversation.name}</span>
                {canEditGroupInfo ? (
                  <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                )}
              </div>
            </button>
          </div>

          {/* Category: Group Updates */}
          <div className={styles.categoryBlock} style={{ marginTop: '1.5rem' }}>
            <div className={styles.categoryHeader}>Group Updates</div>
            
            {/* Row with Switch */}
            <div className={styles.settingRow} style={{ cursor: 'default' }}>
              <div className={styles.settingLabelCol}>
                <span className={styles.settingLabel}>Group Updates</span>
                <span className={styles.settingSubtext}>Notifications of group activity in chat</span>
              </div>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={groupUpdatesActive}
                  onChange={(e) => setGroupUpdatesActive(e.target.checked)}
                />
                <span className={styles.slider}></span>
              </label>
            </div>


          </div>

          {/* Category: Privacy */}
          <div className={styles.categoryBlock} style={{ marginTop: '1.5rem' }}>
            <div className={styles.categoryHeader}>Privacy</div>

            {/* Row: Who can join */}
            <button 
              type="button" 
              className={styles.settingRow}
              onClick={() => {
                if (isAdmin) setWhoCanJoin(prev => prev === 'Anyone' ? 'Request required' : 'Anyone');
              }}
              style={{ cursor: isAdmin ? 'pointer' : 'default', opacity: isAdmin ? 1 : 0.7 }}
            >
              <span className={styles.settingLabel}>Who can join</span>
              <div className={styles.settingRight}>
                <span className={styles.settingValue}>{whoCanJoin}</span>
                {isAdmin ? (
                  <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                )}
              </div>
            </button>

            {/* Row: Visibility */}
            <button 
              type="button" 
              className={styles.settingRow}
              onClick={() => {
                if (isAdmin) setVisibility(prev => prev.startsWith('Visible') ? 'Hidden group' : 'Visible only to Gla University');
              }}
              style={{ cursor: isAdmin ? 'pointer' : 'default', opacity: isAdmin ? 1 : 0.7 }}
            >
              <span className={styles.settingLabel}>Visibility</span>
              <div className={styles.settingRight}>
                <span className={styles.settingValue} style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {visibility}
                </span>
                {isAdmin ? (
                  <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                )}
              </div>
            </button>

            {/* Row: Allow sharing switch */}
            <div className={styles.settingRow} style={{ cursor: 'default', opacity: isAdmin ? 1 : 0.7 }}>
              <span className={styles.settingLabel}>Allow sharing</span>
              <div className={styles.settingRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={allowSharing}
                    onChange={(e) => {
                      if (isAdmin) setAllowSharing(e.target.checked);
                    }}
                    disabled={!isAdmin}
                  />
                  <span className={styles.slider} style={{ cursor: isAdmin ? 'pointer' : 'default' }}></span>
                </label>
                {!isAdmin && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                )}
              </div>
            </div>

          </div>

          {/* Category: Permissions */}
          <div className={styles.categoryBlock} style={{ marginTop: '1.5rem' }}>
            <div className={styles.categoryHeader}>Permissions</div>

            <button 
              type="button" 
              className={styles.settingRow}
              onClick={() => {
                if (isAdmin) {
                  const newVal = editGroupPermission === 'Everyone' ? 'Owner and Admins' : 'Everyone';
                  setEditGroupPermission(newVal);
                  updateGroupEditPermission(conversation.id, newVal);
                }
              }}
              style={{ cursor: isAdmin ? 'pointer' : 'default', opacity: isAdmin ? 1 : 0.7 }}
            >
              <span className={styles.settingLabel}>Who can edit the group</span>
              <div className={styles.settingRight}>
                <span className={styles.settingValue}>{editGroupPermission === 'Admin' ? 'Owner and Admins' : editGroupPermission}</span>
                {isAdmin ? (
                  <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                )}
              </div>
            </button>
          </div>

          {/* Category: Group Actions */}
          <div className={styles.categoryBlock} style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
            <div className={styles.categoryHeader} style={{ color: '#ef4444' }}>Group Actions</div>

            {isOwner && (
              <button 
                type="button" 
                className={styles.settingRow}
                onClick={() => setShowChangeOwnerPage(true)}
              >
                <span className={styles.settingLabel}>Change Owner</span>
                <div className={styles.settingRight}>
                  <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>
            )}

            {!isOwner && (
              <button 
                type="button" 
                className={styles.settingRow}
                onClick={() => {
                  handleLeaveGroup();
                  setShowSettingsPage(false);
                }}
              >
                <span className={styles.settingLabel} style={{ color: '#ef4444', fontWeight: '600' }}>Leave Group</span>
              </button>
            )}

            {isOwner && (
              <button 
                type="button" 
                className={styles.settingRow}
                onClick={() => {
                  if (isEventGroup) {
                    handleEndActivity();
                  } else {
                    handleEndGroup();
                  }
                  setShowSettingsPage(false);
                }}
              >
                <span className={styles.settingLabel} style={{ color: '#ef4444', fontWeight: '600' }}>End Group</span>
              </button>
            )}
          </div>
            </>
          )}
        </div>
      </div>
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
          {isOneOnOne ? '' : isEventGroup ? '' : 'Group Info'}
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
          <Avatar
            src={conversation.avatar}
            name={conversation.name}
            size="120px"
            isGroup={isGroup || isEventGroup}
            onClick={!isClosed && isMember ? handleAvatarClick : undefined}
            disableHover={isClosed || !isMember}
            className={`${isGroup && isAdmin && !isClosed && isMember ? styles.avatarWrapperClickable : ''}`}
          >
            {isGroup && isAdmin && !isClosed && isMember && (
              <div className={styles.avatarOverlay}>Change Photo</div>
            )}
          </Avatar>
          
          <h1 className={styles.primaryName}>
            {isOneOnOne && targetUser ? (targetUser.displayName || targetUser.name) : conversation.name}
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
                  onClick={() => showToast('Audio call coming soon')}
                  title="Audio Call"
                >
                  <Phone size={24} />
                </button>
                <span className={styles.actionIconLabel}>Audio</span>
              </div>

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
              {(monthStr || dayStr) && (
                <div className={styles.calendarBadge}>
                  <div className={styles.calMonth}>{monthStr}</div>
                  <div className={styles.calDay}>{dayStr}</div>
                </div>
              )}
              <div className={styles.eventDateTime}>{formatEventDateTime()}</div>
            </div>
          )}


        </div>

        {/* Dynamic Details depending on style */}

        {/* 1. ONE-ON-ONE CHAT DETAILS */}
        {isOneOnOne && targetUser && (
          <div className={styles.detailsList}>
            {targetUser.university && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>College</h3>
                <p className={styles.sectionValue}>{targetUser.university}</p>
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
          </div>
        )}

        {/* 2. GROUP CHAT DETAILS */}
        {isGroup && (
          <div className={styles.detailsList}>
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFileChange} 
            />

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
              <h3 className={styles.sectionTitle}>Attendees ({memberIds.length})</h3>
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
    </div>
  );
}
