import { useState, useEffect, useRef, Suspense, lazy, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, Check } from 'lucide-react';
import data from '@emoji-mart/data';
import { isImageUrl } from '../../utils/avatar';
import Avatar from '../common/Avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import GroupSettingsModal from './GroupSettingsModal';
import ActivityChatDetailsModal from './ActivityChatDetailsModal';
import ConfirmModal from '../common/ConfirmModal';
import ChatDetailsPage from './ChatDetailsPage';
import { useSimulatedFetch } from '../../hooks/useSimulatedFetch';
import Skeleton from '../common/Skeleton';
import { ErrorState } from '../common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import MentionInput from '../common/mentions/MentionInput';
import RichText from '../common/mentions/RichText';
import { canSeeOnlineStatus, canSeeLastSeen, formatLastSeen } from '../../utils/presence';
import styles from './ChatArea.module.css';
import { useMediaViewer } from '../../context/MediaViewerContext';

const Picker = lazy(() => import('@emoji-mart/react'));

export default function ChatArea({ conversation, onSendMessage, onReactMessage, onClearChat, onBlockUser, onJoinGroup, onBack, showChatOnMobile }) {
  const { openViewer } = useMediaViewer();
  const navigate = useNavigate();
  const { initial, currentUser } = useAuth();
  const { users, crewActivities, endCrewActivity, leaveGroup } = useData();
  const { isLoading, data: loadedMessages, error, retry } = useSimulatedFetch(conversation?.messages || [], 800, [conversation?.id]);
  const [inputValue, setInputValue] = useState({ text: '', mentions: [] });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const fileInputRef = useRef(null);

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let mediaType = 'image';
    if (file.type) {
      if (file.type.startsWith('video/')) mediaType = 'video';
    } else {
      const ext = file.name.split('.').pop().toLowerCase();
      if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) {
        mediaType = 'video';
      }
    }

    const mediaUrl = URL.createObjectURL(file);
    onSendMessage(conversation.id, '', replyingTo, [], mediaUrl, mediaType);
    setReplyingTo(null);
    e.target.value = '';
  };
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  const hasText = !!(typeof inputValue === 'string' ? inputValue : (inputValue?.text || '')).trim();

  // Voice recording states and refs
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIdRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerIdRef.current) {
        clearInterval(timerIdRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Microphone not supported or disabled in insecure HTTP contexts. Please use HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerIdRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting audio recording:', err);
      showToast('Microphone permission denied or not available.');
    }
  };

  const deleteRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  const sendRecording = () => {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      onSendMessage(conversation.id, '', replyingTo, [], audioUrl, 'audio');
      
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }
      audioChunksRef.current = [];
    };

    mediaRecorderRef.current.stop();

    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
  };
  
  const getReadStatusIcon = (msg) => {
    let status = msg.status;
    if (!status) {
      status = 'read';
    }
    const meUser = users[currentUser];
    const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
    const bothHaveReadReceipts = (meUser?.settings?.privacy?.readReceipts !== false) && (targetUser?.settings?.privacy?.readReceipts !== false);
    
    const isRead = status === 'read' && bothHaveReadReceipts;
    const isDelivered = status === 'read' || status === 'delivered';
    
    let strokeColor = 'rgba(255, 255, 255, 0.6)';
    let readColor = '#38bdf8';

    if (isRead) {
      return <CheckCheck size={16} color={readColor} strokeWidth={2.5} style={{ display: 'inline-block', verticalAlign: 'middle' }} title="Read" />;
    } else if (isDelivered) {
      return <CheckCheck size={16} color={strokeColor} strokeWidth={2.5} style={{ display: 'inline-block', verticalAlign: 'middle' }} title="Delivered" />;
    } else {
      return <Check size={16} color={strokeColor} strokeWidth={2.5} style={{ display: 'inline-block', verticalAlign: 'middle' }} title="Sent" />;
    }
  };
  
  // Voice Call States
  const [isCalling, setIsCalling] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isMutedNotifications, setIsMutedNotifications] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setShowDetails(false);
  }, [conversation?.id]);

  const currentActivity = useMemo(() => {
    if (!conversation?.isActivityChat || !conversation?.activityId) return null;
    return crewActivities?.find(a => a.id === conversation.activityId);
  }, [conversation, crewActivities]);

  const isActivityHost = currentActivity?.hostId === currentUser?.id;

  const handleEndActivityFromChat = () => {
    setShowEndConfirm(true);
  };

  const confirmEndActivityFromChat = async () => {
    setShowEndConfirm(false);
    if (currentActivity) {
      await endCrewActivity(currentActivity.id);
      if (onBack) onBack();
    }
  };

  const bodyRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [conversation?.messages?.length, replyingTo]);

  // Voice Call Duration Timer
  useEffect(() => {
    if (isCalling) {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isCalling]);

  if (!conversation) {
    return (
      <div className={`${styles.msgChatArea} ${styles.msgNoChatSelected}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`}>
        <div className={styles.msgNoChatContent}>
          <div className={styles.msgNoChatIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h3>Your Messages</h3>
          <p>Select a conversation from the list to start chatting, or start a new one.</p>
        </div>
      </div>
    );
  }

  if (showDetails) {
    return (
      <div className={`${styles.msgChatArea}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`}>
        <ChatDetailsPage
          conversation={conversation}
          onBack={() => setShowDetails(false)}
          onBlockUser={onBlockUser}
          onClearChat={onClearChat}
          onSearch={() => {
            setShowDetails(false);
            setShowSearchBar(true);
          }}
        />
      </div>
    );
  }

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleSend = () => {
    const text = (typeof inputValue === 'string' ? inputValue : (inputValue?.text || '')).trim();
    const mentions = inputValue?.mentions || [];
    if (!text || conversation.blocked) return;
    onSendMessage(conversation.id, text, replyingTo, mentions, null, null);
    setInputValue({ text: '', mentions: [] });
    setShowEmojiPicker(false);
    setReplyingTo(null);
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
    }, 2500);
  };

  const reactionsList = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

  return (
    <div className={`${styles.msgChatArea}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`} onClick={() => setShowMoreMenu(false)}>
      {/* Voice Call Overlay */}
      {isCalling && (
        <div className={styles.callOverlay}>
          <div className={styles.callCard}>
            <div className={styles.callAvatarContainer}>
              <div className={`${styles.callAvatarPulse} ${styles.pulse1}`} />
              <div className={`${styles.callAvatarPulse} ${styles.pulse2}`} />
              <Avatar 
                src={conversation.avatar} 
                name={conversation.name} 
                size="112px" 
                isGroup={conversation.isGroup || conversation.isActivityChat} 
                className={styles.callAvatar} 
              />
            </div>
            <div className={styles.callName}>{conversation.name}</div>
            <div className={styles.callStatus}>
              {callDuration === 0 ? 'Connecting...' : formatDuration(callDuration)}
            </div>

            {callDuration > 0 && (
              <div className={styles.callWaveform}>
                <span className={`${styles.waveBar} ${styles.bar1}`} />
                <span className={`${styles.waveBar} ${styles.bar2}`} />
                <span className={`${styles.waveBar} ${styles.bar3}`} />
                <span className={`${styles.waveBar} ${styles.bar4}`} />
                <span className={`${styles.waveBar} ${styles.bar5}`} />
                <span className={`${styles.waveBar} ${styles.bar6}`} />
                <span className={`${styles.waveBar} ${styles.bar7}`} />
              </div>
            )}

            <div className={styles.callControls}>
              <button
                className={`${styles.callBtn} ${isMuted ? styles.active : ''}`}
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isMuted ? (
                    <>
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </>
                  ) : (
                    <>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </>
                  )}
                </svg>
              </button>

              <button
                className={`${styles.callBtn} ${styles.callEndBtn}`}
                onClick={() => setIsCalling(false)}
                title="End Call"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                  <line x1="3" y1="21" x2="21" y2="3" strokeWidth="2.5" />
                </svg>
              </button>

              <button
                className={`${styles.callBtn} ${isSpeakerOn ? styles.active : ''}`}
                onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                title={isSpeakerOn ? 'Speaker Off' : 'Speaker On'}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.msgChatHeader} onClick={() => setShowDetails(true)}>
        <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`}>
          {onBack && (
            <button className={styles.msgChatBackBtn} onClick={(e) => { e.stopPropagation(); onBack(); }} title="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
          )}
          <Avatar 
            src={conversation.avatar} 
            name={conversation.name} 
            size="38px" 
            isGroup={conversation.isGroup || conversation.isActivityChat} 
            isOnline={!conversation.isGroup && !conversation.isActivityChat && (() => {
              const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
              const canSee = targetUser ? canSeeOnlineStatus(currentUser, targetUser) : true;
              return canSee && targetUser?.isOnline;
            })()} 
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={styles.msgChatName}>
              <span className={styles.msgChatNameText}>{conversation.name}</span>
              {conversation.blocked && (
                <span className={styles.msgBlockedBadge}>Blocked</span>
              )}
            </div>
            {!conversation.isActivityChat && (
              <div className={styles.msgChatStatus}>
                {(() => {
                  if (conversation.status === 'Closed') {
                    return <span style={{ color: '#ef4444' }}>Closed</span>;
                  }
                  if (conversation.isGroup) {
                    return null;
                  }
                  
                  const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
                  const canSeeOnline = targetUser ? canSeeOnlineStatus(currentUser, targetUser) : true;
                  const canSeeSeen = targetUser ? canSeeLastSeen(currentUser, targetUser) : true;
                  
                  if (canSeeOnline && targetUser?.isOnline) {
                    return 'Online';
                  } else if (canSeeSeen && targetUser?.lastActive) {
                    return `Last seen ${formatLastSeen(targetUser.lastActive)}`;
                  } else {
                    return 'Offline';
                  }
                })()}
              </div>
            )}
          </div>
        </div>
        <div className={styles.msgChatActions} onClick={(e) => e.stopPropagation()}>
          <button 
            className={`${styles.msgChatActionBtn} ${isCalling ? styles.msgChatActionBtnActive : ''}`} 
            title="Voice Call"
            onClick={() => setIsCalling(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          <div style={{ position: 'relative' }}>
            <button 
              className={`${styles.msgChatActionBtn} ${showMoreMenu ? styles.msgChatActionBtnActive : ''}`} 
              title="More"
              onClick={() => setShowMoreMenu(!showMoreMenu)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            {showMoreMenu && (
              <div className={styles.msgMoreDropdown}>
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { setShowSearchBar(!showSearchBar); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Find
                </button>
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { setIsMutedNotifications(!isMutedNotifications); setShowMoreMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {isMutedNotifications ? (
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0M1 1l22 22" />
                    ) : (
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                    )}
                  </svg>
                  {isMutedNotifications ? 'Unmute Alerts' : 'Mute Alerts'}
                </button>
                {conversation.isActivityChat ? (
                  <>
                    <button 
                      className={styles.msgDropdownItem} 
                      onClick={() => { setShowDetails(true); setShowMoreMenu(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      Group Info
                    </button>
                    {isActivityHost && (
                      <button 
                        className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                        onClick={() => { setShowMoreMenu(false); handleEndActivityFromChat(); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        End Activity
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {conversation.isGroup ? (
                      <button 
                        className={styles.msgDropdownItem} 
                        onClick={() => { setShowDetails(true); setShowMoreMenu(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        Group Info
                      </button>
                    ) : (
                      <button 
                        className={styles.msgDropdownItem} 
                        onClick={() => { setShowDetails(true); setShowMoreMenu(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        Contact Info
                      </button>
                    )}
                    <button 
                      className={styles.msgDropdownItem} 
                      onClick={() => { onClearChat && onClearChat(); setShowMoreMenu(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      Clear Chat
                    </button>
                    {!conversation.isGroup && (
                      <button 
                        className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                        onClick={() => { onBlockUser && onBlockUser(); setShowMoreMenu(false); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                        {conversation.blocked ? 'Unblock Contact' : 'Block Contact'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline Search Bar */}
      {showSearchBar && (
        <div className={styles.msgSearchBar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search messages..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.msgSearchBarInput}
            autoFocus
          />
          <button 
            className={styles.msgSearchBarClose} 
            onClick={() => { setShowSearchBar(false); setSearchQuery(''); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}


      <div className={styles.msgChatBody} ref={bodyRef}>
        {isLoading && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-start' }}>
               <Skeleton type="rect" width="55%" height="3.5rem" style={{ borderRadius: '16px 16px 16px 0' }} />
            </div>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-end' }}>
               <Skeleton type="rect" width="45%" height="2.5rem" style={{ borderRadius: '16px 16px 0 16px' }} />
            </div>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-start' }}>
               <Skeleton type="rect" width="65%" height="4.5rem" style={{ borderRadius: '16px 16px 16px 0' }} />
            </div>
          </div>
        )}

        {!isLoading && error && (
          <ErrorState onRetry={retry} />
        )}

        {!isLoading && !error && loadedMessages && loadedMessages.length === 0 ? (
          <div className={styles.msgEmptyState}>No messages in this chat.</div>
        ) : (
          !isLoading && !error && loadedMessages && loadedMessages.map((msg, i) => {
            if (msg.type === 'system') {
              const parts = msg.text.split(/(@[a-zA-Z0-9_]+)/g);
              return (
                <div key={i} className={styles.systemMessageContainer}>
                  <div className={styles.systemMessageText}>
                    {parts.map((part, idx) => {
                      if (part.startsWith('@')) {
                        const username = part.substring(1);
                        return (
                          <span 
                            key={idx} 
                            style={{ color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 600 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/profile/${username}`);
                            }}
                          >
                            {part}
                          </span>
                        );
                      }
                      return <span key={idx}>{part}</span>;
                    })}
                  </div>
                </div>
              );
            }

            const hasQuery = searchQuery && msg.text.toLowerCase().includes(searchQuery.toLowerCase());
            const shouldDim = searchQuery && !hasQuery;
            
            return (
              <div 
                key={i} 
                className={`${styles.msgBubbleContainer} ${msg.from === 'me' ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
                style={{ opacity: shouldDim ? 0.45 : 1 }}
              >
                <div className={styles.msgBubbleWrapper}>
                  {(conversation.isGroup || conversation.isActivityChat) && (
                    <Avatar
                      src={
                        msg.from === 'me' 
                          ? (currentUser?.avatar && isImageUrl(currentUser.avatar) ? currentUser.avatar : initial)
                          : (() => {
                              let avatarUrl = msg.senderAvatar;
                              if (!avatarUrl && users && msg.senderName) {
                                const userObj = Object.values(users).find(u => u.displayName === msg.senderName || u.username === msg.senderName || u.name === msg.senderName);
                                if (userObj) avatarUrl = userObj.avatar;
                              }
                              return avatarUrl || (msg.senderName || 'M').charAt(0).toUpperCase();
                            })()
                      }
                      name={msg.from === 'me' ? 'Me' : msg.senderName}
                      size="28px"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (msg.from === 'me') {
                          if (currentUser?.username) {
                            navigate(`/profile/${currentUser.username}`);
                          }
                        } else {
                          if (users && msg.senderName) {
                            const userObj = Object.values(users).find(u => u.displayName === msg.senderName || u.username === msg.senderName || u.name === msg.senderName);
                            if (userObj && userObj.username) {
                              navigate(`/profile/${userObj.username}`);
                            }
                          }
                        }
                      }}
                    />
                  )}
                  <div className={styles.msgBubbleContent}>
                    {(conversation.isGroup || conversation.isActivityChat) && msg.from !== 'me' && (
                      <div className={styles.msgSenderName}>
                        {msg.senderName || 'Member'}
                      </div>
                    )}
                    {/* ── Audio Card ── */}
                    {msg.mediaUrl && msg.mediaType === 'audio' && (
                      <div className={styles.msgAudioCardContainer}>
                        <audio src={msg.mediaUrl} controls className={styles.msgAudioPlayer} />
                        {(!msg.text && !msg.linkPreview && !msg.inviteData) && (
                          <div className={`${styles.msgImageFooter} ${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                            <span>{msg.time}</span>
                            {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Standalone Media Card ── */}
                    {msg.mediaUrl && (msg.mediaType === 'image' || msg.mediaType === 'video') && (
                      <div className={styles.msgImageCardContainer}>
                        <div className={styles.msgImageCard}>
                          {msg.mediaType === 'image' ? (
                            <img
                              src={msg.mediaUrl}
                              alt="Attachment"
                              className={styles.msgMediaImgStandalone}
                              onClick={() => openViewer(
                                [{ url: msg.mediaUrl, type: 'image' }],
                                0,
                                null
                              )}
                            />
                          ) : (
                            <div
                              className={styles.msgMediaVideoWrapperStandalone}
                              onClick={() => openViewer(
                                [{ url: msg.mediaUrl, type: 'video' }],
                                0,
                                null
                              )}
                            >
                              <video
                                src={msg.mediaUrl}
                                className={styles.msgMediaImgStandalone}
                                preload="metadata"
                              />
                              <div className={styles.msgMediaVideoPlayBtn}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                                  <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                              </div>
                            </div>
                          )}
                        </div>
                        {(!msg.text && !msg.linkPreview && !msg.inviteData) && (
                          <div className={`${styles.msgImageFooter} ${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                            <span>{msg.time}</span>
                            {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                          </div>
                        )}
                      </div>
                    )}

                    {(msg.text || msg.linkPreview || msg.inviteData) && (
                    <div className={`${styles.msgBubble} ${msg.from === 'me' ? styles.msgBubbleMe : styles.msgBubbleThem} ${((msg.inviteData?.type === 'activityShare' || msg.inviteData?.type === 'postShare' || msg.inviteData?.type === 'profileShare' || msg.inviteData?.type === 'collegeShare') && !msg.text) ? styles.msgBubbleTransparent : ''}`}>
                      <div className={styles.msgText}>
                      {/* ── Text content ── */}
                      {msg.text && (searchQuery && hasQuery ? (
                        (() => {
                          const idx = msg.text.toLowerCase().indexOf(searchQuery.toLowerCase());
                          const length = searchQuery.length;
                          return (
                            <>
                              {msg.text.substring(0, idx)}
                              <mark className={styles.msgSearchHighlight}>{msg.text.substring(idx, idx + length)}</mark>
                              {msg.text.substring(idx + length)}
                            </>
                          );
                        })()
                      ) : (
                        <RichText content={msg.text} mentions={msg.mentions} urlLimit={40} />
                      ))}

                      {msg.linkPreview && (
                        <a
                          href={msg.linkPreview.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.msgLinkPreview}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {msg.linkPreview.image && (
                            <img src={msg.linkPreview.image} alt="" className={styles.msgLinkPreviewImg} />
                          )}
                          <div className={styles.msgLinkPreviewBody}>
                            {msg.linkPreview.site && (
                              <span className={styles.msgLinkPreviewSite}>{msg.linkPreview.site}</span>
                            )}
                            <span className={styles.msgLinkPreviewTitle}>{msg.linkPreview.title}</span>
                            {msg.linkPreview.description && (
                              <span className={styles.msgLinkPreviewDesc}>{msg.linkPreview.description}</span>
                            )}
                          </div>
                        </a>
                      )}

                      
                      {msg.inviteData && msg.inviteData.type === 'activityShare' ? (
                        (() => {
                          const dbActivity = crewActivities?.find(act => act.id === msg.inviteData.activity.id) || {};
                          const activity = { ...dbActivity, ...msg.inviteData.activity };
                          
                          const activityDate = new Date(activity.date || Date.now());
                          const monthStr = activityDate.toLocaleString('default', { month: 'short' }).toUpperCase();
                          const dayStr = activityDate.getDate();
                          return (
                            <div className={styles.activityShareCardNew} onClick={() => navigate('/crew/' + activity.id)}>
                              {(activity.image || activity.coverImage) && (
                                <img src={activity.image || activity.coverImage} className={styles.activityShareCover} alt="Cover" />
                              )}
                              <div className={styles.activityShareContentNew}>
                                <div className={styles.activityShareDateBox}>
                                  <span className={styles.activityShareDateMonth}>{monthStr}</span>
                                  <span className={styles.activityShareDateDay}>{dayStr}</span>
                                </div>
                                <div className={styles.activityShareInfoNew}>
                                  <div className={styles.activityShareTitleNew}>
                                    <span>{activity.title}</span>
                                  </div>
                                  <div className={styles.activityShareMetaRowNew}>
                                    {activity.dateLabel || activityDate.toLocaleDateString()} • {activity.time}
                                  </div>
                                  {activity.location && (
                                    <div className={styles.activityShareMetaRowNew}>
                                      {activity.location}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()
                      ) : msg.inviteData && msg.inviteData.type === 'postShare' ? (
                        <div className={styles.postShareCard} onClick={() => navigate('/post/' + msg.inviteData.post.id)}>
                          <div className={styles.postShareLeft}>
                            <div className={styles.postShareHeader}>
                              <span className={`${styles.postShareBadge} ${msg.inviteData.post.pollQuestion ? styles.badgePoll : styles.badgePost}`}>
                                {msg.inviteData.post.pollQuestion ? 'Poll' : 'Post'}
                              </span>
                              <div className={styles.postShareAuthor}>
                                {isImageUrl(msg.inviteData.post.authorAvatar) ? (
                                  <img src={msg.inviteData.post.authorAvatar} alt={msg.inviteData.post.authorName} className={styles.postShareAuthorAvatar} />
                                ) : (
                                  <DefaultAvatar name={msg.inviteData.post.authorName} size={16} className={styles.postShareAuthorAvatar} />
                                )}
                                <span className={styles.postShareAuthorName}>
                                  Shared from <strong>{msg.inviteData.post.authorName}</strong>
                                </span>
                              </div>
                            </div>

                            <div className={styles.postShareBody}>
                              {msg.inviteData.post.text && (
                                <p className={styles.postShareText}><RichText content={msg.inviteData.post.text} mentions={msg.inviteData.post.mentions} /></p>
                              )}
                              {msg.inviteData.post.pollQuestion && (
                                <div className={styles.postSharePollQuestion}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="8" x2="9" y2="16" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="15" y1="6" x2="15" y2="16" /></svg>
                                  <span>{msg.inviteData.post.pollQuestion}</span>
                                </div>
                              )}
                            </div>

                            <div className={styles.postShareFooter}>
                              <span className={styles.postShareTime}>{msg.inviteData.post.time || 'Recent'}</span>
                            </div>
                          </div>

                          <div className={styles.postShareRight}>
                            <button className={styles.postShareBtn}>
                              View
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                            </button>
                          </div>
                        </div>
                      ) : msg.inviteData && msg.inviteData.type === 'profileShare' ? (
                        <div className={styles.profileShareCard} onClick={() => navigate('/profile/' + msg.inviteData.profile.username)}>
                          <div className={styles.profileShareLeft}>
                            <div className={styles.profileShareHeader}>
                              <span className={styles.profileShareBadge}>Profile</span>
                            </div>
                            
                            <div className={styles.profileShareInfo}>
                              {isImageUrl(msg.inviteData.profile.avatar) ? (
                                <img src={msg.inviteData.profile.avatar} alt={msg.inviteData.profile.displayName} className={styles.profileShareAvatar} />
                              ) : (
                                <DefaultAvatar name={msg.inviteData.profile.displayName} size={48} className={styles.profileShareAvatar} />
                              )}
                              <div className={styles.profileShareDetails}>
                                <div className={styles.profileShareName}>{msg.inviteData.profile.displayName}</div>
                                <div className={styles.profileShareUsername}>@{msg.inviteData.profile.username}</div>
                              </div>
                            </div>

                            {msg.inviteData.profile.bio && (
                              <p className={styles.profileShareBio}>{msg.inviteData.profile.bio}</p>
                            )}

                            <div className={styles.profileShareStats}>
                              <span className={styles.profileShareStat}><strong>{msg.inviteData.profile.followers || 0}</strong> Followers</span>
                              <span className={styles.profileShareStat}><strong>{msg.inviteData.profile.following || 0}</strong> Following</span>
                            </div>
                          </div>

                          <div className={styles.profileShareRight}>
                            <button className={styles.profileShareBtn}>
                              View
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                            </button>
                          </div>
                        </div>
                      ) : msg.inviteData && msg.inviteData.type === 'collegeShare' ? (
                        <div className={styles.profileShareCard} onClick={() => navigate('/campus')}>
                          <div className={styles.profileShareLeft}>
                            <div className={styles.profileShareHeader}>
                              <span className={styles.profileShareBadge} style={{ background: 'linear-gradient(135deg, #1D4ED8, #3B82F6)', color: 'white' }}>College</span>
                            </div>
                            
                            <div className={styles.profileShareInfo}>
                              {isImageUrl(msg.inviteData.college.avatar) ? (
                                <img src={msg.inviteData.college.avatar} alt={msg.inviteData.college.name} className={styles.profileShareAvatar} style={{ borderRadius: '8px', objectFit: 'contain', background: '#f8fafc', padding: '4px' }} />
                              ) : (
                                <div className={styles.profileShareAvatar} style={{ background: msg.inviteData.college.color || 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '1.2rem', borderRadius: '8px' }}>
                                  {msg.inviteData.college.name?.charAt(0) || 'C'}
                                </div>
                              )}
                              <div className={styles.profileShareDetails}>
                                <div className={styles.profileShareName}>{msg.inviteData.college.name}</div>
                                <div className={styles.profileShareUsername}>Official Space</div>
                              </div>
                            </div>

                            {msg.inviteData.college.desc && (
                              <p className={styles.profileShareBio}>{msg.inviteData.college.desc}</p>
                            )}

                            <div className={styles.profileShareStats}>
                              <span className={styles.profileShareStat}><strong>{msg.inviteData.college.members?.toLocaleString() || 0}</strong> Members</span>
                            </div>
                          </div>

                          <div className={styles.profileShareRight}>
                            <button className={styles.profileShareBtn}>
                              View Space
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                            </button>
                          </div>
                        </div>
                      ) : msg.inviteData ? (
                        <div className={styles.msgInviteCard}>
                          <div className={styles.msgInviteIcon}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                              <circle cx="9" cy="7" r="4"></circle>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                          </div>
                          <div className={styles.msgInviteContent}>
                            <div className={styles.msgInviteTitle}>Group Invitation</div>
                            <div className={styles.msgInviteName}>{msg.inviteData.groupName}</div>
                          </div>
                          <button 
                            className={styles.msgInviteBtn}
                            onClick={() => onJoinGroup && onJoinGroup(msg.inviteData.groupId)}
                          >
                            Join Group
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {msg.inviteData && !msg.text && !msg.linkPreview ? (
                      <div style={{ display: 'flex', justifyContent: msg.from === 'me' ? 'flex-end' : 'flex-start', marginTop: '4px' }}>
                        <div className={`${styles.msgImageFooter} ${msg.from === 'me' ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
                          <span>{msg.time}</span>
                          {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.msgTimeLabel}>
                        {msg.time}
                        {msg.from === 'me' && !conversation.isGroup && !conversation.isActivityChat && getReadStatusIcon(msg)}
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </div>
            </div>
          );
          })
        )}
        {isTyping && !isLoading && (
          <div className={`${styles.msgBubbleContainer} ${styles.msgBubbleContainerThem}`}>
            <div className={styles.msgBubbleWrapper}>
              <div className={`${styles.msgBubble} ${styles.msgBubbleThem}`}>
                <div className={styles.typingIndicator}>
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input container */}
      <div className={styles.msgChatInputWrap}>
        {/* Reply preview bar */}
        {replyingTo && (
          <div className={styles.msgReplyPreview}>
            <div className={styles.msgReplyPreviewDetails}>
              <span className={styles.msgReplyPreviewLabel}>
                Replying to {replyingTo.from === 'me' ? 'yourself' : conversation.name}
              </span>
              <span className={styles.msgReplyPreviewText}>{replyingTo.text}</span>
            </div>
            <button className={styles.msgReplyPreviewClose} onClick={() => setReplyingTo(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {showEmojiPicker && (
          <div style={{ position: 'absolute', bottom: '100%', left: '1.25rem', marginBottom: '0.5rem', zIndex: 100 }}>
            <Suspense fallback={<div style={{ padding: '1rem', background: 'var(--color-bg-white)', borderRadius: '12px', border: '1px solid #e4e4e7', fontSize: '0.85rem' }}>Loading Emojis...</div>}>
              <Picker 
                data={data} 
                onEmojiSelect={(emoji) => setInputValue((prev) => {
                  const currentText = typeof prev === 'string' ? prev : (prev?.text || '');
                  const currentMentions = prev?.mentions || [];
                  return { text: currentText + emoji.native, mentions: currentMentions };
                })} 
                theme="light"
              />
            </Suspense>
          </div>
        )}
        
        {conversation.status === 'Closed' ? (
          <div className={styles.msgBlockedInputOverlay}>
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>This group has been closed by the Owner. This chat is now read-only.</span>
          </div>
        ) : (conversation.isGroup && !(conversation.members || conversation.participants || []).includes(currentUser?.id)) ? (
          <div className={styles.msgBlockedInputOverlay}>
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>You are no longer a member of this group.</span>
          </div>
        ) : conversation.blocked ? (
          <div className={styles.msgBlockedInputOverlay}>
            <span>This contact is blocked.</span>
            <button 
              type="button" 
              className={styles.unblockBannerBtn}
              onClick={onBlockUser}
            >
              Unblock
            </button>
          </div>
        ) : isRecording ? (
          <div className={styles.msgRecordingContainer}>
            <div className={styles.msgRecordingLeft}>
              <span className={styles.msgRecordingDot} />
              <span className={styles.msgRecordingTime}>{formatDuration(recordingTime)}</span>
            </div>
            <div className={styles.msgRecordingActions}>
              <button 
                type="button" 
                className={styles.msgRecordingDeleteBtn} 
                onClick={deleteRecording}
                title="Delete Recording"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
              <button 
                type="button" 
                className={styles.msgRecordingSendBtn} 
                onClick={sendRecording}
                title="Send Voice Message"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Hidden file input for attachments */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            <button className={styles.msgEmojiBtn} title="Emoji" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9" y2="9" /><line x1="15" y1="9" x2="15" y2="9" />
              </svg>
            </button>

            <button 
              className={`${styles.msgAttachBtn} ${hasText ? styles.attachBtnHidden : ''}`} 
              title="Attach image or video" 
              onClick={handleAttachClick}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <div className={styles.inputWrapper}>
              <MentionInput
                className={styles.msgInput}
                placeholder="Type a message..."
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSend}
                singleLine={true}
                communityId={conversation?.isGroup || conversation?.isActivityChat ? conversation?.id : null}
              />
            </div>

            <div className={styles.rightActionContainer}>
              {hasText ? (
                <button 
                  type="button"
                  className={styles.msgSendBtn} 
                  onClick={handleSend}
                  title="Send"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              ) : (
                <button 
                  type="button"
                  className={styles.msgMicBtn} 
                  onClick={startRecording}
                  title="Record Voice"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {showGroupSettings && (
        <GroupSettingsModal
          conversation={conversation}
          onClose={() => setShowGroupSettings(false)}
          onLeaveGroup={() => {
            if (leaveGroup) leaveGroup(conversation.id);
            setShowGroupSettings(false);
            onBack();
          }}
        />
      )}

      {showActivityDetails && (
        <ActivityChatDetailsModal 
          conversation={conversation} 
          onClose={() => setShowActivityDetails(false)} 
          onEndActivity={() => {
            setShowActivityDetails(false);
            if (onBack) onBack();
          }}
        />
      )}

      <ConfirmModal
        title="End Activity"
        desc="Are you sure you want to end this activity? This will also delete the group chat."
        visible={showEndConfirm}
        onCancel={() => setShowEndConfirm(false)}
        onConfirm={confirmEndActivityFromChat}
        confirmText="End Activity"
      />
    </div>
  );
}
