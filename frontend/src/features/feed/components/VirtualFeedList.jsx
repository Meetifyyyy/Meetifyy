import { useWindowVirtualizer } from '@tanstack/react-virtual';
import Post from './post/Post';

/**
 * VirtualFeedList
 * Renders the post list using window-based virtualization.
 * Only the posts visible in the viewport + overscan buffer exist in the DOM at any time.
 *
 * Uses useWindowVirtualizer (not useVirtualizer) because Meetifyy scrolls
 * the window, not a fixed-height container.
 *
 * measureElement on each row div lets TanStack Virtual auto-correct
 * estimated heights after the first render — prevents scroll jank on
 * posts that have media, polls, or long text vs short text.
 */
export default function VirtualFeedList({ posts, communities, onPostClick }) {
  const virtualizer = useWindowVirtualizer({
    count:        posts.length,
    estimateSize: () => 300,   // conservative — gets auto-corrected by measureElement
    overscan:     5,           // render 5 extra items above/below viewport
  });

  return (
    <div
      style={{
        height:   `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width:    '100%',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const p    = posts[virtualItem.index];
        const cTag = p.communityId ? communities[p.communityId] : null;

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position:  'absolute',
              top:       0,
              left:      0,
              width:     '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <Post
              postData={p}
              communityTag={cTag}
              onClick={() => onPostClick && onPostClick(p, 'feed')}
            />
          </div>
        );
      })}
    </div>
  );
}
