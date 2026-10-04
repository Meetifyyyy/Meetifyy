import { memo, useCallback } from 'react';
import { useWindowVirtualizer, observeWindowRect } from '@tanstack/react-virtual';
import { IS_MOBILE_BUILD } from '@config';
import Post from './post/Post';

/**
 * The window height the virtualizer measures, kept steady while a keyboard is up.
 *
 * It watches the window and, on Android, the keyboard shrinks the WebView by
 * ~330px. The shorter window changed which rows count as visible, so a row
 * unmounted as the keyboard opened and remounted when it closed (a flicker, and
 * a flushSync render mid-animation). The keyboard covers the bottom of the
 * screen; it does not make fewer rows relevant, so while text entry is active
 * (`data-text-entry`, see useKeyboardInset) the last height without a keyboard
 * is reported instead.
 */
function observeStableWindowRect(instance, cb) {
  let steady = 0;
  return observeWindowRect(instance, (rect) => {
    const typing = document.documentElement.hasAttribute('data-text-entry');
    if (!typing || !steady) steady = rect.height;
    cb(typing ? { width: rect.width, height: Math.max(steady, rect.height) } : rect);
  });
}

function VirtualFeedList({ posts, onPostClick, onCommentClick }) {
  // Stable across re-renders (as long as `onPostClick` itself is stable) so
  // <Post> — wrapped in React.memo — can actually bail out on unrelated
  // re-renders instead of every visible row re-rendering because it received
  // a brand-new inline closure every time this list re-renders (e.g. on every
  // scroll-driven virtualizer update).
  const handlePostClick = useCallback((post) => {
    if (onPostClick) onPostClick(post, 'feed');
  }, [onPostClick]);

  const handleCommentClick = useCallback((post) => {
    if (onCommentClick) {
      onCommentClick(post, 'feed');
    } else if (onPostClick) {
      onPostClick(post, 'feed', null, { focusComment: true });
    }
  }, [onCommentClick, onPostClick]);

  const getItemKey = useCallback((index) => {
    return posts[index]?.id ?? index;
  }, [posts]);

  const virtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: (index) => {
      const p = posts[index];
      if (!p) return 254;
      let height = 184; // base header + actions + padding + 4px gap
      if (Array.isArray(p.media) && p.media.length > 0) {
        if (p.media.length === 1) {
          const m = p.media[0];
          const rawAspect = Number(m?.aspectRatio) || (m?.width && m?.height ? m.width / m.height : (m?.type === 'video' || m?.isVideo ? 16 / 9 : 1.25));
          // Container is ~600px on desktop and the phone's width in the app.
          const width = Math.min(600, (typeof window !== 'undefined' ? window.innerWidth : 600) - 24);
          const naturalHeight = width / (rawAspect || 1.25);
          const clampedHeight = Math.max(120, Math.min(550, naturalHeight));
          height += Math.round(clampedHeight);
        } else {
          height += 280;
        }
      }
      if (p.pollOptions?.length > 0 || p.poll?.options?.length > 0) height += 160;
      if (p.text && p.text.length > 200) height += 60;
      return height;
    },
    overscan: 5,
    // App only (data-text-entry exists only there); the website is unchanged.
    ...(IS_MOBILE_BUILD
      ? {
          observeElementRect: observeStableWindowRect,
          // Rows mount and unmount while the user scrolls; flushing each render
          // synchronously made every mount a layout inside the scroll frame.
          useFlushSync: false,
        }
      : {}),
    getItemKey,
    // In a social feed, user-initiated expansion ("See more" / "See less") must expand/collapse
    // in place without moving the viewport. Allow TanStack Virtual's normal adjustment ONLY
    // for the first measurement of items strictly above the viewport (e.g. during scroll restoration
    // on load/reload) so that above-viewport items don't shift the viewport.
    shouldAdjustScrollPositionOnItemSizeChange: (item, delta, instance) => {
      if (!instance.itemSizeCache.has(item.key)) {
        return item.start < instance.getScrollOffset() + instance.scrollAdjustments;
      }
      return false;
    },
    scrollToFn: (offset, options, instance) => {
      // `adjustments && adjustments === 0` could never be true — 0 is falsy, so
      // the first operand rejected the only value the second accepts, and the
      // guard was dead. Testing for 0 alone makes it do what it says.
      //
      // Safe to make live: TanStack passes `adjustments` only when correcting
      // for a measured size change, and in that path `offset` is the CURRENT
      // scroll offset, so scrolling to `offset + 0` moves nothing. The call
      // being skipped is a scroll to where the viewport already is. A
      // user-initiated scrollToIndex/scrollToOffset passes no `adjustments` at
      // all and is unaffected.
      if (options?.adjustments === 0) return;
      instance.scrollElement?.scrollTo({
        top: offset + (options?.adjustments ?? 0),
        left: 0,
        behavior: options?.behavior,
      });
    },
  });

  // Ensure shouldAdjustScrollPositionOnItemSizeChange is also set on the instance directly
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
    if (!instance.itemSizeCache.has(item.key)) {
      return item.start < instance.getScrollOffset() + instance.scrollAdjustments;
    }
    return false;
  };

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
        overflowAnchor: 'none',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const p = posts[virtualItem.index];
        if (!p) return null;

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
              paddingBottom: '4px',
            }}
          >
            <Post postData={p} onClick={handlePostClick} onCommentClick={handleCommentClick} />
          </div>
        );
      })}
    </div>
  );
}

export default memo(VirtualFeedList);
