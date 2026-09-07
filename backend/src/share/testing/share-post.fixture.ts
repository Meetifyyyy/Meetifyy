import type {
  PublicSharePost,
  ShareImage,
  ShareVideo,
} from '../share-preview.service';

/**
 * One builder for the projection every share surface reads.
 *
 * Four spec files were each keeping their own copy of this object, so adding a
 * field to `PublicSharePost` meant editing four fixtures that were already
 * drifting apart in ways that made the tests quietly less alike. This is the
 * only place a default belongs.
 *
 * Deliberately a plain function rather than a factory class: a spec should be
 * able to say `post({ isPoll: true })` and read as a sentence.
 */
export function sharePost(
  over: Partial<PublicSharePost> = {},
): PublicSharePost {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    text: 'Badminton at six on the north court.',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    authorUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    author: {
      username: 'alex',
      displayName: 'Alex Kuriakose',
      avatarUrl: null,
    },
    communityName: null,
    image: null,
    gallery: [],
    video: null,
    mediaKind: 'none',
    imageCount: 0,
    videoCount: 0,
    isPoll: false,
    pollOptions: [],
    pollOptionCount: 0,
    ...over,
  };
}

/** An image asset, with the two URLs the renderer tries in order. */
export function shareImage(index = 0): ShareImage {
  return {
    url: `https://cdn.example/posts/photo-${index}.webp`,
    fallbackUrl: `https://cdn.example/posts/photo-${index}_thumb.webp`,
    width: 1200,
    height: 900,
  };
}

/** A video asset. `posterUrl` is a guess that is allowed to 404 — see buildGallery. */
export function shareVideo(): ShareVideo {
  return {
    url: 'https://cdn.example/posts/clip.mp4',
    mimeType: 'video/mp4',
    width: 1280,
    height: 720,
    posterUrl: 'https://cdn.example/posts/clip_thumb.webp',
  };
}

/**
 * A post carrying `count` images, with the counts and kind kept consistent.
 *
 * Hand-assembling those three fields is how a fixture ends up describing a post
 * that could not exist — two images with `imageCount: 0`, say — and a test
 * built on one proves nothing about the real thing.
 */
export function postWithImages(
  count: number,
  over: Partial<PublicSharePost> = {},
): PublicSharePost {
  const gallery = Array.from({ length: Math.min(count, 3) }, (_, i) =>
    shareImage(i),
  );
  return sharePost({
    gallery,
    image: gallery[0] ?? null,
    mediaKind: count > 0 ? 'image' : 'none',
    imageCount: count,
    ...over,
  });
}

/** A post carrying `count` videos and no images. */
export function postWithVideos(
  count: number,
  over: Partial<PublicSharePost> = {},
): PublicSharePost {
  return sharePost({
    video: count > 0 ? shareVideo() : null,
    mediaKind: count > 0 ? 'video' : 'none',
    videoCount: count,
    ...over,
  });
}

/** A poll, with the question in `text` exactly as the database stores it. */
export function pollPost(
  options: string[],
  over: Partial<PublicSharePost> = {},
): PublicSharePost {
  return sharePost({
    text: 'Where are we hanging out after exams end?',
    isPoll: true,
    pollOptions: options.slice(0, 4),
    pollOptionCount: options.length,
    ...over,
  });
}
