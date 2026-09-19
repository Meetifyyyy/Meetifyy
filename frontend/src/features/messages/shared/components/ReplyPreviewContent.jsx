import { useEffect, useState } from 'react';
import {
  Image as ImageIcon,
  Video,
  Mic,
  FileText,
  Link2,
  User,
  Users,
  FileImage,
  Calendar,
  Ban,
  AlertCircle,
  MessageSquare,
  Sticker,
  Play,
  BarChart2,
} from '@shared/components/icons';
import { getMediaUrl } from '@shared/api/apiClient';
import Avatar from '@shared/components/avatar/Avatar';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useCommunities } from '@shared/hooks/useCommunities';
import { useConversations } from '@shared/hooks/useMessages';
import { resolveReplyPreview } from '../utils/replyPreview';

/**
 * The body of a reply quote: a compact, type-specific variant that
 * communicates clearly what kind of content is being replied to.
 *
 * Rendered by both the composer bar (ChatInputArea) and the message bubble
 * (MessageBubble) so a quote looks identical before and after sending. All
 * type decisions come from resolveReplyPreview(); this file only draws the
 * result.
 *
 * @param {{ message: object|null, className?: string, textClassName?: string,
 *           thumbClassName?: string, iconSize?: number }} props
 *   `message` is a full message OR a server `replyTo` snapshot.
 *   The legacy className/textClassName/thumbClassName/iconSize props are
 *   accepted but ignored — the variants handle their own layout.
 */
export default function ReplyPreviewContent({
  message,
  // kept for backward-compat with call sites that still pass these
  className: _className,
  textClassName: _textClassName,
  thumbClassName: _thumbClassName,
  iconSize: _iconSize,
}) {
  const preview = resolveReplyPreview(message);
  return <ReplyPreviewVariant preview={preview} />;
}

// ---------------------------------------------------------------------------
// Shared micro-components used across variants
// ---------------------------------------------------------------------------

/** Icon + text label pill shown above the body text in every variant. */
function TypeBadge({ icon: Icon, label }) {
  if (!Icon && !label) return null;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: '0.67rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      opacity: 0.65,
      lineHeight: 1,
      marginBottom: 2,
      flexShrink: 0,
    }}>
      {Icon && <Icon size={9} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** A 36×36 thumbnail square with optional video play-badge overlay. */
function Thumb({ src, isVideo = false, onError }) {
  if (!src) return null;
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <img
        src={src}
        alt=""
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          objectFit: 'cover',
          display: 'block',
        }}
        loading="lazy"
        onError={onError}
      />
      {isVideo && (
        <span style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.42)',
          borderRadius: 6,
        }} aria-hidden="true">
          <Play size={10} fill="white" />
        </span>
      )}
    </div>
  );
}

/** A 36×36 icon box used when there's no thumbnail. */
function IconBox({ icon: Icon }) {
  if (!Icon) return null;
  return (
    <span style={{
      width: 36,
      height: 36,
      borderRadius: 6,
      background: 'rgba(99,102,241,0.12)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      color: 'var(--color-primary, #6366f1)',
    }} aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

/** Two-column row wrapper used by all variants. */
function VariantRow({ children, muted = false }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
      opacity: muted ? 0.7 : 1,
    }}>
      {children}
    </div>
  );
}

