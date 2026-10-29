import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { Reply, MoreVertical, Image as ImageIcon, AlertCircle, Play } from '@shared/components/icons';
import Avatar from '@shared/components/avatar/Avatar';
import { useSignedMediaSrc } from '@shared/hooks/useSignedMediaSrc';
import RichText from '@shared/components/mentions/RichText';
import { generateConversationUrl } from '@shared/utils/conversationUrl';
import { isSystemMessage } from '../utils/cacheUtils';
import { departureLineFor } from '../utils/messagePreview';
import { SharedPostPreview } from '../previews/SharedPostPreview';
import { SharedProfilePreview } from '../previews/SharedProfilePreview';
import { SharedCommunityPreview } from '../previews/SharedCommunityPreview';
import ReplyPreviewContent from './ReplyPreviewContent';
import { PostReplyPreview, isPostReply } from './reply';
import { SharedActivityPreview } from '../previews/SharedActivityPreview';
import { SharedConfessionPreview } from '../previews/SharedConfessionPreview';
import { useConfession } from '@shared/hooks/useConfessions';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import styles from './ChatMessageList.module.css';
import { useJoinCommunity } from '@features/communities/hooks/useJoinCommunity';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchGroupPreview } from '@features/messages/hooks/useGroupInvite';
import GroupPreviewSheet from './modals/GroupPreviewSheet';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { checkIsMe, getMsgTimestamp } from '../utils/cacheUtils';
import { describeSendFailure } from '../utils/sendFailure';
import MediaUnavailable from './MediaUnavailable';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { isOnline } from '@shared/lib/networkStatus';
import { getMediaUrl } from '@shared/api/apiClient';
import { normalizeBodyText, truncateBodyText } from '@shared/utils/bodyText';

// Messages longer than this are clipped behind a "Show more" toggle.
const MSG_LIMITS = { maxChars: 300, maxLines: 10 };

// How long a finger must stay put before the message menu opens, and how far it
// may drift while doing so. The drift budget is what separates a deliberate
// press from the brief pause everyone makes mid-scroll.
const LONG_PRESS_DELAY_MS = 600;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

function MessageHoverActions({ msg, isMe, onReplyTo, onContextMenu }) {
  const handleReply = (e) => {
    e.stopPropagation();
    if (onReplyTo) onReplyTo(msg);
  };

  const handleMore = (e) => {
    e.stopPropagation();
    if (onContextMenu) onContextMenu(e, msg);
  };

  if (!onReplyTo && !onContextMenu) return null;

  return (
    <div className={`${styles.msgHoverActions} ${isMe ? styles.msgHoverActionsMe : styles.msgHoverActionsThem}`}>
      {onReplyTo && (
        <button
          type="button"
          className={styles.msgHoverBtn}
          onClick={handleReply}
          title="Reply"
          aria-label="Reply to message"
        >
          <Reply size={14} />
        </button>
      )}
      {onContextMenu && (
        <button
          type="button"
          className={styles.msgHoverBtn}
          onClick={handleMore}
          title="More options"
          aria-label="More message options"
        >
          <MoreVertical size={14} />
        </button>
      )}
    </div>
  );
}

/** A system line's text, with each @handle a link to that profile. */
export function SystemMessageContent({ text, navigate }) {
  if (!text) return 'System Event';
  const strText = String(text);

  const regex = /(@\[([^\]]+)\]\(([^)]+)\)|@([a-zA-Z0-9_.-]+))/g;
  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(strText)) !== null) {
    if (match.index > lastIndex) {
      elements.push(
        <span key={`text_${lastIndex}`} className={styles.systemNonSelectableText}>
          {strText.slice(lastIndex, match.index)}
        </span>
      );
    }

    const fullMention = match[0];
    const mentionUsername = match[2] || match[4] || fullMention.replace(/^@/, '');

    elements.push(
      <span
        key={`mention_${match.index}`}
        className={styles.systemMentionLink}
        onClick={(e) => {
          e.stopPropagation();
          if (navigate && mentionUsername) {
            navigate(`/profile/${mentionUsername}`, { state: { from: window.location.pathname } });
          }
        }}
        title={`View @${mentionUsername}'s profile`}
      >
        @{mentionUsername}
      </span>
    );

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < strText.length) {
    elements.push(
      <span key={`text_${lastIndex}`} className={styles.systemNonSelectableText}>
        {strText.slice(lastIndex)}
      </span>
    );
  }

  return <>{elements}</>;
}

const loadedImageUrls = new Set();

/*
 * The "open this media" control. A real <button> laid over the thumbnail rather
 * than a click handler on the <img>/<div>, so it is in the tab order, answers to
 * Enter and Space, and is announced as an action. It carries only a generic name
 * ("Open photo"): no description of the content is invented.
 */
const OPEN_MEDIA_BUTTON_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  padding: 0,
  border: 0,
  borderRadius: 'inherit',
  background: 'transparent',
  cursor: 'pointer',
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * A chat image that is always in exactly one of three states: loading (skeleton),
 * shown, or unavailable. Keyed on its source so a different image starts clean.
 *
 * It used to run its own resolution effect, guarded by "skip when the source has
 * not changed since the previous render". That guard is also true on the very
 * FIRST render, so a freshly mounted bubble never asked for a signed URL: it
 * painted the unsigned `/api/media/<key>` URL, which only works where the
 * browser happens to attach a session cookie. Anywhere else (the installed app)
 * the load failed, the single retry re-requested the same URL (a state setter
 * given an identical value does nothing), and when signing also came back empty
 * no further load or error event ever fired - the skeleton stayed up for good,
 * across closing the viewer and refreshing alike.
 *
 * Resolution is now the shared `useSignedMediaSrc`, the same pipeline the
 * viewer, the gallery thumbnails and the video tile use. It never paints an
 * unsigned URL, reports "declined to sign" as a state of its own, and a retry
 * re-signs and remounts the <img> (keyed by `attempt`) so the browser really
 * does ask again.
 */
/**
 * The kind of failure for media that could not be shown: final when the
 * server declined to sign it, otherwise the network ('offline') or a failed
 * load, both worth trying again.
 */
