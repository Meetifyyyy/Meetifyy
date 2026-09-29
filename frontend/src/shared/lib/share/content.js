/**
 * What is being shared, as one shape for all four kinds.
 *
 * Every share surface used to read the raw entity it was handed: the post
 * dialog carried ninety lines of media and poll normalisation inline, and each
 * of the other three built its own chat payload from whatever fields its own
 * caller happened to pass. This module is the single place that turns a post,
 * profile, community or activity into a `ShareContent`, and everything
 * downstream — the chat payload, the canonical link, the story card — reads
 * that instead of the entity.
 *
 *   entity ──normalizeShareContent──▶ ShareContent
 *                                        ├─ .url               canonical link (sharePayload.js)
 *                                        ├─ toChatInvite()     chat message payload
 *                                        └─ story/model.js     Instagram Story card
 *
 * Pure: no React, no DOM, no network. Media values are resolved to absolute
 * URLs through `getMediaUrl`, the same resolver every screen uses.
 */
import { getMediaUrl } from '@shared/api/apiClient';
import { resolveCommunityCover } from '@shared/utils/community';
import {
  activityShareUrl,
  communityShareUrl,
  postShareUrl,
  profileShareUrl,
} from './sharePayload';

export const SHARE_KIND = {
  POST: 'post',
  PROFILE: 'profile',
  COMMUNITY: 'community',
  ACTIVITY: 'activity',
};

/** The noun each kind is called in the interface. */
export const SHARE_KIND_LABEL = {
  post: 'Post',
  profile: 'Profile',
  community: 'Community',
  activity: 'Activity',
};

const str = (value) => (typeof value === 'string' ? value.trim() : '');

/** A media value as an absolute URL, or '' when it cannot be one. */
function mediaUrl(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return getMediaUrl(raw) || '';
  if (typeof raw === 'object') {
    const key = raw.url || raw.objectKey || raw.storageKey || raw.path;
    if (!key) return '';
    const path = raw.url ? key : `/api/media/${key}`;
    return getMediaUrl(path) || '';
  }
  return '';
}

/**
 * A stored cover value, which may be an uploaded image or a CSS gradient.
 * The old platform-default keys point at deleted objects and count as empty.
 */
export function describeCover(raw) {
  const value = str(raw);
  if (!value || value.includes('/api/media/defaults/')) return { type: 'empty' };
  if (/^(linear|radial|conic)-gradient/.test(value)) return { type: 'gradient', value };
  const url = mediaUrl(value);
  return url ? { type: 'image', url } : { type: 'empty' };
}

// ── Posts ────────────────────────────────────────────────────────────────

/**
 * The post's attachments, in order, whichever of the historical shapes it
 * arrived in: `media` (current), `images`, a single `mediaUrl`/`mediaKey`, or
 * a single `image`.
 */
export function normalizePostMedia(post) {
  let list = [];
  if (Array.isArray(post?.media) && post.media.length > 0) {
    list = post.media.map((m) =>
      typeof m === 'string'
        ? { url: mediaUrl(m), type: 'image' }
        : {
            ...m,
            url: mediaUrl(m),
            type: m.type || m.mediaType || 'image',
          },
    );
  } else if (Array.isArray(post?.images) && post.images.length > 0) {
    list = post.images.map((img) => ({ url: mediaUrl(img), type: 'image' }));
  } else if (post?.mediaUrl || post?.mediaKey) {
    list = [{ url: mediaUrl(post.mediaUrl || post.mediaKey), type: post.mediaType || 'image' }];
  } else if (post?.image) {
    list = [{ url: mediaUrl(post.image), type: 'image' }];
  }
  return list.filter((m) => m.url);
}

/** Display text for a poll option or question of unknown shape. */
export function optionText(o) {
  if (!o) return '';
  if (typeof o === 'string') return o;
  if (typeof o === 'number') return String(o);
  if (typeof o === 'object') {
    for (const key of ['text', 'label', 'title', 'question']) {
      if (typeof o[key] === 'string') return o[key];
    }
    for (const key of ['text', 'label', 'title']) {
      if (o[key] && typeof o[key] === 'object') return optionText(o[key]);
    }
  }
  return '';
}

function optionVotes(o) {
  if (!o || typeof o !== 'object') return 0;
  const count = o.votes ?? o.voteCount ?? o._count?.votes ?? 0;
  return Number(count) || 0;
}