/** The right column: badge on top, text below. */
function VariantBody({ badge, text, mono = false, italic = false }) {
  return (
    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0 }}>
      {badge}
      {text && (
        <span style={{
          fontSize: '0.8rem',
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontStyle: italic ? 'italic' : undefined,
          fontFamily: mono ? 'var(--font-family-mono, monospace)' : undefined,
        }}>
          {text}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind variants (pure — no hooks)
// ---------------------------------------------------------------------------

function TextVariant({ preview }) {
  return (
    <VariantRow>
      <VariantBody
        badge={null}
        text={preview.text}
      />
    </VariantRow>
  );
}

function LinkVariant({ preview }) {
  return (
    <VariantRow>
      <IconBox icon={Link2} />
      <VariantBody
        badge={<TypeBadge icon={Link2} label="Link" />}
        text={preview.text}
        mono
      />
    </VariantRow>
  );
}

function MediaVariant({ preview, kind }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbSrc = (!thumbFailed && preview.thumbnailKey)
    ? getMediaUrl(preview.thumbnailKey)
    : null;

  const ICONS_MAP = { image: ImageIcon, gif: FileImage, sticker: Sticker, video: Video };
  const LABELS = { image: 'Photo', gif: 'GIF', sticker: 'Sticker', video: 'Video' };
  const Icon = ICONS_MAP[kind] || ImageIcon;
  const label = LABELS[kind] || 'Media';
  const isVideo = kind === 'video';
  const displayText = (preview.text && preview.text !== label) ? preview.text : null;

  return (
    <VariantRow>
      {thumbSrc
        ? <Thumb src={thumbSrc} isVideo={isVideo} onError={() => setThumbFailed(true)} />
        : <IconBox icon={Icon} />
      }
      <VariantBody
        badge={<TypeBadge icon={Icon} label={label} />}
        text={displayText}
      />
    </VariantRow>
  );
}

function VoiceVariant({ preview }) {
  const displayText = (preview.text && preview.text !== 'Voice message') ? preview.text : null;
  return (
    <VariantRow>
      <IconBox icon={Mic} />
      <VariantBody
        badge={<TypeBadge icon={Mic} label="Voice message" />}
        text={displayText}
      />
    </VariantRow>
  );
}

function FileVariant({ preview }) {
  const displayText = (preview.text && preview.text !== 'File') ? preview.text : null;
  return (
    <VariantRow>
      <IconBox icon={FileText} />
      <VariantBody
        badge={<TypeBadge icon={FileText} label="File" />}
        text={displayText}
      />
    </VariantRow>
  );
}

function PostVariant({ preview }) {
  const [imgFailed, setImgFailed] = useState(false);
  const avatarSrc = (!imgFailed && preview.avatarKey) ? getMediaUrl(preview.avatarKey) : null;

  return (
    <VariantRow>
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt=""
          aria-hidden="true"
          style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <IconBox icon={MessageSquare} />
      )}
      <VariantBody
        badge={<TypeBadge icon={MessageSquare} label="Post" />}
        text={preview.text}
      />
    </VariantRow>
  );
}

function ProfileVariant({ preview }) {
  return (
    <VariantRow>
      <ReplyEntityAvatar
        kind="profile"
        entityId={preview.entityId}
        fallbackAvatar={preview.avatarKey}
        fallbackColor={preview.entityColor}
        name={preview.text}
        isGroup={false}
      />
      <VariantBody
        badge={<TypeBadge icon={User} label="Profile" />}
        text={preview.text}
      />
    </VariantRow>
  );
}

function CommunityVariant({ preview }) {
  return (
    <VariantRow>
      <ReplyEntityAvatar
        kind="community"
        entityId={preview.entityId}
        fallbackAvatar={preview.avatarKey}
        fallbackColor={preview.entityColor}
        name={preview.text}
        isGroup={false}
      />
      <VariantBody
        badge={<TypeBadge icon={Users} label="Community" />}
        text={preview.text}
      />
    </VariantRow>
  );
}

function GroupInviteVariant({ preview }) {
  return (
    <VariantRow>
      <ReplyEntityAvatar
        kind="group_invite"
        entityId={preview.entityId}
        fallbackAvatar={preview.avatarKey}
        fallbackColor={preview.entityColor}
        name={preview.text}
        isGroup={true}
      />
      <VariantBody
        badge={<TypeBadge icon={Users} label="Group invite" />}
        text={preview.text}
      />
    </VariantRow>
  );
}

function ActivityVariant({ preview }) {
  return (
    <VariantRow>
      <IconBox icon={Calendar} />
      <VariantBody
        badge={<TypeBadge icon={Calendar} label="Event" />}
        text={preview.text}
      />
    </VariantRow>
  );
}

function PollVariant({ preview }) {
  return (
    <VariantRow>
      <IconBox icon={BarChart2} />
      <VariantBody
        badge={<TypeBadge icon={BarChart2} label="Poll" />}
        text={preview.text}
      />
    </VariantRow>
  );
}