function transientOrFinal(value, fallback) {
  if (mediaCache.wasDeclined(value)) return 'unavailable';
  return isOnline() ? fallback : 'offline';
}

function ImageWithSkeleton(props) {
  return <SignedChatImage key={`${props.src || 'none'}|${props.fallbackSrc || ''}`} {...props} />;
}

/**
 * `src` is the preferred (usually thumbnail) source and `fallbackSrc` the full
 * image. Thumbnails are derived, best-effort variants - the cache resolves a
 * missing one to nothing precisely "so callers fall back to the full image" -
 * so a thumbnail that cannot be signed or loaded moves on to the original
 * before the bubble gives up.
 */
function SignedChatImage({ src, fallbackSrc, alt, className, onClick, isStandalone = false, onErrorChange, width, height, onClickSrc, openDisabled = false }) {
  const sources = fallbackSrc && fallbackSrc !== src ? [src, fallbackSrc] : [src];
  const [sourceIndex, setSourceIndex] = useState(0);
  const active = sources[sourceIndex];
  const { src: signed, failed, refresh, attempt } = useSignedMediaSrc(active);
  const [loaded, setLoaded] = useState(() => Boolean(signed && loadedImageUrls.has(signed)));
  // Why it cannot be shown (MediaUnavailable): 'offline' and 'load' are worth
  // another try, 'unavailable' (the server declined to sign it) is final.
  const [failure, setFailure] = useState(null);
  const retriedRef = useRef(false);
  const onErrorRef = useRef(onErrorChange);
  onErrorRef.current = onErrorChange;
  const aspect = (width && height) ? (width / height) : 1;
  const error = !src || Boolean(failure);

  const lastIndex = sources.length - 1;
  /** Moves to the next source; false when there is none left. */
  const advance = useCallback(() => {
    if (sourceIndex >= lastIndex) return false;
    retriedRef.current = false;
    setLoaded(false);
    setSourceIndex(sourceIndex + 1);
    return true;
  }, [sourceIndex, lastIndex]);

  // No signed URL for this source: try the next one, else say why.
  useEffect(() => {
    if (failed && !advance()) setFailure(transientOrFinal(active, 'load'));
  }, [failed, advance, active]);

  // Already decoded earlier in the session: no skeleton once the URL is in hand.
  useEffect(() => {
    if (signed && loadedImageUrls.has(signed)) setLoaded(true);
  }, [signed]);

  useEffect(() => {
    onErrorRef.current?.(error);
  }, [error]);

  const handleError = () => {
    if (!retriedRef.current) {
      // Usually an expired signature: sign again rather than re-request a dead URL.
      retriedRef.current = true;
      setLoaded(false);
      refresh();
      return;
    }
    if (!advance()) setFailure(transientOrFinal(active, 'load'));
  };

  // Retry (a tap, or the connection coming back): from the first source, with
  // a fresh signature, inside the same box.
  const retry = useCallback(() => {
    retriedRef.current = false;
    setLoaded(false);
    setFailure(null);
    setSourceIndex(0);
    refresh();
  }, [refresh]);

  const handleImageLoad = () => {
    setLoaded(true);
    if (signed) loadedImageUrls.add(signed);
    if (src) loadedImageUrls.add(src);
  };

  if (error) {
    return (
      <MediaUnavailable
        kind="image"
        failure={src ? failure : 'unavailable'}
        aspect={aspect}
        isStandalone={isStandalone}
        onRetry={src ? retry : undefined}
      />
    );
  }

  return (
    <div
      className={`${styles.msgMediaWrapper} ${isStandalone ? styles.msgMediaWrapperStandalone : styles.msgMediaWrapperInline}`}
      style={{ '--aspect': aspect }}
    >
      {!loaded && (
        <div className={`${styles.msgMediaSkeleton} ${isStandalone ? styles.msgMediaSkeletonStandalone : ''}`}>
          <ImageIcon size={22} className={styles.msgMediaSkeletonIcon} />
        </div>
      )}
      {signed && (
        <img
          key={attempt}
          src={signed}
          alt={alt || ''}
          decoding="async"
          className={`${className} ${!loaded ? styles.msgMediaImgHidden : styles.msgMediaImgVisible}`}
          onLoad={handleImageLoad}
          onError={handleError}
        />
      )}
      {onClick && src && !openDisabled && (
        <button
          type="button"
          aria-label="Open photo"
          style={OPEN_MEDIA_BUTTON_STYLE}
          onClick={() => onClick(onClickSrc || signed || active)}
        />
      )}
    </div>
  );
}

/**
 * "m:ss" for a clip length in seconds. Rounded once, as a whole, before it is
 * split: rounding the seconds part on its own turned 59.6 into "0:60".
 */
