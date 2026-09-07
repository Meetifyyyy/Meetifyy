/**
 * The post a signed-out visitor sees after clicking a shared link.
 *
 * WHY THIS EXISTS
 * A shared link is worthless if it lands on a sign-in wall. The whole pipeline
 * behind it — the canonical URL, the server-rendered metadata, the share card —
 * exists to get someone to a post, and `ProtectedRoute` bouncing them to the
 * landing page undoes all of it at the last step.
 *
 * WHY IT IS NOT THE REAL POST PAGE
 * `PostDetailRoute` renders comments, likes, bookmarks, poll results and the
 * author's profile card, every one of which needs a session and none of which
 * is part of what was shared. Reusing it would have meant opening those reads
 * to anonymous callers — a far larger change to what Meetifyy publishes than
 * "make shared links work", and not one this feature is entitled to make.
 *
 * So this renders exactly what the share card renders, from exactly the same
 * server projection (`shareApi.getPublicPost`), and everything else is an
 * invitation to sign in. A visitor who does is returned to this URL with the
 * full post, because the deep link is stored before they leave.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { shareApi, getMediaUrl } from '@shared/api/apiClient';
import { setRedirectIntent } from '@shared/utils/redirectIntent';
import LandingNavbar from '@features/auth/landing/components/LandingNavbar';
import LandingFooter from '@features/auth/landing/components/LandingFooter';
import '@features/auth/landing/landing.css';
import NotFoundState from '@shared/components/ui/NotFoundState';
import ShareTargets from '@shared/components/share/ShareTargets';
import { buildPostShare } from '@shared/lib/share/sharePayload';
import styles from './PublicPostPage.module.css';

/**
 * `postId` is a prop rather than a `useParams()` read, and has to be: this page
 * is rendered by the signed-out branch of `ProtectedRoute`, which short-circuits
 * the layout route before the child route carrying `:id` ever matches, so
 * `useParams()` here returns `{}`. It did, silently — the page mounted, asked
 * for a post with no id, and showed "post not found" for every valid link.
 */
export default function PublicPostPage({ postId: id }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['share-post', id],
    queryFn: () => shareApi.getPublicPost(id),
    enabled: !!id,
    // A post that is not publicly shareable answers 404 and will answer 404
    // again. Retrying is three more requests for the same refusal.
    retry: false,
    staleTime: 60_000,
  });

  /**
   * Remember the post so signing in comes back here.
   *
   * Written on mount rather than on click, because the visitor may take any
   * route into the auth screens — the navbar's "Sign in", the footer, the
   * browser's own history — and only one of those is a button this page owns.
   */
  useEffect(() => {
    if (id) setRedirectIntent(`/post/${id}`);
  }, [id]);

  return (
    <div className={styles.page}>
      <LandingNavbar />
      <main className={styles.main}>
        {isPending && <PostSkeleton />}

        {isError && (
          <NotFoundState
            type="post"
            message="This post is not available. It may have been deleted, or it may only be visible to members."
            coverPage={false}
            actionLabel="Back to home"
            onAction={() => {
              window.location.href = '/';
            }}
          />
        )}

        {data?.available && <PublicPost post={data.post} postId={id} />}
      </main>
      <LandingFooter />
    </div>
  );
}

