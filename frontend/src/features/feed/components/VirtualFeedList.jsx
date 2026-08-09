import { memo, useCallback } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import Post from './post/Post';

function VirtualFeedList({ posts, onPostClick }) {
  // Stable across re-renders (as long as `onPostClick` itself is stable) so
  // <Post> — wrapped in React.memo — can actually bail out on unrelated
  // re-renders instead of every visible row re-rendering because it received
  // a brand-new inline closure every time this list re-renders (e.g. on every
  // scroll-driven virtualizer update).
  const handlePostClick = useCallback((post) => {
    if (onPostClick) onPostClick(post, 'feed');
  }, [onPostClick]);

  const virtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: (index) => {
      const p = posts[index];
      if (!p) return 254;
      let height = 184; // base header + actions + padding + 4px gap
      if (Array.isArray(p.media) && p.media.length > 0) height += 320;
      if (p.pollOptions?.length > 0 || p.poll?.options?.length > 0) height += 160;
      if (p.text && p.text.length > 200) height += 60;
      return height;
    },
    overscan: 5,
  });

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const p = posts[virtualItem.index];

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
            <Post postData={p} onClick={handlePostClick} />
          </div>
        );
      })}
    </div>
  );
}

export default memo(VirtualFeedList);