function UnavailableVariant({ preview }) {
  const Icon = preview.kind === 'deleted' ? Ban : AlertCircle;
  return (
    <VariantRow muted>
      <Icon size={13} style={{ flexShrink: 0 }} aria-hidden="true" />
      <span style={{ fontSize: '0.8rem', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {preview.text}
      </span>
    </VariantRow>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function ReplyPreviewVariant({ preview }) {
  switch (preview.kind) {
    case 'text':
      return <TextVariant preview={preview} />;
    case 'link':
      return <LinkVariant preview={preview} />;
    case 'image':
    case 'gif':
    case 'sticker':
      return <MediaVariant preview={preview} kind={preview.kind} />;
    case 'video':
      return <MediaVariant preview={preview} kind="video" />;
    case 'voice':
      return <VoiceVariant preview={preview} />;
    case 'file':
      return <FileVariant preview={preview} />;
    case 'post':
      return <PostVariant preview={preview} />;
    case 'profile':
      return <ProfileVariant preview={preview} />;
    case 'community':
      return <CommunityVariant preview={preview} />;
    case 'group_invite':
      return <GroupInviteVariant preview={preview} />;
    case 'activity':
    case 'event':
      return <ActivityVariant preview={preview} />;
    case 'poll':
      return <PollVariant preview={preview} />;
    case 'deleted':
    case 'unavailable':
    case 'unknown':
      return <UnavailableVariant preview={preview} />;
    default:
      // Future kinds fall back to the text variant so the quote is never blank.
      return <TextVariant preview={preview} />;
  }
}

// ---------------------------------------------------------------------------
// ReplyEntityAvatar  (live avatar resolution for entities)
// ---------------------------------------------------------------------------

/**
 * Avatar for a quoted profile or community, resolved from LIVE app state.
 *
 * The avatar stored on a shared message is a snapshot from the moment it was
 * shared, so it goes stale as soon as that person or community changes their
 * picture. This looks the entity up by id and falls back to the snapshot only
 * when it isn't in state — so a quote tracks the current avatar, including one
 * changed seconds ago, since propagateUserMedia patches these same caches.
 *
 * Split into its own component so the lookups mount ONLY for quotes that are
 * actually an entity. Doing it in the parent would attach a communities query
 * observer to every reply preview on screen, including plain text and media
 * quotes that can never use it.
 */
function ReplyEntityAvatar({ kind, entityId, fallbackAvatar, fallbackColor, name, isGroup }) {
  const usersMap = useUsersMap();
  const { communitiesById } = useCommunities();
  const { conversations } = useConversations();

  /**
   * A broken picture must not fall through to a person glyph.
   *
   * `Avatar` answers a failed load with `/default_avatar.svg`, which is a
   * person. That is right for a person and wrong for a group: a quoted group
   * invite whose avatar could not be fetched rendered as an anonymous human,
   * which is what the reported screenshot shows. Catching the failure here lets
   * a group fall back to the same lettered circle it uses when it has no
   * picture at all.
   */
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [entityId, fallbackAvatar]);

  let live = null;
  let liveColor = null;
  if (entityId) {
    if (kind === 'profile') {
      const u = usersMap?.[entityId];
      live = u?.avatar || u?.avatarUrl || null;
    } else if (kind === 'group_invite') {
      /**
       * A GROUP CHAT IS NOT A COMMUNITY.
       *
       * This branch used to read `communitiesById[entityId]` for every
       * non-profile entity, and a group invite's `entityId` is a conversation
       * id, so the lookup never matched. The quote therefore always fell back
       * to the snapshot taken when the invite was sent — stale the moment the
       * group changed its picture, and blank whenever the sender's own copy had
       * no avatar to snapshot.
       *
       * The conversation list is where a group's current avatar actually lives,
       * and the invite card beside this quote already renders from it.
       */
      const group = (conversations || []).find(
        (c) => String(c.id) === String(entityId) || String(c.publicId) === String(entityId),
      );
      live = group?.avatarKey || group?.avatar || group?.icon || null;
    } else {
      const c = communitiesById?.[entityId];
      live = c?.avatarKey || c?.avatar || null;
      liveColor = c?.color || null;
    }
  }

  const src = imageFailed ? null : (live || fallbackAvatar || null);

  // With a real picture, render it through Avatar so it goes through the same
  // media resolution, error handling and caching as every other avatar.
  if (src) {
    return (
      <Avatar
        src={src}
        name={name}
        size="36px"
        isGroup={isGroup}
        disableHover
        onError={() => setImageFailed(true)}
        // Communities and profiles are forced circular so a community WITH a
        // picture looks the same as the circle the picture-less fallback draws.
        // Group invites are intentionally NOT forced circular — they must show
        // the rounded-square shape that group avatars use everywhere else in the
        // product.
        style={kind !== 'group_invite' ? { borderRadius: '50%' } : undefined}
      />
    );
  }

  // Without one, every quoted entity — person, community or group — gets the same
  // treatment a picture-less community already gets elsewhere in the app
  // (SharedCommunityPreview, CommunityCard): a filled circle carrying the first
  // letter of its name. The generic person/group glyphs used before identified
  // only the TYPE, so two different communities, or two different people, were
  // indistinguishable in a quote.
  const initial = (name || '').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        // Group invites get the rounded-square shape group avatars use everywhere
        // else in the product. Communities and profiles stay circular, matching
        // .avatarFallback's border-radius: 50%.
        borderRadius: kind === 'group_invite' ? 8 : '50%',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Communities carry a brand colour; people have none, so they fall back
        // to the theme primary exactly as a colourless community would.
        background: liveColor || fallbackColor || 'var(--color-primary, #2563eb)',
        color: '#ffffff',
        fontSize: 14,
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: 'var(--font-family-display, inherit)',
        userSelect: 'none',
      }}
    >
      {initial}
    </span>
  );
}
