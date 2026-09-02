/** Deterministic fixtures shaped like real API payloads. */
export function makePost(i) {
  return {
    id: `post-${i}`,
    authorId: `user-${i % 7}`,
    author: {
      id: `user-${i % 7}`,
      displayName: `Member ${i % 7}`,
      username: `member${i % 7}`,
      avatar: null,
      collegeId: 'col-1',
      isCampusRep: false,
    },
    text: `Post body number ${i}. ${'lorem ipsum dolor sit amet '.repeat(i % 3 === 0 ? 12 : 2)}`,
    createdAt: new Date(Date.now() - i * 60000).toISOString(),
    media: i % 4 === 0
      ? [{ url: `/api/media/img-${i}`, type: 'image', width: 1200, height: 800, aspectRatio: 1.5 }]
      : [],
    poll: i % 5 === 0
      ? { options: [{ id: `o1-${i}`, text: 'Option A', votes: 3 }, { id: `o2-${i}`, text: 'Option B', votes: 5 }], totalVotes: 8, multiSelect: false }
      : null,
    likeCount: i, likesCount: i,
    commentCount: i % 6, commentsCount: i % 6,
    hasLiked: false, isLiked: false, isLikedByMe: false,
    hasBookmarked: false, isBookmarked: false,
    communityId: 'com-1',
    community: { id: 'com-1', name: 'Campus', avatar: null, color: '#333' },
    canDelete: false,
  };
}

export function makeFeedPage(pageIndex, size = 20) {
  const posts = Array.from({ length: size }, (_, k) => makePost(pageIndex * size + k));
  return { posts, nextCursor: pageIndex < 2 ? `cursor-${pageIndex + 1}` : null };
}

/** A flat comment list, as the API returns it: roots plus nested replies. */
export function makeComments(rootCount, repliesPer) {
  const out = [];
  for (let r = 0; r < rootCount; r++) {
    const rootId = `c-${r}`;
    out.push(comment(rootId, null, r));
    for (let k = 0; k < repliesPer; k++) {
      const childId = `c-${r}-${k}`;
      out.push(comment(childId, rootId, k));
      if (k === 0) out.push(comment(`c-${r}-${k}-0`, childId, 0));
    }
  }
  return out;
}

function comment(id, parentId, i) {
  return {
    id, parentId,
    authorId: `user-${i % 5}`,
    author: { id: `user-${i % 5}`, displayName: `Member ${i % 5}`, username: `member${i % 5}`, avatar: null, collegeId: 'col-1' },
    text: `Comment ${id} text content here.`,
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
    likeCount: i % 4, hasLiked: false,
    isDeleted: false, canDelete: false,
  };
}

export const CURRENT_USER = {
  id: 'me', username: 'me', displayName: 'Me', avatar: null,
  collegeId: 'col-1', verificationStatus: 'VERIFIED',
};

export const COMMUNITIES = [{ id: 'com-1', name: 'Campus', avatar: null, color: '#333' }, { id: 'col-1', name: 'College', avatar: null }];