export function formatClipDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const total = Math.max(1, Math.round(duration));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function VideoPlayerWithOverlay({ src, poster = null, placeholder = null, duration = null, width = null, height = null, isInline = false, hasText = false, onOpenMediaModal, openExtra, openDisabled = false }) {
  /*
   * Signed through the shared hook, exactly like the viewer and the image path.
   *
   * This used to read `getMediaUrl(src)` and nothing else, which produces the
   * unsigned `/api/media/chat/<key>.mp4` URL. That route authorizes
   * conversation media from the session, and a <video> tag can no more send a
   * bearer token than an <img> can — so in the installed app every chat video
   * was a 404. The website hid it because the browser attaches the session
   * cookie to the same request.
   *
   * The hook also gives three states instead of two: signing in flight, signing
   * refused, and playable. They used to collapse into `!resolvedSrc`, so every
   * bubble flashed "Video unavailable" while its signature was still on the way.
   */
  const { src: resolvedSrc, pending, failed, refresh, attempt } = useSignedMediaSrc(src);
  // A missing poster is cosmetic, so it has no error state of its own.
  const { src: resolvedPoster } = useSignedMediaSrc(poster || '');
  const [videoFailure, setVideoFailure] = useState(null);
  const reloadedRef = useRef(false);

  useEffect(() => {
    setVideoFailure(null);
    reloadedRef.current = false;
  }, [src]);

  const aspect = (width && height) ? (width / height) : (16 / 9);
  const durationLabel = formatClipDuration(duration);
  const wrapperClass = `${styles.msgMediaWrapper} ${isInline ? styles.msgMediaWrapperInline : styles.msgMediaWrapperStandalone}`;
  /*
   * The frame this device drew for a video it is still sending (a blob: URL),
   * painted UNDER the player. Once the upload finishes the tile switches to the
   * server copy, which needs a signature and then its own poster download;
   * without this the tile went blank for that whole round trip, between the
   * local frame and the stored one.
   */
  const backdrop = placeholder ? { backgroundImage: `url("${placeholder}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : null;
  /*
   * `#t=0.1` makes the browser seek a tenth of a second in and paint that
   * frame. Android and iOS paint nothing for preload="metadata" on its own, so
   * a posterless video - including every older message whose poster never
   * uploaded - was a black tile. The fragment is never sent to the server, so a
   * signed URL's signature is unaffected.
   *
   * Added whether or not there is a poster: a poster that arrives later (the
   * frame drawn while sending) must not change the URL, which reloaded the
   * element. With a poster and preload="none" the hint costs nothing.
   */
  const playableSrc = resolvedSrc && !resolvedSrc.includes('#')
    ? `${resolvedSrc}#t=0.1`
    : resolvedSrc;

  const handleVideoError = () => {
    /*
     * One silent re-sign before reporting failure: the usual cause is a
     * signature that expired while the bubble sat in the list. `attempt` keys
     * the <video>, so even an unchanged URL gets a fresh load.
     */
    if (!reloadedRef.current) {
      reloadedRef.current = true;
      refresh();
      return;
    }
    setVideoFailure(transientOrFinal(src, 'load'));
  };

  const handleRetry = useCallback(() => {
    reloadedRef.current = false;
    setVideoFailure(null);
    refresh();
  }, [refresh]);

  if (!src || failed || videoFailure) {
    return (
      <MediaUnavailable
        kind="video"
        failure={!src ? 'unavailable' : videoFailure || transientOrFinal(src, 'load')}
        aspect={aspect}
        isStandalone={!isInline}
        onRetry={src ? handleRetry : undefined}
      />
    );
  }

  if (pending || !resolvedSrc) {
    // Same box as the finished player, so the list does not jump when the
    // signature arrives.
    return (
      <div
        className={wrapperClass}
        style={{ '--aspect': aspect, backgroundColor: '#16181c', ...backdrop }}
        role="status"
        aria-busy="true"
        aria-label="Loading video"
      />
    );
  }

  return (
    <div
      className={wrapperClass}
      style={{ '--aspect': aspect, backgroundColor: '#16181c', ...backdrop }}
    >
      <video
        key={attempt}
        src={playableSrc}
        poster={resolvedPoster || undefined}
        playsInline
        muted
        aria-hidden="true"
        tabIndex={-1}
        // With a poster + known dimensions we can defer ALL video bytes until the
        // user actually plays (preload="none"); otherwise fetch just metadata.
        preload={resolvedPoster ? 'none' : 'metadata'}
        onError={handleVideoError}
        className={styles.msgMediaImgVisible}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          marginBottom: isInline && hasText ? '6px' : '0',
          objectFit: 'cover',
          pointerEvents: 'none'
        }}
      />
      {durationLabel && (
        <span style={{ position: 'absolute', bottom: '8px', right: '8px', zIndex: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: '6px', pointerEvents: 'none' }}>
          {durationLabel}
        </span>
      )}
      {/*
        The whole tile is the control, and it is a real button. Playback always
        happens in the viewer: the inline element is a muted, control-less
        preview, so there is nothing for an in-place "play" to do.
        It hands the viewer the STABLE source (`src`), never the signed
        `resolvedSrc`: a signed URL expires, cannot be re-signed once it has
        lost its key, and would be forwarded to other people as-is.
      */}
      {onOpenMediaModal && !openDisabled && (
        <button
          type="button"
          aria-label="Open video"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMediaModal(src, 'video', openExtra);
          }}
          style={OPEN_MEDIA_BUTTON_STYLE}
        >
          <span
            aria-hidden="true"
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(6px)',
              border: '1.5px solid rgba(255, 255, 255, 0.35)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingLeft: '3px',
            }}
          >
            <Play size={24} fill="white" />
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * A shared confession as a chat message. While the reader may see it, the
 * card; once it is not theirs to see (deleted, taken down, another campus,
 * no campus access), a plain message in the style of "This message was
 * unsent", so it reads as a state of the message rather than a broken card.
 * The lookup is the card's own (same query), so this costs no extra request.
 */
function ConfessionShareMessage({ confessionId, isMe, timeText, actions }) {
  const { isGone } = useConfession(confessionId);
  if (isGone) {
    return (
      <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
          <div className={styles.msgTextTimeWrap}>
            <span className={styles.msgText} style={{ fontStyle: 'italic', opacity: 0.7 }}>
              This confession is no longer available
            </span>
            <div className={styles.msgTimeLabel} style={{ opacity: 0.6 }}>{timeText}</div>
          </div>
        </div>
        {actions}
      </div>
    );
  }
  return (
    <div className={styles.msgImageCardContainer}>
      <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
        <SharedConfessionPreview confessionId={confessionId} />
        {actions}
      </div>
      <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
        {timeText}
      </div>
    </div>
  );
}

/**
 * Group-invite message card.
 *
 * Self-sufficient by design, as before (it used to depend on props the list
 * never passed, so no invite could be accepted): it needs nothing from its
 * parents. It no longer fetches or joins on its own. "View group" opens the
 * group preview, which asks the server about this card and shows what it
 * allows, so the card reads the same whether the invite is live or expired.
 */
