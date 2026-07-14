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
import CalendarIcon from '../common/CalendarIcon';
import { ErrorState } from '../common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import MentionInput from '../common/mentions/MentionInput';
import RichText from '../common/mentions/RichText';
import { canSeeOnlineStatus, canSeeLastSeen, formatLastSeen } from '../../utils/presence';
import styles from './ChatArea.module.css';
import { useMediaViewer } from '../../context/MediaViewerContext';
import { SharedPostPreview } from '../chat/SharedPostPreview';
import { SharedProfilePreview } from '../chat/SharedProfilePreview';

const Picker = lazy(() => import('@emoji-mart/react'));

const VoiceMessagePlayer = ({ src, fromMe }) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleDurationChange = () => {
    if (audioRef.current && isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const toggleSpeed = () => {
    const speeds = [1, 1.5, 2];
    const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const formatTime = (secs) => {
    if (!secs || isNaN(secs) || !isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className={`${styles.voicePlayerContainer} ${fromMe ? styles.voicePlayerMe : ''}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onEnded={handleEnded}
      />
      <button
        type="button"
        className={styles.voicePlayBtn}
        onClick={togglePlay}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5" />
            <rect x="14" y="4" width="4" height="16" rx="1.5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4l14 8-14 8V4z" />
          </svg>
        )}
      </button>

      <div className={styles.voicePlayerCenter}>
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className={styles.voiceScrubber}
          style={{ '--progress': `${progressPercent}%` }}
        />
        <span className={styles.voiceTimeText}>
          {currentTime > 0 ? formatTime(currentTime) : formatTime(duration)}
        </span>
      </div>

      <button
        type="button"
        className={styles.voiceSpeedBtn}
        onClick={toggleSpeed}
        title="Playback speed"
      >
        {playbackSpeed}x
      </button>
    </div>
  );
};

export default function ChatArea({ conversation, onSendMessage, onReactMessage, onClearChat, onBlockUser, onJoinGroup, onBack, showChatOnMobile }) {
  const { openViewer } = useMediaViewer();
  const navigate = useNavigate();
  const { initial, currentUser } = useAuth();
  const { users, crewActivities, endCrewActivity, leaveGroup, conversations, campusGroups } = useData();
  const conversationActivity = useMemo(() => {
    if (!conversation?.isActivityChat || !conversation?.activityId) return null;
    return crewActivities?.find(act => String(act.id) === String(conversation.activityId) || `act_${act.id}` === String(conversation.id) || String(act.id) === String(conversation.id));
  }, [conversation, crewActivities]);
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

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const reactionsList = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

  return (
    <div className={`${styles.msgChatArea}${!showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`} onClick={() => setShowMoreMenu(false)}>


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
          {conversation.isActivityChat ? (
            <Avatar 
              src={conversation.avatar} 
              name={conversation.name} 
              size="38px" 
              isGroup={true} 
            />
          ) : (
            <Avatar 
              src={conversation.avatar} 
              name={conversation.name} 
              size="38px" 
              isGroup={conversation.isGroup} 
              isOnline={!conversation.isGroup && (() => {
                const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
                const canSee = targetUser ? canSeeOnlineStatus(currentUser, targetUser) : true;
                return canSee && targetUser?.isOnline;
              })()} 
            />
          )}
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
            const isGroupInvite = msg.inviteData && !msg.inviteData.type;
            
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
                        <VoiceMessagePlayer src={msg.mediaUrl} fromMe={msg.from === 'me'} />
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
                    <div className={`${styles.msgBubble} ${msg.from === 'me' ? styles.msgBubbleMe : styles.msgBubbleThem} ${(isGroupInvite || ((msg.inviteData?.type === 'activityShare' || msg.inviteData?.type === 'postShare' || msg.inviteData?.type === 'profileShare' || msg.inviteData?.type === 'collegeShare') && !msg.text)) ? styles.msgBubbleTransparent : ''}`}>
                      <div className={styles.msgText}>
                      {/* ── Text content ── */}
                      {msg.text && !isGroupInvite && (searchQuery && hasQuery ? (
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
                          return (
                            <div className={styles.activityShareCardNew} onClick={() => navigate('/crew/' + activity.id)}>
                              {(activity.image || activity.coverImage) && (
                                <img src={activity.image || activity.coverImage} className={styles.activityShareCover} alt="Cover" />
                              )}
                              <div className={styles.activityShareContentNew}>
                                <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
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
                        <SharedPostPreview post={msg.inviteData.post} />
                      ) : msg.inviteData && msg.inviteData.type === 'profileShare' ? (
                        <SharedProfilePreview 
                          profile={msg.inviteData.profile} 
                          currentUserId={currentUser?.id} 
                        />
                      ) : msg.inviteData && msg.inviteData.type === 'communityShare' ? (
                        <div className={styles.profileShareCard} onClick={() => navigate('/communities/' + msg.inviteData.community.id)}>
                          <div className={styles.profileShareLeft}>
                            <div className={styles.profileShareHeader}>
                              <span className={styles.profileShareBadge} style={{ background: 'var(--color-primary)', color: 'white' }}>Community</span>
                            </div>
                            
                            <div className={styles.profileShareInfo}>
                              {isImageUrl(msg.inviteData.community.avatar) ? (
                                <img src={msg.inviteData.community.avatar} alt={msg.inviteData.community.name} className={styles.profileShareAvatar} style={{ borderRadius: '8px', objectFit: 'cover' }} />
                              ) : (
                                <div className={styles.profileShareAvatar} style={{ background: msg.inviteData.community.color || 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '1.2rem', borderRadius: '8px' }}>
                                  {msg.inviteData.community.name?.charAt(0).toUpperCase() || 'C'}
                                </div>
                              )}
                              <div className={styles.profileShareDetails}>
                                <div className={styles.profileShareName}>{msg.inviteData.community.name}</div>
                                <div className={styles.profileShareUsername}>@{msg.inviteData.community.id}</div>
                              </div>
                            </div>

                            {msg.inviteData.community.description && (
                              <p className={styles.profileShareBio}>{msg.inviteData.community.description}</p>
                            )}

                            <div className={styles.profileShareStats}>
                              <span className={styles.profileShareStat}><strong>{msg.inviteData.community.membersCount?.toLocaleString() || 0}</strong> Members</span>
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
                      ) : msg.inviteData ? ( (() => {
                        const targetGroupId = msg.inviteData.groupId;
                        const groupInfo = (conversations || []).find(c => String(c.id) === String(targetGroupId)) || 
                                          (campusGroups && campusGroups[targetGroupId]);
                        
                        const otherUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
                        const inviterUser = msg.from === 'me' ? currentUser : otherUser;
                        
                        let groupMembers = [];
                        if (groupInfo) {
                          if (Array.isArray(groupInfo.members)) {
                            groupInfo.members.forEach(uid => {
                              const u = Object.values(users).find(usr => String(usr.id) === String(uid));
                              if (u) groupMembers.push(u);
                            });
                          } else if (Array.isArray(groupInfo.memberList)) {
                            groupInfo.memberList.forEach(m => {
                              groupMembers.push({
                                id: m.id,
                                avatar: m.avatar,
                                displayName: m.name,
                                username: m.username
                              });
                            });
                          }
                        }
                        
                        // Fallback to inviter/creator if members list is empty
                        if (groupMembers.length === 0 && inviterUser) {
                          groupMembers.push(inviterUser);
                        }
                        
                        const memberCount = groupMembers.length;

                        return (
                          <div className={styles.premiumInviteCard}>
                            <div className={styles.inviteBanner}>
                              <div className={styles.inviteBannerContent}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  <Avatar 
                                    src={groupInfo?.avatar} 
                                    name={groupInfo?.name || msg.inviteData.groupName} 
                                    size="44px" 
                                    isGroup 
                                  />
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <h3 className={styles.inviteGroupName}>
                                      {groupInfo?.name || msg.inviteData.groupName}
                                    </h3>
                                    <span className={styles.inviteMemberCountSub}>
                                      {memberCount} {memberCount === 1 ? 'member' : 'members'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            <div className={styles.inviteFooter}>
                              <div className={styles.inviteFooterLeft}>
                                <div className={styles.memberStackRow} style={{ marginTop: 0 }}>
                                  <div className={styles.avatarStack}>
                                    {groupMembers.slice(0, 3).map((m, idx) => (
                                      <div 
                                        key={m.id || idx} 
                                        className={styles.stackedAvatar} 
                                        style={{ zIndex: 3 - idx }}
                                      >
                                        <Avatar 
                                          src={m.avatar} 
                                          name={m.displayName || m.username} 
                                          size="24px" 
                                        />
                                      </div>
                                    ))}
                                    {memberCount > 3 && (
                                      <div className={styles.avatarMorePill}>
                                        +{memberCount - 3}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className={styles.inviteDivider} />
                              
                              <div className={styles.inviteButtonsRight}>
                                <button 
                                  className={styles.joinBtn} 
                                  onClick={() => onJoinGroup && onJoinGroup(msg.inviteData.groupId)}
                                >
                                  Join Group
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                    <polyline points="12 5 19 12 12 19" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })()
                      ) : null}
                    </div>
                    {(isGroupInvite || (msg.inviteData && !msg.text && !msg.linkPreview)) ? (
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
                Replying to {replyingTo.from === 'me' ? 'yourself' : (replyingTo.senderName || conversation.name)}
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
        ) : (conversation.isGroup && !(conversation.members || conversation.participants || []).map(String).includes(String(currentUser?.id))) ? (
          <div className={styles.msgBlockedInputOverlay}>
            <span style={{ color: 'var(--color-text-main)', fontWeight: 'bold' }}>
              {String(conversation.id).startsWith('c_') ? 'You are not a member of this campus group.' : 'You are no longer a member of this group.'}
            </span>
            {String(conversation.id).startsWith('c_') && (
              <button 
                type="button" 
                className={styles.unblockBannerBtn}
                onClick={() => onJoinGroup(conversation.id)}
                style={{ marginLeft: '1rem' }}
              >
                Join Group
              </button>
            )}
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