/**
 * The poll, if the post has one: `{ question, options: [{ id, text, votes }],
 * totalVotes }`.
 *
 * Accepts the feed's `poll` object (where `votes` may be a parallel array of
 * counts) and the older flat `pollOptions`. Returns null for a post without
 * options — a poll with nothing to vote on is not rendered as one.
 */
export function normalizePoll(post) {
  const poll = post?.poll;
  let options = [];
  let question = '';

  if (poll && Array.isArray(poll.options)) {
    const parallel = Array.isArray(poll.votes) ? poll.votes : null;
    options = poll.options.map((opt, i) => ({
      id: typeof opt === 'object' ? opt?.id : undefined,
      text: optionText(opt),
      votes: parallel ? Number(parallel[i]) || 0 : optionVotes(opt),
    }));
    question = optionText(poll.question);
  } else if (Array.isArray(post?.pollOptions)) {
    options = post.pollOptions.map((opt) => ({
      id: typeof opt === 'object' ? opt?.id : undefined,
      text: optionText(opt),
      votes: optionVotes(opt),
    }));
    question = optionText(post.pollQuestion);
  }

  options = options.filter((o) => o.text);
  if (options.length === 0) return null;

  const summed = options.reduce((acc, o) => acc + o.votes, 0);
  const declared = Number(poll?.totalVotes);
  return {
    question,
    options,
    totalVotes: Number.isFinite(declared) && declared >= summed ? declared : summed,
  };
}

/**
 * The feed's own rule (MediaGrid): a video is typed `video`/`video/*` or has
 * a video extension; everything else — `IMAGE`, `image/webp`, untyped — is a
 * picture. Matching it exactly is what keeps a post's photo on its card.
 */
function isVideo(item) {
  const type = String(item.type || item.mimeType || '').toLowerCase();
  const src = String(item.url || '');
  return type === 'video' || type.startsWith('video/') || /\.(mp4|webm)(\?|$)/i.test(src) || src.startsWith('data:video');
}

