/**
 * The share dialog, for every kind of thing Meetifyy shares.
 *
 * Replaces four near-identical dialogs (post, profile, community, activity)
 * that each carried their own recipient list, send logic and chat payload.
 * What differs between the kinds lives in `@shared/lib/share/content`; this
 * component only presents it:
 *
 *   ┌──────────────── ▔▔▔ ────────────────┐   drag handle (phones)
 *   │            Share post               │
 *   │ ( search                          ) │
 *   │  ◯    ◯    ◯    ◯                  │   tap to select, many at once
 *   │ name name name name                 │
 *   │ ─────────────────────────────────── │
 *   │ Story · Copy · Share via · WhatsApp │   …or, once someone is picked,
 *   │ [ Send to 2 ]                       │   one Send button in its place
 *   └─────────────────────────────────────┘
 *
 * Forwarding a chat message or a viewed photo/video uses the same sheet with a
 * `forward` prop: the same picker and Send button, with no app row or copy
 * link, since a chat attachment has no public link to hand to another app.
 *
 * The Instagram Story tile exists only in the installed app. It is loaded
 * behind `IS_MOBILE_BUILD`, which Vite folds to a literal, so the panel, its
 * renderer and its native bridge are absent from the website's bundle rather
 * than merely hidden.
 */
import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IS_MOBILE_BUILD } from '@config';
import ShareModalAvatar from '@shared/components/avatar/ShareModalAvatar';
import ShareTargets from '@shared/components/share/ShareTargets';
import { Check, Instagram } from '@shared/components/icons';
import { useRecipientConversations } from '@shared/hooks/useRecipientConversations';
import { useMessageActions } from '@shared/hooks/useMessageActions';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import { matchesRecipientSearch, sendableConversations } from '@shared/lib/conversationTargets';
import {
  SHARE_KIND,
  SHARE_KIND_LABEL,
  normalizeShareContent,
  toChatInvite,
} from '@shared/lib/share/content';
import {
  buildActivityShare,
  buildCommunityShare,
  buildPostShare,
  buildProfileShare,
} from '@shared/lib/share/sharePayload';
import { forwardClientId, newForwardOperationId } from '@features/messages/shared/utils/forwardDelivery';
import styles from './ShareSheet.module.css';

const InstagramStoryPanel = IS_MOBILE_BUILD
  ? lazy(() => import('../../../mobile/share/InstagramStoryPanel'))
  : null;

function webPayload(kind, entity, author) {
  switch (kind) {
    case SHARE_KIND.POST:
      return buildPostShare(entity, author);
    case SHARE_KIND.PROFILE:
      return buildProfileShare(entity);
    case SHARE_KIND.COMMUNITY:
      return buildCommunityShare(entity);
    case SHARE_KIND.ACTIVITY:
      return buildActivityShare(entity);
    default:
      return null;
  }
}

/**
 * Sending to the picked chats. Per conversation: 'sending' | 'sent' | 'failed'.
 * A chat that already received this share is never sent it twice.
 *
 * `sendOne(convId)` delivers to one chat; null while there is nothing to send.
 */
function useChatSend(sendOne) {
  const [status, setStatus] = useState({});
  const inFlight = useRef(false);

  const sendAll = useCallback(
    async (convIds) => {
      if (!sendOne || inFlight.current) return false;
      const targets = convIds.filter((id) => status[id] !== 'sent');
      if (targets.length === 0) return true;
      inFlight.current = true;
      setStatus((prev) => ({ ...prev, ...Object.fromEntries(targets.map((id) => [id, 'sending'])) }));
      const results = await Promise.allSettled(
        targets.map((id) => sendOne(id)),
      );
      const next = {};
      results.forEach((r, i) => {
        next[targets[i]] = r.status === 'fulfilled' ? 'sent' : 'failed';
      });
      setStatus((prev) => ({ ...prev, ...next }));
      inFlight.current = false;
      return results.every((r) => r.status === 'fulfilled');
    },
    [sendOne, status],
  );

  return { status, sendAll };
}

/** How long the "Sent" confirmation shows before the sheet closes itself. */
const SENT_CLOSE_MS = 900;

/**
 * @param {object} [props.forward] forward mode instead of sharing an entity:
 *   `{ send(convId, clientId) }`. Each recipient's client id is derived from one
 *   operation id per opening, so the server recognises a retry as a repeat.
 */
