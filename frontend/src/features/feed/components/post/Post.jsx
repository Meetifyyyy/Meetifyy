import { useState, memo, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { sanitizeUrl } from '@shared/utils/urlSanitize';
import Avatar from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { getCollegeName } from '@shared/utils/user';
import RichText from '@shared/components/mentions/RichText';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';
import { Trash2, Flag } from '@shared/components/icons';
import { normalizeBodyText, truncateBodyText, clipMentions, POST_LIMITS } from '@shared/utils/bodyText';
import { useAuth } from '@shared/context/AuthContext';
import { usePageTransition } from '@shared/hooks/usePageTransition';
import { CENTRE_EFFECT } from '@shared/lib/navigation/centreTransition';
import { useCommunities } from '@shared/hooks/useCommunities';
import { timeAgo } from '@shared/utils/time';
import styles from './Post.module.css';
import PostActions from './PostActions';
import { useMediaViewerActions } from '@shared/context/MediaViewerContext';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import ReportModal from '@shared/components/modals/ReportModal/LazyReportModal';
import MediaGrid from './MediaGrid';
import { useDeletePost, DELETING_FLAG } from '../../hooks/useDeletePost';
import PollCard from './PollCard';
import { getMediaUrl } from '@shared/api/apiClient';

function Post({ postData, onClick, onCommentClick, onDeleted, isDetailed = false, hideCommunityTag = false }) {
  const { currentUser } = useAuth();
  // The author's profile opens out of the centre of the screen in the app.
  const { openFromLink: openProfileFromLink } = usePageTransition({ effect: CENTRE_EFFECT });
  const { communitiesById } = useCommunities();
  const { openViewer } = useMediaViewerActions();
  const menu = useMenu();
  const [isExpanded, setIsExpanded] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported] = useState(false);

  const id = postData?.id;

  const { mutate: deletePost } = useDeletePost();

  /**
   * Set on the cached post by useDeletePost the instant the request goes out,
   * and cleared (or the post removed) when it settles. Read from the cached
   * data rather than held in this component's own state on purpose: the same
   * post can be mounted in several places at once — the feed behind an open
   * detail view, a profile list, a community list — and all of them have to
   * show the same thing and refuse a second delete, not just the card the
   * user happened to click.
   */
  const isDeleting = postData?.[DELETING_FLAG] === true;

  /*
   * The outside-click listener and the `close-all-post-menus` broadcast are
   * both gone.
   *
   * Each card used to own its menu's open state, so two cards could have one
   * open at once and a window-wide custom event existed to tell the others to
   * shut. `Menu` closes on any outside pointer-down — including the press that
   * opens another card's menu — so the coordination has nothing left to do.
   */

  const { authorId, time, text, mentions, poll } = postData || {};

  /**
   * Normalise and clip once per render, not twice.
   *
   * The text block and the media block below both needed the answer to "is this
   * body long enough to collapse?", and each computed it from scratch — so
   * `normalizeBodyText` + `truncateBodyText` ran twice over every post body on
   * every render, and the media block threw its copy away after reading one
   * boolean off it.
   */
  const body = useMemo(() => {
    if (!text) return null;
    const normalized = normalizeBodyText(text);
    return { normalized, clip: truncateBodyText(normalized, POST_LIMITS) };
  }, [text]);

  const author = useMemo(
    () => postData?.author || { id: authorId, displayName: 'User', username: 'user', avatar: null },
    [postData?.author, authorId],
  );

  const handleCardClick = useCallback(() => {
    if (isDetailed) return;
    if (onClick) onClick(postData);
  }, [isDetailed, onClick, postData]);

  /**
   * Stable, so the memo on <PostActions> can actually hold.
   *
   * This was an inline arrow, which meant PostActions received a brand-new
   * `onCommentClick` on every render of this card and re-rendered its four
   * buttons and their SVGs every time — `memo(PostActions)` never once bailed.
   */
  const handleCommentClick = useCallback((e) => {
    if (onCommentClick) {
      onCommentClick(postData, e);
    } else if (onClick) {
      onClick(postData, { focusComment: true });
    }
  }, [onCommentClick, onClick, postData]);

  /**
   * Also stable, for the same reason: MediaGrid is memoised and an inline
   * handler defeated it.
   */
  const handleMediaClick = useCallback((items, index) => {
    const isOwner = Boolean(currentUser?.id) && currentUser.id === (authorId ?? author?.id);
    openViewer(items, index, {
      authorName: author.displayName,
      authorAvatar: author.avatar,
      authorUsername: author.username,
      timestamp: postData.createdAt ? new Date(postData.createdAt).toLocaleString() : time,
      source: 'Post',
      isOwner,
      post: postData,
      author,
      /*
       * What the viewer reports when someone reports this media: the post, by its
       * server id. The viewer used to guess - the post's author as a USER, or
       * the media URL as a post id - and the backend answered the first with the
       * wrong kind of report and the second with a 404.
       *
       * Left out entirely for your own post, which is not something to offer
       * a report on, and for a post without a real id; the viewer then shows no
       * Report action rather than one that cannot work.
       */
      ...(!isOwner && postData.id ? { report: { targetType: 'POST', targetId: postData.id } } : {}),
    });
  }, [openViewer, author, postData, time, currentUser?.id, authorId]);

  // Every hook is above this line; the guard cannot change hook order.
  if (!postData) return null;

  const isOwnPost = Boolean(currentUser && authorId === currentUser.id);

  /**
   * Whether to offer removal — the server's answer, not our own.
   *
   * `canDelete` comes from the same authorizer the DELETE endpoint enforces
   * with, so a community owner and a moderator see the control on content they
   * are actually allowed to remove. Re-deriving the role rules here would put a
   * second copy of an authorization rule in the one place that cannot enforce
   * it, and the copies would drift.
   *
   * Falls back to authorship for a payload from an older server, which is the
   * safe direction: it under-offers rather than showing a control the API would
   * refuse anyway.
   */
  const canDeletePost = postData?.canDelete ?? isOwnPost;

  /**
   * Removing someone else's post is a different act from deleting your own,
   * and the UI should say so.
   *
   * The label stays "Delete" either way — that is the app's word for this
   * action everywhere else, and inventing a second verb for the same button
   * just makes moderators wonder whether it does something different. Only
   * the confirmation copy changes, to name whose post it is and to say the
   * author will be told. A moderator should not learn that a notification
   * went out by hearing about it from the author.
   */
  const isModeratingOthers = canDeletePost && !isOwnPost;
  const authorCollegeName = getCollegeName(author, '');

  const formatExactDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${timeStr} · ${dateStr}`;
  };

  const exactTimeStr = postData.createdAt ? formatExactDate(postData.createdAt) : time;


  // The post now carries its own community from the API, which is the only
  // source that is always right. `communitiesById` is a fallback for cached
  // posts written before that field existed — it is built from the user's
  // community list, which the API paginates to 30, so relying on it alone
  // meant posts from a user's 31st community rendered with no tag at all.
  //
  // The two sources are MERGED rather than one winning outright. Different
  // endpoints carry different amounts of community: the feed builds a full
  // object, while the single-post route used to return only id/name — so the
  // same post showed its real icon in the feed and a letter on a default blue
  // circle once opened. Post fields win where present; the cached list fills
  // the gaps.
  // Deliberately NOT a useMemo: there is an early `return null` above (line
  // ~229), and a hook added below it would run on some renders and not others
  // — "Rendered more hooks than during the previous render". The merge is a
  // spread of a handful of fields, so it is cheap enough to do inline.
  const postCommunity = (() => {
    if (hideCommunityTag) return null;
    const fromPost = postData.community || null;
    const fromList =
      (postData.communityId && communitiesById
        ? communitiesById[postData.communityId]
        : null) || null;
    if (!fromPost) return fromList;
    if (!fromList) return fromPost;
    const merged = { ...fromList };
    for (const [k, v] of Object.entries(fromPost)) {
      if (v !== null && v !== undefined) merged[k] = v;
    }
    return merged;
  })();

  // One resolution path for the community icon, shared with the community
  // cards and the community header. The badge below read `.avatar` raw and put
  // it through the *user* avatar helper, so a stored object key — which is
  // what the column actually holds — never resolved to an image.

  return (
    <div
      data-post-id={id}
      className={`${styles.post}${isDetailed ? ` ${styles.postDetailed}` : ''}${isDeleting ? ` ${styles.postDeleting}` : ''}`}
      onClick={isDeleting ? undefined : handleCardClick}
      // Announces the pending state to assistive tech, which the visual
      // overlay alone does not.
      aria-busy={isDeleting || undefined}
      style={{ cursor: isDeleting ? 'default' : ((!isDetailed && onClick) ? 'pointer' : 'default') }}
    >
      {isDeleting && (
        <div className={styles.deletingOverlay} role="status" onClick={(e) => e.stopPropagation()}>
          <span className={styles.deletingSpinner} aria-hidden="true" />
          <span>Deleting post…</span>
        </div>
      )}
      <div className={styles.postHeader}>
        <div className={styles.postAvatarContainer}>
          <Link
            to={`/profile/${author.username}`}
            style={{ textDecoration: 'none' }}
            onClick={(e) => { e.stopPropagation(); openProfileFromLink(e, `/profile/${author.username}`); }}
          >
            <div className={styles.postAvatar}>
              <Avatar src={author.avatar} name={author.displayName} size="100%" />
            </div>
          </Link>
        </div>
        <div className={styles.postUser}>
          <Link
            to={`/profile/${author.username}`}
            style={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
            onClick={(e) => { e.stopPropagation(); openProfileFromLink(e, `/profile/${author.username}`); }}
          >
            <div className={`hover-underline ${styles.postName}`}>{author.displayName}</div>
            <CollegeRepresentativeBadge isCampusRep={author.isCampusRep} collegeName={authorCollegeName} user={author} size="md" />
          </Link>
          <div className={styles.postTime} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {postCommunity ? (
              <Link 
                to={`/communities/${postCommunity.id}`} 
                className={styles.communityNameLink}
                onClick={(e) => e.stopPropagation()}
              >
                {postCommunity.name}
              </Link>
            ) : (
              <span className={styles.postUsername}>@{author.username}</span>
            )}
            <span className={styles.postTimeDot}>·</span>
            <span>{postData.createdAt ? timeAgo(postData.createdAt) : (time ? timeAgo(time) : '')}</span>
          </div>
        </div>

        <div className={styles.postMenuWrapper}>
          <button
            {...menu.triggerProps}
            aria-label="Post options"
            className={styles.menuBtn}
          >
            {/* Two lines, the lower one shorter: a quiet menu glyph, faded so
                it does not compete with the post (Post.module.css). */}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="7" x2="17" y2="7" />
              <line x1="3" y1="13" x2="11" y2="13" />
            </svg>
          </button>

          <Menu {...menu.menuProps} size="sm" ariaLabel="Post options">
            {canDeletePost && (
              <MenuItem
                icon={Trash2}
                tone="danger"
                /*
                 * Disabled while a delete is in flight so the confirm dialog
                 * cannot be reopened and a second DELETE issued for the same
                 * post. The card also renders its own progress state, so this
                 * is the belt to that braces.
                 */
                disabled={isDeleting}
                onSelect={() => setShowDeleteConfirm(true)}
                onClose={menu.close}
              >
                Delete post
              </MenuItem>
            )}
            {!isOwnPost && (
              <MenuItem
                icon={Flag}
                disabled={hasReported}
                onSelect={() => setShowReportModal(true)}
                onClose={menu.close}
              >
                {hasReported ? 'Already reported' : 'Report'}
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>

      {body && (() => {
        const { normalized: normalizedText, clip } = body;
        // The detail page is the place the whole post is meant to be read, so
        // nothing is clipped there however long it runs.
        const needsTruncation = clip.needsTruncation && !isDetailed;
        const collapsed = needsTruncation && !isExpanded;

        const displayedText = collapsed ? clip.text : normalizedText;
        const displayedMentions = collapsed ? clipMentions(mentions, displayedText) : mentions;

        return (
          <div className={`${styles.postBody} ${isDetailed ? styles.selectableText : ''}`}>
            <RichText content={displayedText} mentions={displayedMentions} urlLimit={isDetailed ? 50 : 35} linkHashtags />
            {needsTruncation && (
              <>
                {/*
                  * A real space, not a margin.
                  *
                  * It is what makes the control read as the next word of the
                  * sentence rather than a block underneath, and it is also the
                  * only thing that gives the line a break opportunity here — an
                  * inline box with no whitespace before it cannot wrap, so on a
                  * narrow screen the control would push past the edge instead
                  * of dropping to the next line.
                  */}
                {' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                  className={styles.seeMoreBtn}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? 'See less' : 'See more'}
                </button>
              </>
            )}
          </div>
        );
      })()}

      {/*
        * Attachments render on their own terms, never on the text's.
        *
        * This block used to be gated on the same `needsTruncation` flag as the
        * body copy: a post whose caption ran past the clip limit had its media,
        * its link preview AND its poll collapsed to `max-height: 0;
        * visibility: hidden` until the reader pressed "See more". The intent was
        * a compact card, but the effect was that a photo posted with a long
        * caption looked like a post with no photo, and a poll looked like it had
        * no options. "See more" is a control over text; it was silently deciding
        * whether the actual content of the post appeared at all.
        *
        * Nothing here reads the text state now, so there is no path by which a
        * caption's length can hide an attachment. Expanding or collapsing the
        * copy above reflows this block downwards, which is ordinary document
        * flow, and cannot make it disappear or re-mount.
        */}
      {(postData.media || postData.linkPreview || poll) && (
        <div className={styles.postAttachments}>
          {postData.media && (
            <MediaGrid
              media={postData.media}
              onMediaClick={handleMediaClick}
              authorName={postData.author?.displayName || postData.author?.username}
            />
          )}
          {postData.linkPreview && (
            <a
              href={sanitizeUrl(postData.linkPreview.url)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkPreview}
              onClick={(e) => e.stopPropagation()}
            >
              {postData.linkPreview.image && (
                <img
                  src={getMediaUrl(postData.linkPreview.image)}
                  alt=""
                  loading="lazy"
                  className={styles.linkPreviewImg}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <div className={styles.linkPreviewBody}>
                {postData.linkPreview.site && (
                  <span className={styles.linkPreviewSite}>{postData.linkPreview.site}</span>
                )}
                <span className={styles.linkPreviewTitle}>{postData.linkPreview.title}</span>
                {postData.linkPreview.description && (
                  <span className={styles.linkPreviewDesc}>{postData.linkPreview.description}</span>
                )}
              </div>
            </a>
          )}
          {poll && <div onClick={(e) => e.stopPropagation()}><PollCard poll={poll} postId={id} /></div>}
        </div>
      )}

      {isDetailed && exactTimeStr && (
        <div className={styles.postExactTime}>
          {exactTimeStr}
        </div>
      )}

      <PostActions
        post={postData}
        authorOverride={author}
        onCommentClick={handleCommentClick}
      />

      {showDeleteConfirm && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title="Delete Post"
            desc={
              isModeratingOthers
                ? `This deletes ${author?.displayName || author?.username || 'this member'}'s post. They'll be notified that a moderator deleted it.`
                : 'This post will be permanently removed.'
            }
            visible={showDeleteConfirm}
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={() => {
              setShowDeleteConfirm(false);
              // Third guard. Not airtight on its own — `isDeleting` is read
              // from this render's closure, so two confirms dispatched in the
              // same tick would both see `false`. What actually makes that
              // unreachable is the line above: the modal unmounts on the first
              // confirm. This catches the case that IS reachable — the menu
              // reopened while a delete from this card is still in flight.
              //
              // A duplicate that somehow got through would be harmless anyway:
              // the second DELETE answers 404, which useDeletePost treats as
              // already-done rather than as an error.
              if (isDeleting) return;
              deletePost({ postId: id });
              // The detail view has nothing left to show, so it leaves at once
              // rather than sitting on a progress state it cannot act on. The
              // list underneath carries the "Deleting post..." card, which is
              // where the outcome — removal, or restore with an error — lands.
              if (isDetailed && onDeleted) onDeleted();
            }}
            confirmText="Delete"
            cancelText="Cancel"
            isDestructive={true}
          />
        </div>
      )}

      {showReportModal && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          targetType="POST"
          targetId={id}
          targetPreview={text?.slice(0, 80)}
          targetName={author?.displayName || author?.username}
          targetAvatar={author?.avatar}
          reportedFrom="feed"
          onSubmitted={() => setHasReported(true)}
        />
      )}
    </div>
  );
}

function arePostPropsEqual(prevProps, nextProps) {
  if (prevProps.isDetailed !== nextProps.isDetailed) return false;
  if (prevProps.hideCommunityTag !== nextProps.hideCommunityTag) return false;
  if (prevProps.onClick !== nextProps.onClick) return false;
  if (prevProps.onCommentClick !== nextProps.onCommentClick) return false;
  if (prevProps.onDeleted !== nextProps.onDeleted) return false;

  const prev = prevProps.postData;
  const next = nextProps.postData;
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.id !== next.id) return false;
  // The deletion progress state. This comparator is an allowlist of the fields
  // the card renders, so a new one is invisible until it is listed here — and
  // the symptom would be the worst kind: the delete fires, the card carries on
  // looking untouched, and the user presses Delete again.
  if (prev[DELETING_FLAG] !== next[DELETING_FLAG]) return false;
  if (prev.text !== next.text) return false;
  // The community tag is part of what this card renders, so a post that
  // gains its community (a cached row refetched with the field populated)
  // has to re-render — otherwise the tag never appears.
  if (prev.communityId !== next.communityId) return false;
  if (prev.community?.id !== next.community?.id) return false;
  if (prev.community?.name !== next.community?.name) return false;
  if (prev.likeCount !== next.likeCount || prev.likesCount !== next.likesCount) return false;
  if (prev.commentCount !== next.commentCount || prev.commentsCount !== next.commentsCount) return false;
  if (prev.isLiked !== next.isLiked || prev.hasLiked !== next.hasLiked || prev.isLikedByMe !== next.isLikedByMe) return false;
  if (prev.isBookmarked !== next.isBookmarked || prev.hasBookmarked !== next.hasBookmarked) return false;
  if (prev.updatedAt !== next.updatedAt) return false;
  // `JSON.stringify` used to decide these three.
  //
  // It is correct but it is the most expensive thing this comparator could do,
  // and it runs on the render path: a refetch replaces every post object, so a
  // window-focus revalidation serialised the media list, the poll and the
  // author of every card on screen — and did it again on the next commit. The
  // field-level comparisons below answer the same question by reading the
  // handful of properties this card actually renders.
  if (!sameMedia(prev.media, next.media)) return false;
  if (!samePoll(prev.poll, next.poll)) return false;
  if (!sameAuthor(prev.author, next.author)) return false;
  return true;
}

/** The media properties MediaGrid lays out and loads. */
function sameMedia(a, b) {
  if (a === b) return true;
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    const x = listA[i] || {};
    const y = listB[i] || {};
    if (x === y) continue;
    if (x.url !== y.url || x.thumb !== y.thumb || x.type !== y.type
      || x.width !== y.width || x.height !== y.height
      || x.aspectRatio !== y.aspectRatio || x.placeholder !== y.placeholder) return false;
  }
  return true;
}

/** The poll properties PollCard renders — options, their counts and the vote. */
function samePoll(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.totalVotes !== b.totalVotes) return false;
  if (a.votedOptionIndex !== b.votedOptionIndex) return false;
  if (a.userVotedOptionId !== b.userVotedOptionId) return false;
  // `myVotes`/`selectedUsers` decide whether results are shown at all, so a
  // change to either has to re-render even when the totals happen to match.
  if (a.myVotes !== b.myVotes) return false;
  if (a.selectedUsers !== b.selectedUsers) return false;
  const optsA = Array.isArray(a.options) ? a.options : [];
  const optsB = Array.isArray(b.options) ? b.options : [];
  if (optsA.length !== optsB.length) return false;
  for (let i = 0; i < optsA.length; i++) {
    const x = optsA[i];
    const y = optsB[i];
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return false;
    if (x.id !== y.id || x.text !== y.text || x.label !== y.label
      || x.votes !== y.votes || x.voteCount !== y.voteCount) return false;
  }
  return true;
}

/** The author fields this card puts on screen. */
function sameAuthor(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.displayName === b.displayName
    && a.username === b.username
    && a.avatar === b.avatar
    && a.collegeId === b.collegeId
    && a.isCampusRep === b.isCampusRep;
}

export default memo(Post, arePostPropsEqual);