function PublicPost({ post, postId }) {
  const name = post.author.displayName || post.author.username;

  return (
    <article className={styles.card}>
      <header className={styles.identity}>
        {post.author.avatarUrl ? (
          <img
            className={styles.avatar}
            src={getMediaUrl(post.author.avatarUrl)}
            alt=""
            width={52}
            height={52}
            loading="eager"
          />
        ) : (
          <span className={styles.avatarFallback} aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className={styles.identityText}>
          <p className={styles.name}>{name}</p>
          <p className={styles.handle}>
            @{post.author.username}
            {post.communityName ? ` · in ${post.communityName}` : ''}
          </p>
        </div>
      </header>

      {post.text && <p className={styles.body}>{post.text}</p>}

      {/*
        The gallery, in the post's own order, rather than only its first frame.
        Every entry here has already passed the server's visibility gate — see
        SharePreviewService — so there is nothing to filter client side.
      */}
      {post.gallery?.length > 0 && (
        <figure className={styles.figure}>
          <div
            className={styles.gallery}
            data-count={Math.min(post.gallery.length, 3)}
          >
            {post.gallery.map((image) => (
              <img
                key={image.url}
                className={styles.image}
                src={getMediaUrl(image.url)}
                alt=""
                /* Declared so the layout does not jump when a photograph
                   lands. Both are nullable in the database, so the attributes
                   are omitted rather than guessed when they are absent. */
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                loading="eager"
              />
            ))}
          </div>
          {post.imageCount > post.gallery.length && (
            <figcaption className={styles.caption}>
              +{post.imageCount - post.gallery.length} more{' '}
              {post.imageCount - post.gallery.length === 1 ? 'photo' : 'photos'} in
              this post
            </figcaption>
          )}
        </figure>
      )}

      {/*
        A video is named, not played. Serving the file to a signed-out visitor
        would mean streaming media on an unauthenticated route, and there is no
        poster frame to show instead — so this says what is there and the post
        page is where it can be watched.
      */}
      {post.videoCount > 0 && (
        <p className={styles.mediaNote}>
          <PlayGlyph />
          {post.videoCount === 1
            ? 'This post contains a video.'
            : `This post contains ${post.videoCount} videos.`}
        </p>
      )}

      {/*
        The poll's options, exactly as the share card draws them: in ballot
        order, with no counts and no controls. How anyone voted needs an
        account, and is not published on this page at all.
      */}
      {post.isPoll && post.pollOptions?.length > 0 && (
        <ul className={styles.pollOptions}>
          {post.pollOptions.map((option, index) => (
            <li key={`${index}-${option}`} className={styles.pollOption}>
              {option}
            </li>
          ))}
          {post.pollOptionCount > post.pollOptions.length && (
            <li className={styles.pollMore}>
              +{post.pollOptionCount - post.pollOptions.length} more{' '}
              {post.pollOptionCount - post.pollOptions.length === 1
                ? 'option'
                : 'options'}
            </li>
          )}
        </ul>
      )}

      {/*
        A visitor who arrived from a shared link is the person most likely to
        pass it on, and they have no other way to do it here: the in-app share
        dialog needs a session. Same component, same destinations, same copy as
        every dialog inside the app.
      */}
      <div className={styles.share}>
        <ShareTargets payload={buildPostShare(post, post.author)} />
      </div>

      <footer className={styles.cta}>
        <p className={styles.ctaText}>
          {post.isPoll
            ? 'Sign in to vote and see the results.'
            : 'Sign in to reply, react and see the rest of the conversation.'}
        </p>
        <div className={styles.ctaActions}>
          {/* The redirect intent is already stored (see the effect above), so
              both of these return the visitor to this post once they are in. */}
          <Link className={styles.primary} to="/signup">
            Join Meetifyy
          </Link>
          <Link className={styles.secondary} to="/login" state={{ from: `/post/${postId}` }}>
            Sign in
          </Link>
        </div>
      </footer>
    </article>
  );
}

/**
 * A play mark, drawn rather than pulled from the icon set.
 *
 * The icon module is a large lazy chunk and this page is the FIRST thing a
 * visitor from a shared link ever loads; one 16px triangle is not worth pulling
 * it in ahead of the landing chrome.
 */
function PlayGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5 L13 8 L4 13.5 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Mirrors the finished card's structure rather than being a generic spinner, so
 * the page does not reflow when the content arrives.
 */
function PostSkeleton() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={styles.identity}>
        <span className={`${styles.avatarFallback} ${styles.skeleton}`} />
        <div className={styles.identityText}>
          <span className={`${styles.skeleton} ${styles.skeletonLine}`} />
          <span className={`${styles.skeleton} ${styles.skeletonLineShort}`} />
        </div>
      </div>
      <span className={`${styles.skeleton} ${styles.skeletonBlock}`} />
    </div>
  );
}
