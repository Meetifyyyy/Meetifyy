import { useWindowVirtualizer } from '@tanstack/react-virtual';
import Post from './post/Post';

export default function VirtualFeedList({ posts, communities, onPostClick }) {
  const getCommunityTag = (communityId) => {
    if (!communityId) return null;
    if (Array.isArray(communities)) {
      return communities.find(c => c.id === communityId) || null;
    }
    return communities?.[communityId] || null;
  };

  const virtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: (index) => {
      const p = posts[index];
      if (!p) return 250;
      let height = 180; // base header + actions + padding
      if (p.mediaUrls?.length > 0 || p.mediaKey || p.mediaUrl) height += 320;
      if (p.pollOptions?.length > 0) height += 160;
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
        const cTag = getCommunityTag(p.communityId);

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

