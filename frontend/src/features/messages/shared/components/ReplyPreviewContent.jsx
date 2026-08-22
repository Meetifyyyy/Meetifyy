import React from 'react';
import {
  Image as ImageIcon, Video, Mic, FileText, Link2, User, Users,
  FileImage, Calendar, Ban, AlertCircle, MessageSquare, Sticker,
} from 'lucide-react';
import { getMediaUrl } from '@shared/api/apiClient';
import Avatar from '@shared/components/avatar/Avatar';
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
  iconSize = 13,
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
      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
    >
      {isPerson || isGroupLike ? (
        <Avatar
          name={preview.text}
          size="20px"
          isGroup={isGroupLike}
          disableHover
          className={thumbClassName}
        />
      ) : thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          aria-hidden="true"
          className={thumbClassName}
          style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
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
          fontStyle: preview.isUnavailable ? 'italic' : undefined,
          opacity: preview.isUnavailable ? 0.75 : undefined,
        }}
      >
        {preview.text}
      </span>
    </div>
  );
}
