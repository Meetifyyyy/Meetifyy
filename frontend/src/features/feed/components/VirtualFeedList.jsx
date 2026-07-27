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
    estimateSize: () => 300,
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