function GroupInviteCard({ msg, currentUser, navigate, isMe }) {
  const queryClient = useQueryClient();
  const { mutate: toggleJoin } = useJoinCommunity();
  const [previewOpen, setPreviewOpen] = useState(false);

  const targetGroupId = msg.inviteData?.groupId || msg.inviteData?.conversationId || null;
  const isCampusGroup = Boolean(targetGroupId) && String(targetGroupId).startsWith('c_');
  const isJoinedCampus =
    isCampusGroup && (currentUser?.campusGroups || []).map(String).includes(String(targetGroupId));

  // The card is the credential: the server checks it by its id (who it was
  // sent to, whether its sender is still in the group, its 48 hours). Until
  // the send is confirmed there is no id to check.
  const isSent = Boolean(msg?.id) && !String(msg.id).startsWith('temp_')
    && !String(msg.id).startsWith('c_temp_') && !msg?.isOptimistic;

  // What the card itself knows, shown at once; the sheet reads the group live.
  const groupName = msg.inviteData?.groupName || 'Group';
  const groupAvatar = msg.inviteData?.groupAvatar || null;
  const groupAvatarSrc = groupAvatar ? getMediaUrl(groupAvatar) : null;
  const fromText = msg.from === 'me' ? 'you' : (msg.senderName || 'someone');

  // Campus groups are communities, not conversations: their own membership,
  // and no invite preview behind them.
  const openCampusGroup = () => {
    if (!isJoinedCampus) toggleJoin({ communityId: targetGroupId, isJoined: true, currentUser });
    const basePath = window.location.pathname.startsWith('/inbox') ? '/inbox' : '/messages';
    navigate(generateConversationUrl({ id: targetGroupId }, currentUser?.id, basePath));
  };

  // Always "View group", an expired invite included: what it allows is the
  // preview's to say ("Invite link expired"), from the server, not the card's.
  const { label, disabled, onClick } = (() => {
    if (!targetGroupId) return { label: 'Invite unavailable', disabled: true, onClick: undefined };
    if (isCampusGroup) {
      return { label: isJoinedCampus ? 'Open Group' : 'Join Group', disabled: false, onClick: openCampusGroup };
    }
    return { label: 'View group', disabled: !isSent, onClick: () => setPreviewOpen(true) };
  })();

  return (
    <div className={`${styles.groupInviteCard} ${isMe ? styles.groupInviteCardMe : styles.groupInviteCardThem}`}>
      <div className={styles.groupInviteHeader}>
        <Avatar src={groupAvatarSrc} name={groupName} size="48px" isGroup={true} />
        <div className={styles.groupInviteInfo}>
          <h4>{groupName}</h4>
          <p>Group invite from {fromText}</p>
        </div>
      </div>
      <div className={styles.groupInviteActions}>
        <button
          type="button"
          className={styles.groupInviteBtn}
          onClick={onClick}
          // Started on press, so the sheet usually opens with its answer.
          onPointerDown={!isCampusGroup && isSent
            ? () => prefetchGroupPreview(queryClient, { groupId: targetGroupId, messageId: msg.id })
            : undefined}
          disabled={disabled}
        >
          {label}
        </button>
      </div>
      {previewOpen && (
        <GroupPreviewSheet
          groupId={targetGroupId}
          messageId={msg.id}
          snapshot={{ name: groupName, avatar: groupAvatar }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

const formatToClockTime = (dateInput) => {
  const d = dateInput ? new Date(dateInput) : new Date();
  const date = isNaN(d.getTime()) ? new Date() : d;
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minStr} ${ampm}`;
};

const getDisplayClockTime = (msg) => {
  if (msg?.createdAt) return formatToClockTime(msg.createdAt);
  if (msg?.timestamp) return formatToClockTime(msg.timestamp);
  return formatToClockTime(new Date());
};



// Lightweight overlay shown over the local preview while media uploads (progress
// ring) or after a failure (retry / cancel). Rendered absolutely over the media
// box so progress ticks (which only patch this one message) never reflow siblings.
function MediaUploadOverlay({ progress = 0, failed = false, onRetry, onCancel }) {
  if (failed) {
    return (
      <div className={styles.msgUploadOverlay} onClick={(e) => e.stopPropagation()}>
        <div className={styles.msgUploadFailedText}>Upload failed</div>
        <div className={styles.msgUploadActions}>
          {onRetry && (
            <button type="button" className={styles.msgUploadBtn} onClick={onRetry}>Retry</button>
          )}
          {onCancel && (
            <button type="button" className={styles.msgUploadBtnGhost} onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className={styles.msgUploadOverlay}>
      <div className={styles.msgUploadRing} style={{ '--upload-pct': `${pct}%` }}>
        <span className={styles.msgUploadPct}>{pct}%</span>
      </div>
      {onCancel && (
        <button type="button" className={styles.msgUploadBtnGhost} onClick={(e) => { e.stopPropagation(); onCancel(); }}>Cancel</button>
      )}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  onJumpToMessage,
  msg, 
  conversation, 
  currentUser,
  users,
  isLatestMessage = false,
  onOpenMediaModal,
  onContextMenu,
  onReplyTo,
  onReply,
  onRetryUpload,
  onRetrySend,
  onCancelUpload,
  // Find-in-chat term. ChatMessageList has always passed this down; the prop
  // simply was never declared here, so the value arrived and was discarded.
  searchQuery = '',
  // Set by the list from utils/messageRuns.closesUpFlags, which owns the rule:
  // this row closes up against the row above it. The bubble only reflects it as
  // an attribute; the stylesheet does the rest.
  continuesRun = false,
}) {
  const navigate = useNavigate();
  const storeUsers = useUsersMap();
  const allUsers = users || storeUsers || {};
  const longPressTimer = useRef(null);
  const touchHandled = useRef(false);
  const replyHandler = onReplyTo || onReply;
  const [mediaError, setMediaError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const fireContextMenu = (e, msgObj) => {
    if (!onContextMenu) return;
    let clientX = e.clientX;
    let clientY = e.clientY;
    
    if (clientX === undefined) {
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
    }
    
    // Fallbacks if all else fails
    clientX = clientX ?? window.innerWidth / 2;
    const vh = window.visualViewport?.height || window.innerHeight;
    clientY = clientY ?? vh / 2;

    const mockEvent = {
      clientX,
      clientY,
      preventDefault: () => e.preventDefault && e.preventDefault(),
      stopPropagation: () => e.stopPropagation && e.stopPropagation(),
    };
    const finalMsg = mediaError ? { ...msgObj, isMediaUnavailable: true, mediaError: true } : msgObj;
    onContextMenu(mockEvent, finalMsg);
  };

  const touchStartPos = useRef({ x: 0, y: 0 });
  const isSwipingRef = useRef(false);
  const vibratedRef = useRef(false);
  const [swipeX, setSwipeX] = useState(0);

  const handleTouchStart = (e) => {
    if (e.persist) e.persist();
    
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (clientX === undefined && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    
    touchStartPos.current = { x: clientX || 0, y: clientY || 0 };
    isSwipingRef.current = false;
    vibratedRef.current = false;
    touchHandled.current = false;

    const syntheticEvent = { clientX, clientY };

    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      if (!isSwipingRef.current) {
        touchHandled.current = true;
        fireContextMenu(syntheticEvent, msg);
      }
    }, LONG_PRESS_DELAY_MS);
  };

  const handleTouchMove = (e) => {
    if (!e.touches || e.touches.length === 0) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartPos.current.x;
    const deltaY = currentY - touchStartPos.current.y;

    // Any real movement means this is a scroll or a swipe, not a long press.
    // Only a horizontal swipe used to cancel the timer; a vertical drag hit the
    // early return below and left it running, so pausing briefly while
    // scrolling popped the menu open at the spot the finger started from.
    if (longPressTimer.current && Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (!isSwipingRef.current && Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }

    if (deltaX > 8 && replyHandler) {
      isSwipingRef.current = true;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
      
      const distance = Math.min(Math.max(0, deltaX * 0.55), 75);
      setSwipeX(distance);

      if (distance >= 40 && !vibratedRef.current) {
        vibratedRef.current = true;
        try {
          if (navigator.vibrate) navigator.vibrate(15);
        } catch (_) {}
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!isUnsent && swipeX >= 40 && replyHandler) {
      replyHandler(msg);
    }
    setSwipeX(0);
    isSwipingRef.current = false;
    vibratedRef.current = false;
  };

  // The browser fires touchcancel when it takes the gesture over for scrolling.
  // Without this the timer survived that handover and fired mid-scroll.
  const handleTouchCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setSwipeX(0);
    isSwipingRef.current = false;
    vibratedRef.current = false;
  };

  const handleContextMenuEvent = (e) => {
    e.preventDefault();
    fireContextMenu(e, msg);
  };

  if (isSystemMessage(msg)) {
    // A departure line about the viewer says "you" ("@admin removed you").
    const text = departureLineFor(msg, currentUser?.id) || msg.text || msg.payload?.text || '';
    return (
      <div className={styles.systemMessageContainer}>
        <div className={styles.systemMessageText}>
          <SystemMessageContent text={text} navigate={navigate} />
        </div>
      </div>
    );
  }

  const isUnsent = msg.state === 'UNSENT' || msg.isUnsent || msg.text === 'This message was unsent' || msg.payload?.text === 'This message was unsent';
  const isGroup = conversation?.isGroup || conversation?.type === 'GROUP';
  const isMe = checkIsMe(msg, currentUser);
  const showSenderAvatar = isGroup && !isMe;
  const senderName = msg.senderName || msg.sender?.displayName || msg.sender?.name || msg.sender?.username || (msg.senderId && allUsers[msg.senderId] ? (allUsers[msg.senderId].displayName || allUsers[msg.senderId].username || allUsers[msg.senderId].name) : 'Member');
  const senderAvatar = msg.senderAvatar || msg.sender?.avatar || (msg.senderId && allUsers[msg.senderId] ? allUsers[msg.senderId].avatar : null);

  const isRealServerMsg = Boolean(msg?.id && !String(msg.id).startsWith('temp_') && !String(msg.id).startsWith('c_temp_') && !msg?.isOptimistic);
  const isConfirmedSent = msg?.status === 'sent' || msg?.status === 'delivered' || msg?.status === 'read' || msg?.status === 'seen';

  const sendTimeMs = getMsgTimestamp(msg);
  const msgAge = sendTimeMs > 0 ? (Date.now() - sendTimeMs) : Infinity;
  // `queued`: in the outbox, which keeps retrying it, so "Sending…" not failed.
  // An upload in progress is not stale either: it is not queued until the file
  // has gone up, and a large video takes far longer than 5 seconds.
  const isStaleSending = !isRealServerMsg && !isConfirmedSent && msg?.status === 'sending' && !msg?.queued && msg?.uploadStatus !== 'uploading' && (isNaN(msgAge) || msgAge > 5000 || msgAge < 0);

  // Not gated on the id: a message whose status says it failed was never
  // confirmed, whatever its id looks like (client ids are UUIDs, so a failed
  // send used to read as a server message and show "Sent").
  const isFailedMsg = isMe && !isConfirmedSent && (
    msg.status === 'failed' || 
    msg.status === 'FAILED' || 
    msg.isFailed || 
    msg.status === 'error' || 
    msg.deliveryStatus === 'failed' || 
    msg.state === 'FAILED' ||
    isStaleSending
  );
  
  const inviteData = msg.inviteData || msg.payload?.inviteData;
  const activityData = msg.payload?.activity || msg.payload?.inviteData?.activity || msg.inviteData?.activity;
  const postData = msg.payload?.post || msg.payload?.inviteData?.post || msg.inviteData?.post;
  const profileData = msg.payload?.profile || msg.payload?.inviteData?.profile || msg.inviteData?.profile;
  const communityData = msg.payload?.community || msg.payload?.inviteData?.community || msg.inviteData?.community;
  const hasPostReply = isPostReply(msg.replyTo);
  
  let rawText = msg.text || msg.payload?.text || msg.content || '';
  if (rawText && typeof rawText === 'object') {
    rawText = rawText.body || rawText.text || '';
  }
  const messageText = typeof rawText === 'string' ? rawText : String(rawText);
  const rawMediaUrl = msg.mediaUrl || msg.payload?.mediaUrl;
  const mediaUrl = rawMediaUrl ? getMediaUrl(rawMediaUrl) : '';
  // Prefer the lightweight thumbnail/poster for in-list rendering; the full
  // original is loaded only when the viewer opens (onClick -> mediaUrl).
  const rawThumbUrl = msg.payload?.thumbnailUrl || msg.payload?.localPreviewUrl || rawMediaUrl;
  const thumbUrl = rawThumbUrl ? getMediaUrl(rawThumbUrl) : mediaUrl;
  // A poster is an image. Older sends stored the clip's own URL here when the
  // poster failed to upload, and an <img>/poster pointed at a video draws nothing.
  const videoPoster = thumbUrl !== mediaUrl && !/\.(mp4|webm|ogv|mov|m4v)(?:[?#]|$)/i.test(thumbUrl || '') ? thumbUrl : null;
  // The frame drawn on this device while its video uploads (blob:), shown under
  // the player until the stored poster has painted.
  const localPoster = typeof msg.payload?.localPosterUrl === 'string' && msg.payload.localPosterUrl.startsWith('blob:')
    ? msg.payload.localPosterUrl
    : null;
  const mediaWidth = msg.payload?.width || msg.width || null;
  const mediaHeight = msg.payload?.height || msg.height || null;
  const mediaDuration = msg.payload?.duration || msg.duration || null;
  // Upload lifecycle for optimistic media (own outgoing messages only).
  const uploadStatus = msg.uploadStatus;
  const uploadProgress = typeof msg.uploadProgress === 'number' ? msg.uploadProgress : 0;
  const isUploading = uploadStatus === 'uploading';
  const isUploadFailed = uploadStatus === 'failed' || (isMe && isFailedMsg && rawMediaUrl && String(rawMediaUrl).startsWith('blob:'));

  /*
   * What the viewer is told about this message when it opens one of its media.
   *
   * `report` is offered only when there is a real, server-confirmed message to
   * report and it is somebody else's: an optimistic `temp_…` id names nothing
   * the server knows, and a person does not report their own message. When it
   * is left out the viewer hides Report rather than guessing a target from the
   * media URL.
   */
  const buildOpenExtra = (thumb) => {
    const extra = {};
    if (isRealServerMsg && !isMe) {
      extra.report = {
        targetType: 'MESSAGE',
        targetId: msg.id,
        ...(senderName ? { name: senderName } : {}),
        ...(senderAvatar ? { avatar: senderAvatar } : {}),
      };
    }
    if (thumb) extra.thumb = thumb;
    // The stored form, so a forward from the viewer persists the key and not this
    // environment's absolute API host (the in-chat forward already sends the stored form).
    if (typeof rawMediaUrl === 'string' && rawMediaUrl && !rawMediaUrl.startsWith('blob:')) extra.rawUrl = rawMediaUrl;
    return Object.keys(extra).length > 0 ? extra : undefined;
  };
  const isAudio = msg.mediaType === 'audio' || msg.type === 'voice' || msg.payload?.mediaType === 'audio';
  const isVideo =
    msg.mediaType === 'video' ||
    msg.type === 'video' ||
    msg.payload?.mediaType === 'video' ||
    (typeof mediaUrl === 'string' && (/\.(mp4|webm|mov|mkv|avi|flv)/i.test(mediaUrl) || mediaUrl.startsWith('data:video/')));
  const hasText = !!(messageText && String(messageText).trim().length > 0);
  const timeText = getDisplayClockTime(msg);

  // The "Sending…" / "Not sent" / "Sent" line under a message of your own.
  // Failed and queued ones always show it; otherwise only the latest message.
  const hasStatusLine = Boolean(isMe && (isFailedMsg || isLatestMessage || msg.queued));
  const failure = describeSendFailure(msg.failReason);

  let innerContent = null;

  // 0. Unsent Message
  if (isUnsent) {
    innerContent = (
      <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
          <div className={styles.msgTextTimeWrap}>
            <span className={styles.msgText} style={{ fontStyle: 'italic', opacity: 0.7 }}>
              This message was unsent
            </span>
            <div className={styles.msgTimeLabel} style={{ opacity: 0.6 }}>{timeText}</div>
          </div>
        </div>
        <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={null} onContextMenu={onContextMenu} />
      </div>
    );
  } else if (profileData || (inviteData && inviteData.type === 'profileShare')) {
    const prof = profileData || inviteData?.profile;
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedProfilePreview profile={prof} isMe={isMe} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (inviteData && inviteData.type === 'confessionShare') {
    // Shared confession: the message holds only its id; the card asks for the
    // confession itself, as this reader (see SharedConfessionPreview).
    innerContent = (
      <ConfessionShareMessage
        confessionId={inviteData.confessionId}
        isMe={isMe}
        timeText={timeText}
        actions={<MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />}
      />
    );
  } else if (inviteData && inviteData.type !== 'activityShare' && inviteData.type !== 'profileShare' && inviteData.type !== 'postShare' && inviteData.type !== 'communityShare') {
    // 2. Group Invite Card Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <GroupInviteCard
            msg={{ ...msg, inviteData }}
            currentUser={currentUser}
            navigate={navigate}
            isMe={isMe}
          />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (activityData || (inviteData && inviteData.type === 'activityShare')) {
    // 2. Activity Share Card Message
    const act = activityData || inviteData?.activity;
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedActivityPreview activity={act} isMe={isMe} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (isAudio) {
    // 3. Voice / Audio Message
    innerContent = (
      <div className={styles.msgAudioCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <VoiceMessagePlayer src={mediaUrl} audioUrl={mediaUrl} duration={mediaDuration} fromMe={isMe} isMe={isMe} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (isVideo && mediaUrl && !hasText && !msg.replyTo) {
    // 4. Standalone Video Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <div className={styles.msgImageCard} style={{ overflow: 'hidden', borderRadius: '16px', width: 'fit-content', height: 'fit-content', position: 'relative' }}>
            <VideoPlayerWithOverlay src={mediaUrl} poster={videoPoster} placeholder={localPoster} duration={mediaDuration} width={mediaWidth} height={mediaHeight} isInline={false} onOpenMediaModal={onOpenMediaModal} openExtra={buildOpenExtra(videoPoster)} openDisabled={isUploading || isUploadFailed} />
            {(isUploading || isUploadFailed) && (
              <MediaUploadOverlay
                progress={uploadProgress}
                failed={isUploadFailed}
                onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
              />
            )}
          </div>
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (mediaUrl && !hasText && !msg.replyTo && !postData && !profileData && !communityData) {
    // 4. Standalone Image Message (Image with no text caption)
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <div className={styles.msgImageCard} style={{ position: 'relative' }}>
            <ImageWithSkeleton
              src={thumbUrl}
              fallbackSrc={mediaUrl}
              onClickSrc={mediaUrl}
              alt=""
              width={mediaWidth}
              height={mediaHeight}
              className={styles.msgMediaImgStandalone}
              onClick={() => !mediaError && !isUploading && onOpenMediaModal && onOpenMediaModal(mediaUrl, 'image', buildOpenExtra(thumbUrl !== mediaUrl ? thumbUrl : null))}
              openDisabled={isUploading || isUploadFailed}
              isStandalone={true}
              onErrorChange={setMediaError}
            />
            {(isUploading || isUploadFailed) && (
              <MediaUploadOverlay
                progress={uploadProgress}
                failed={isUploadFailed}
                onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
              />
            )}
          </div>
          {!mediaError && (
            <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
          )}
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (communityData) {
    // Shared Community Card Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedCommunityPreview community={communityData} isMe={isMe} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else if (postData) {
    // Shared Post Card Message
    innerContent = (
      <div className={styles.msgImageCardContainer}>
        <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
          <SharedPostPreview post={postData} isMe={isMe} />
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        </div>
        <div className={`${styles.msgImageFooter} ${isMe ? styles.msgImageFooterMe : styles.msgImageFooterThem}`}>
          {timeText}
        </div>
      </div>
    );
  } else {
    // 5. Standard Text Bubble (or Image + Text Caption)
    innerContent = (
      <div className={`${styles.msgMainRow} ${isMe ? styles.msgMainRowMe : styles.msgMainRowThem}`}>
        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
          {msg.replyTo && !hasPostReply && (
            <div
              className={`${styles.msgBubbleReplyRef} ${onJumpToMessage && msg.replyTo.id ? styles.msgBubbleReplyRefClickable : ''}`}
              role={onJumpToMessage && msg.replyTo.id ? 'button' : undefined}
              tabIndex={onJumpToMessage && msg.replyTo.id ? 0 : undefined}
              aria-label={onJumpToMessage && msg.replyTo.id ? `Go to message from ${msg.replyTo.senderName || 'sender'}` : undefined}
              onClick={(e) => {
                if (!onJumpToMessage || !msg.replyTo.id) return;
                // Must not bubble into the bubble's own tap/context handlers.
                e.stopPropagation();
                onJumpToMessage(msg.replyTo.id);
              }}
              onKeyDown={(e) => {
                if (!onJumpToMessage || !msg.replyTo.id) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onJumpToMessage(msg.replyTo.id); }
              }}
            >
              <div className={styles.msgBubbleReplyRefHeader}>{msg.replyTo.senderName || 'Replying to'}</div>
              {/* Renders every message type — media, voice, shared entities,
                  invites — instead of only text, which left a blank quote for
                  anything without a text body. */}
              <ReplyPreviewContent message={msg.replyTo} />
            </div>
          )}

          {mediaUrl && (
            isVideo ? (
              <div style={{ position: 'relative' }}>
                <VideoPlayerWithOverlay src={mediaUrl} poster={videoPoster} placeholder={localPoster} duration={mediaDuration} width={mediaWidth} height={mediaHeight} isInline={true} hasText={hasText} onOpenMediaModal={onOpenMediaModal} openExtra={buildOpenExtra(videoPoster)} openDisabled={isUploading || isUploadFailed} />
                {(isUploading || isUploadFailed) && (
                  <MediaUploadOverlay
                    progress={uploadProgress}
                    failed={isUploadFailed}
                    onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                    onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
                  />
                )}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <ImageWithSkeleton
                  src={thumbUrl}
                  fallbackSrc={mediaUrl}
                  onClickSrc={mediaUrl}
                  alt=""
                  width={mediaWidth}
                  height={mediaHeight}
                  className={styles.msgMediaImg}
                  onClick={() => !mediaError && !isUploading && onOpenMediaModal && onOpenMediaModal(mediaUrl, 'image', buildOpenExtra(thumbUrl !== mediaUrl ? thumbUrl : null))}
                  openDisabled={isUploading || isUploadFailed}
                  isStandalone={false}
                  onErrorChange={setMediaError}
                />
                {(isUploading || isUploadFailed) && (
                  <MediaUploadOverlay
                    progress={uploadProgress}
                    failed={isUploadFailed}
                    onRetry={onRetryUpload ? () => onRetryUpload(msg.clientId || msg.tempId) : null}
                    onCancel={onCancelUpload ? () => onCancelUpload(msg.clientId || msg.tempId) : null}
                  />
                )}
              </div>
            )
          )}

          {hasText && (() => {
            const normalizedMsg = normalizeBodyText(messageText);
            const clip = truncateBodyText(normalizedMsg, MSG_LIMITS);
            const needsTruncation = clip.needsTruncation;
            const displayedText = needsTruncation && !isExpanded ? clip.text : normalizedMsg;
            return (
              <div className={styles.msgTextTimeWrap}>
                <div className={styles.msgTextContent}>
                  {/* @mentions the server verified when the message was sent,
                      and links, each marked so they read as such in both
                      bubble colours (ChatMessageList.module.css). Nothing that
                      merely looks like a handle is styled. */}
                  <RichText
                    content={displayedText}
                    className={styles.msgText}
                    highlight={searchQuery}
                    mentions={msg.mentions || msg.payload?.mentions || []}
                    verifiedMentionsOnly
                    linkClassName={styles.msgLink}
                    mentionClassName={styles.msgMention}
                  />
                  {needsTruncation && (
                    <button
                      type="button"
                      className={`${styles.msgSeeMoreBtn} ${isMe ? styles.msgSeeMoreBtnMe : styles.msgSeeMoreBtnThem}`}
                      onClick={(e) => { e.stopPropagation(); setIsExpanded((v) => !v); }}
                    >
                      {' '}{isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
                <div className={styles.msgTimeLabel}>{timeText}</div>
              </div>
            );
          })()}
          {!hasText && (
            <div className={styles.msgTextTimeWrap}>
              <div className={styles.msgTimeLabel}>{timeText}</div>
            </div>
          )}
        </div>
        {!mediaError && (
          <MessageHoverActions msg={msg} isMe={isMe} onReplyTo={replyHandler} onContextMenu={onContextMenu} />
        )}
      </div>
    );
  }

  const handleSenderProfileClick = (e) => {
    e.stopPropagation();
    const senderId = msg.senderId || msg.sender?.id || (msg.from !== 'me' ? msg.from : null);
    // was getUserById(senderId), which is defined as exactly `users[id] || null`
    const liveUser = senderId ? (storeUsers[senderId] || null) : null;
    const target = liveUser?.username || msg.senderUsername || msg.sender?.username || senderId;
    if (target) {
      navigate(`/profile/${target}`, { state: { from: window.location.pathname } });
    }
  };

  return (
    <div 
      className={`${styles.msgBubbleContainer} ${isMe ? styles.msgBubbleContainerMe : styles.msgBubbleContainerThem}`}
      /* Anchors used by jump-to-message. Both ids are emitted because a message
         that is still sending only has a clientId, and a reply may target either. */
      data-message-id={msg.id || undefined}
      data-client-id={msg.clientId || msg.tempId || undefined}
      /* Whether the list closes this row up against the one above it. Decided
         in one place (utils/messageRuns.closesUpFlags), which also keeps rows
         that open with a label - a group member's name, "You replied to ..." -
         apart. See ChatMessageList.module.css (--msg-gap-run). */
      data-run={continuesRun ? 'continue' : undefined}
      /* This row ends in a status line ("Sending…", "Not sent", "Sent").
         That line belongs to it, so the row below keeps a full gap under it
         rather than closing up against the line. */
      data-status-line={hasStatusLine ? '' : undefined}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onContextMenu={handleContextMenuEvent}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {/* Swipe Reply Arrow Indicator */}
      {swipeX > 0 && (
        <div 
          style={{
            position: 'absolute',
            left: `${Math.min(swipeX - 30, 20)}px`,
            top: '50%',
            transform: `translateY(-50%) scale(${Math.min(swipeX / 40, 1)})`,
            opacity: Math.min(swipeX / 30, 1),
            color: 'var(--color-primary, #6366f1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 5,
            transition: swipeX === 0 ? 'all 0.2s ease-out' : 'none',
          }}
        >
          <Reply size={20} />
        </div>
      )}

      <div 
        className={styles.msgBubbleWrapper}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 ? 'transform 0.2s ease-out' : 'none',
          willChange: 'transform',
        }}
      >
        {showSenderAvatar && (
          <div className={styles.msgAvatar} onClick={handleSenderProfileClick} style={{ cursor: 'pointer' }} title={`View ${senderName}`}>
            <Avatar src={senderAvatar} name={senderName} size="28px" />
          </div>
        )}
        <div className={styles.msgBubbleContent}>
          {showSenderAvatar && (
            <span className={styles.msgSenderName} onClick={handleSenderProfileClick} style={{ cursor: 'pointer' }} title={`View ${senderName}`}>
              {senderName}
            </span>
          )}

          {hasPostReply && (
            <PostReplyPreview
              replyTo={msg.replyTo}
              isMe={isMe}
              currentUser={currentUser}
              onJumpToMessage={onJumpToMessage}
            />
          )}
          
          {innerContent}

          {/*
            Rendered only when it has something to say.

            It used to render for EVERY message of your own, with
            `visibility: hidden` when there was no status to show. Hidden or
            not, it still occupied a row plus its 3px top margin - so every
            message you sent was one row taller than every message you
            received, and the vertical rhythm of the thread visibly differed
            between the two sides of the conversation.

            Reserving that space only ever mattered for the message the status
            can actually appear on, which is the latest one, and that message
            sits at the bottom where the list is already pinned. So it is no
            longer reserved on the rest, and both sides now use the same single
            gap.
          */}
          {hasStatusLine && (
            <div className={`${styles.msgStatusLabel} ${isFailedMsg ? styles.msgStatusLabelFailed : ''}`}>
              {/* Failed status is always shown — never hidden even if not the latest message */}
              {/* Says why when the server said (sendFailure.js), and offers a
                  retry only where one can succeed: being out of the group or
                  blocked is not changed by trying again. */}
              {isFailedMsg && (onRetrySend && !isUploadFailed && failure.retryable ? (
                // Re-sends the exact message the outbox kept, under the same
                // clientId, so one that landed after all is not duplicated.
                // A failed upload has its own retry on the media overlay.
                <button
                  type="button"
                  className={styles.msgRetryButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onRetrySend(msg.clientId || msg.tempId);
                  }}
                >
                  <AlertCircle size={13} style={{ color: '#ef4444' }} aria-hidden="true" />
                  <span>{failure.label} · Tap to retry</span>
                </button>
              ) : (
                <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <AlertCircle size={13} style={{ color: '#ef4444' }} aria-hidden="true" />
                  <span>{failure.label}</span>
                </span>
              ))}
              {/* Normal delivery status: only shown on the latest message */}
              {!isFailedMsg && (() => {
                const s = msg.status;
                if (s === 'sending') return <span>Sending…</span>;
                if (s === 'read' || s === 'seen') return <span>Seen</span>;
                // 'sent', 'delivered', or any unrecognised status → show 'Sent'
                return <span>Sent</span>;
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;
