import React from 'react';
import {
  Image as ImageIcon, Video, Mic, FileText, Link2, User, Users,
  FileImage, Calendar, Ban, AlertCircle, MessageSquare, Sticker,
} from 'lucide-react';
import { getMediaUrl } from '@shared/api/apiClient';
import Avatar from '@shared/components/avatar/Avatar';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useCommunities } from '@shared/hooks/useCommunities';
import { resolveReplyPreview } from '../utils/replyPreview';

/**
 * The body of a reply quote: optional thumbnail, optional type icon, and a line
 * of text that is never empty.
 *
 * Rendered by both the composer bar and the message bubble so a quote looks the
 * same before and after sending. All type decisions come from
 * resolveReplyPreview(); this file only draws the result.
 */

const ICONS = {
  image: ImageIcon,
  gif: FileImage,
  sticker: Sticker,
  video: Video,
  voice: Mic,
  file: FileText,
  link: Link2,
  profile: User,
  community: Users,
  post: MessageSquare,
  activity: Calendar,
  event: Calendar,
  group_invite: Users,
  ban: Ban,
  alert: AlertCircle,
};

/**
 * @param {{ message: object|null, className?: string, textClassName?: string,
 *           thumbClassName?: string, iconSize?: number }} props
 *   `message` is a full message OR a server `replyTo` snapshot.
 */
export default function ReplyPreviewContent({
  message,
  className = '',
  textClassName = '',
  thumbClassName = '',
  iconSize = 15,
}) {
  const preview = resolveReplyPreview(message);
  const Icon = preview.icon ? ICONS[preview.icon] : null;

  // People and communities use the app's own avatar shapes rather than a generic
  // line icon, so a quoted profile or community reads the same here as it does
  // everywhere else in the product (round person / group treatment, same
  // fallback behaviour).
  const isPerson = preview.kind === 'profile';
  const isGroupLike = preview.kind === 'community' || preview.kind === 'group_invite';

  // Only resolve a thumbnail through the media layer; an unusable key returns
  // null there, in which case the icon alone carries the meaning.
  const thumbSrc = preview.thumbnailKey ? getMediaUrl(preview.thumbnailKey) : null;

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
    >
      {isPerson || isGroupLike ? (
        <ReplyEntityAvatar
          kind={preview.kind}
          entityId={preview.entityId}
          fallbackAvatar={preview.avatarKey}
          fallbackColor={preview.entityColor}
          name={preview.text}
          isGroup={isGroupLike}
          className={thumbClassName}
        />
      ) : thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          aria-hidden="true"
          className={thumbClassName}
          style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
          // A dead thumbnail must not leave a broken-image glyph in the quote;
          // hiding it falls back to the icon + label, which still describes the
          // message.
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : Icon ? (
        <Icon size={iconSize} style={{ flexShrink: 0, opacity: 0.85 }} aria-hidden="true" />
      ) : null}

      <span
        className={textClassName}
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.35,
          fontStyle: preview.isUnavailable ? 'italic' : undefined,
          opacity: preview.isUnavailable ? 0.75 : undefined,
        }}
      >
        {preview.text}
      </span>
    </div>
  );
}

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
function ReplyEntityAvatar({ kind, entityId, fallbackAvatar, fallbackColor, name, isGroup, className }) {
  const usersMap = useUsersMap();
  const { communitiesById } = useCommunities();

  let live = null;
  let liveColor = null;
  if (entityId) {
    if (kind === 'profile') {
      const u = usersMap?.[entityId];
      live = u?.avatar || u?.avatarUrl || null;
    } else {
      const c = communitiesById?.[entityId];
      live = c?.avatarKey || c?.avatar || null;
      liveColor = c?.color || null;
    }
  }

  const src = live || fallbackAvatar || null;

  // With a real picture, render it through Avatar so it goes through the same
  // media resolution, error handling and caching as every other avatar.
  if (src) {
    return (
      <Avatar
        src={src}
        name={name}
        size="26px"
        isGroup={isGroup}
        disableHover
        className={className}
        // Circular, overriding the squared-off group shape Avatar applies when
        // isGroup is set. In a quote every entity avatar is round — that is what
        // the picture-less fallback below draws, and what the shared-community
        // card uses — so a community WITH a picture was the odd one out, showing
        // as a rounded square beside the same community drawn as a circle.
        // Inline because .avatarGroup sets the radius through a class;
        // .avatarClip inherits the radius and clips the image to match.
        style={{ borderRadius: '50%' }}
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
      className={className}
      aria-hidden="true"
      style={{
        width: 26,
        height: 26,
        // Circular, matching .avatarFallback's border-radius: 50%.
        borderRadius: '50%',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Communities carry a brand colour; people have none, so they fall back
        // to the theme primary exactly as a colourless community would.
        background: liveColor || fallbackColor || 'var(--color-primary, #2563eb)',
        color: '#ffffff',
        fontSize: 12,
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