/** A count, or 0 for anything that is not one (e.g. a likes ARRAY). */
function countOf(value) {
  if (Array.isArray(value)) return value.length;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function postContent(post, author) {
  const media = normalizePostMedia(post);
  return {
    kind: SHARE_KIND.POST,
    id: post?.id ?? null,
    url: postShareUrl(post?.id),
    text: typeof post?.text === 'string' ? post.text : '',
    author: {
      name:
        str(author?.displayName) ||
        str(post?.author?.displayName) ||
        str(post?.authorName) ||
        str(author?.username) ||
        'Someone',
      username:
        str(author?.username) ||
        str(post?.author?.username) ||
        str(post?.authorUsername) ||
        str(post?.username) ||
        '',
      avatar: mediaUrl(author?.avatar || post?.author?.avatar || post?.authorAvatar),
      // As stored, for the chat payload, whose preview resolves it itself.
      avatarRaw: author?.avatar || post?.authorAvatar || null,
    },
    createdAt: post?.createdAt || null,
    time: post?.time || null,
    // Read the way PostActions reads them, across the historical field names.
    likeCount: countOf(post?.likeCount ?? post?.likesCount ?? post?.likes),
    commentCount: countOf(post?.commentCount ?? post?.commentsCount ?? post?.comments),
    media,
    images: media.filter((m) => !isVideo(m)).map((m) => m.url),
    poll: normalizePoll(post),
  };
}

// ── Profiles ─────────────────────────────────────────────────────────────

function profileContent(user) {
  const interests = Array.isArray(user?.interests)
    ? user.interests.filter((t) => typeof t === 'string' && t.trim())
    : [];
  return {
    kind: SHARE_KIND.PROFILE,
    id: user?.id ?? null,
    url: profileShareUrl(user?.username),
    name: str(user?.displayName) || str(user?.username) || 'Someone',
    username: str(user?.username),
    avatar: mediaUrl(user?.avatar),
    cover: describeCover(user?.cover),
    tags: interests,
  };
}

// ── Communities ──────────────────────────────────────────────────────────

/**
 * Member count, whichever shape the community arrived in: the list endpoint
 * returns `memberCount`, some payloads `membersCount`, and the detail endpoint
 * a `members` array.
 */
export function memberCountOf(community) {
  const direct = community?.memberCount ?? community?.membersCount;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  if (Array.isArray(direct)) return direct.length;
  if (Array.isArray(community?.members)) return community.members.length;
  return 0;
}

function communityContent(community) {
  const rawCover = community?.coverKey || community?.coverImage || community?.cover;
  const gradient = describeCover(rawCover);
  const coverUrl = resolveCommunityCover(community);
  return {
    kind: SHARE_KIND.COMMUNITY,
    id: community?.id ?? null,
    url: communityShareUrl(community?.id),
    name: str(community?.name) || 'Community',
    avatar: mediaUrl(community?.avatarKey || community?.avatar),
    color: str(community?.color),
    cover:
      gradient.type === 'gradient'
        ? gradient
        : coverUrl && !coverUrl.includes('/api/media/defaults/')
          ? { type: 'image', url: coverUrl }
          : { type: 'empty' },
    memberCount: memberCountOf(community),
    // Carried for the chat payload only; the story card does not show it.
    description: community?.description || community?.desc || '',
  };
}

// ── Activities ───────────────────────────────────────────────────────────

function activityContent(activity) {
  return {
    kind: SHARE_KIND.ACTIVITY,
    id: activity?.id ?? null,
    url: activityShareUrl(activity?.id),
    title: str(activity?.title) || 'Activity',
    startDate: activity?.startDate || activity?.date || null,
    dateLabel: str(activity?.dateLabel),
    time: str(activity?.time),
    location: str(activity?.location),
    image: mediaUrl(activity?.image || activity?.coverImage),
    raw: activity,
  };
}

/**
 * The one entry point: `(kind, entity, extra)` → `ShareContent`.
 *
 * `extra.author` is the post's author where the caller has it separately.
 * Returns null when the entity has no id, which every surface treats as
 * "nothing shareable" rather than rendering a card for nothing.
 */
export function normalizeShareContent(kind, entity, extra = {}) {
  if (!entity) return null;
  let content;
  switch (kind) {
    case SHARE_KIND.POST:
      content = postContent(entity, extra.author);
      break;
    case SHARE_KIND.PROFILE:
      content = profileContent(entity);
      break;
    case SHARE_KIND.COMMUNITY:
      content = communityContent(entity);
      break;
    case SHARE_KIND.ACTIVITY:
      content = activityContent(entity);
      break;
    default:
      return null;
  }
  // A profile is addressed by username; everything else by id.
  const addressable = kind === SHARE_KIND.PROFILE ? content.username : content.id;
  return addressable && content.url ? content : null;
}

/**
 * The `inviteData` a chat message carries for a share.
 *
 * The SHAPES are a wire contract: installed apps and every message already
 * sent render them through `features/messages/shared/previews/*`, so the
 * field names below are exactly the ones those previews read and must not be
 * renamed.
 */
export function toChatInvite(content, entity) {
  switch (content?.kind) {
    case SHARE_KIND.POST: {
      const poll = content.poll;
      const primary = content.media[0]?.url || null;
      return {
        type: 'postShare',
        post: {
          id: content.id,
          text: content.text,
          authorName: content.author.name,
          authorUsername: content.author.username || null,
          authorAvatar: content.author.avatarRaw,
          time: content.time,
          createdAt: content.createdAt,
          media: content.media,
          image: primary,
          mediaUrl: primary,
          poll: poll ? { ...poll, question: poll.question || 'Poll' } : null,
          pollQuestion: poll?.question || null,
          pollOptions: poll?.options || [],
        },
      };
    }
    case SHARE_KIND.PROFILE:
      return {
        type: 'profileShare',
        profile: {
          id: entity?.id,
          username: entity?.username,
          displayName: entity?.displayName,
          avatar: entity?.avatar,
          bio: entity?.bio,
          followers: entity?.stats?.followers ?? entity?.followers ?? 0,
          following: entity?.stats?.following ?? entity?.following ?? 0,
        },
      };
    case SHARE_KIND.COMMUNITY:
      return {
        type: 'communityShare',
        community: {
          id: content.id,
          name: entity?.name,
          avatar: entity?.avatarKey || entity?.avatar || null,
          color: entity?.color,
          description: content.description,
          // A COUNT, never the members array: the preview formats it.
          membersCount: content.memberCount,
        },
      };
    case SHARE_KIND.ACTIVITY:
      return {
        type: 'activityShare',
        activity: {
          id: entity?.id,
          title: entity?.title,
          time: entity?.time,
          date: entity?.date,
          dateLabel: entity?.dateLabel,
          hostName: entity?.hostName,
          category: entity?.category,
          location: entity?.location,
          description: entity?.description,
          slotsNeeded: entity?.slotsNeeded,
          slotsFilled: entity?.slotsFilled,
          hostAvatar: entity?.hostAvatar,
        },
      };
    default:
      return null;
  }
}