export default function ShareSheet({ isOpen, onClose, kind, entity, author, forward }) {
  useOverlayBack(Boolean(isOpen), onClose);
  useScrollLock(Boolean(isOpen));
  const sheetRef = useSheetDrag(onClose, { enabled: Boolean(isOpen) });

  const [view, setView] = useState('main');
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | sending | sent | failed
  // While the search field has focus the keyboard is up; the app row would
  // ride up above it and take the space the results need.
  const [searching, setSearching] = useState(false);

  const content = useMemo(
    () => (forward ? null : normalizeShareContent(kind, entity, { author })),
    [forward, kind, entity, author],
  );
  const invite = useMemo(() => (content ? toChatInvite(content, entity) : null), [content, entity]);
  const payload = useMemo(() => webPayload(kind, entity, author), [kind, entity, author]);

  const { conversations } = useRecipientConversations(isOpen, searchTerm);
  const { sendDirectMessage } = useMessageActions();
  const [operationId] = useState(() => (forward ? newForwardOperationId() : null));
  const forwardSend = forward?.send;
  const sendOne = useMemo(() => {
    if (forwardSend) return (id) => forwardSend(id, forwardClientId(operationId, id));
    if (!invite) return null;
    return (id) => sendDirectMessage(id, { text: '', inviteData: invite });
  }, [forwardSend, operationId, invite, sendDirectMessage]);
  const { status, sendAll } = useChatSend(sendOne);

  const recipients = useMemo(() => {
    if (!conversations) return [];
    // A thread whose counterpart deleted their account cannot be sent into.
    return [...sendableConversations(conversations)]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      // The server already matched the term; this drops rows held over from
      // the previous term while the next request is in flight.
      .filter((c) => matchesRecipientSearch(c, searchTerm));
  }, [conversations, searchTerm]);

  const toggle = useCallback((id) => {
    setPhase('idle');
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const send = useCallback(async () => {
    setPhase('sending');
    const ok = await sendAll(selected);
    setPhase(ok ? 'sent' : 'failed');
    if (ok) setTimeout(onClose, SENT_CLOSE_MS);
  }, [onClose, selected, sendAll]);

  // App: Instagram Story leads the share row and opens in place.
  // Website: Instagram has no web share URL, so its tile copies the link to
  // paste there (handled by ShareTargets as the `instagram` target).
  const storyTargets = useMemo(
    () =>
      InstagramStoryPanel
        ? [{ id: 'instagram-story', label: 'Story', icon: Instagram, onSelect: () => setView('story') }]
        : [{ id: 'instagram', label: 'Instagram', icon: Instagram }],
    [],
  );

  if (!isOpen) return null;

  const label = forward ? 'Message' : SHARE_KIND_LABEL[kind] || 'Item';
  const title = forward ? 'Forward' : `Share ${label.toLowerCase()}`;
  const close = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    onClose();
  };
  const failedCount = selected.filter((id) => status[id] === 'failed').length;

  return createPortal(
    <div className={styles.backdrop} onClick={close}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
          <div className={styles.headerRow}>
            {/* No visible title on the main view. The dialog keeps its name
                for screen readers. */}
            <h2
              id="share-sheet-title"
              className={view === 'story' ? styles.title : `${styles.title} ${styles.srOnly}`}
            >
              {view === 'story' ? 'Instagram Story' : title}
            </h2>
            <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {!content && !forward ? (
          <p className={styles.unavailable} role="alert">
            This {label.toLowerCase()} can’t be shared right now.
          </p>
        ) : view === 'story' && InstagramStoryPanel ? (
          <div className={styles.body}>
            <Suspense fallback={<div className={styles.fill} />}>
              <InstagramStoryPanel content={content} onBack={() => setView('main')} onDone={onClose} />
            </Suspense>
          </div>
        ) : (
          <div className={styles.body}>
            <label className={styles.search}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="20" y1="20" x2="16.5" y2="16.5" />
              </svg>
              <input
                type="text"
                placeholder="Search"
                aria-label="Search chats"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setSearching(true)}
                onBlur={() => setSearching(false)}
              />
            </label>

            <div className={styles.grid} role="listbox" aria-multiselectable="true" aria-label="Send to">
              {recipients.length > 0 ? (
                recipients.map((conv) => {
                  const picked = selected.includes(conv.id);
                  const state = status[conv.id];
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      role="option"
                      aria-selected={picked}
                      className={`${styles.person} ${picked ? styles.picked : ''}`}
                      onClick={() => toggle(conv.id)}
                      disabled={phase === 'sending'}
                    >
                      <span className={styles.avatarWrap}>
                        <ShareModalAvatar conv={conv} size="60px" />
                        {picked && (
                          <span className={styles.check} aria-hidden="true">
                            <Check size={13} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      <span className={styles.personName}>{conv.name}</span>
                      {state === 'sent' && <span className={styles.personState}>Sent</span>}
                      {state === 'failed' && <span className={`${styles.personState} ${styles.personFailed}`}>Not sent</span>}
                    </button>
                  );
                })
              ) : (
                <p className={styles.empty}>{searchTerm ? 'No matching chats.' : 'No chats yet.'}</p>
              )}
            </div>

            {(selected.length > 0 || !searching) && (
            <div className={styles.footer}>
              {selected.length > 0 ? (
                <button
                  type="button"
                  className={styles.sendBtn}
                  onClick={send}
                  disabled={phase === 'sending' || phase === 'sent'}
                >
                  {phase === 'sending'
                    ? 'Sending…'
                    : phase === 'sent'
                      ? 'Sent'
                      : phase === 'failed'
                        ? `Retry ${failedCount} ${failedCount === 1 ? 'chat' : 'chats'}`
                        : selected.length === 1
                          ? 'Send'
                          : `Send to ${selected.length}`}
                </button>
              ) : (
                !forward && payload?.url && <ShareTargets payload={payload} leadingTargets={storyTargets} />
              )}
            </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
