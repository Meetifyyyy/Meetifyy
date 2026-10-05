import { describe, expect, it, vi } from 'vitest';
import { feedVideoRegistry } from '../feedVideoRegistry';
import { PLAYBACK_PRIORITY } from '../playbackPriority';

/** Just enough of a media element: the registry needs only `paused` and `pause()`. */
function fakeEl({ playing = false } = {}) {
  const el = {
    paused: !playing,
    pause: vi.fn(() => { el.paused = true; }),
  };
  return el;
}

let n = 0;
const id = () => `reg-${++n}`;

describe('feedVideoRegistry priority', () => {
  it('pauses a lower-priority source when a higher one asks to play', () => {
    const feed = fakeEl({ playing: true });
    const viewer = fakeEl();
    const feedId = id();
    const viewerId = id();
    const off = [
      feedVideoRegistry.register(feedId, feed, PLAYBACK_PRIORITY.FEED),
      feedVideoRegistry.register(viewerId, viewer, PLAYBACK_PRIORITY.VIEWER),
    ];
    feedVideoRegistry.requestPlay(feedId);

    expect(feedVideoRegistry.requestPlay(viewerId)).toBe(true);
    expect(feed.pause).toHaveBeenCalledOnce();
    expect(feedVideoRegistry.activeId).toBe(viewerId);
    off.forEach((f) => f());
  });

  it('refuses a lower-priority request and leaves the higher-priority source playing', () => {
    const viewer = fakeEl({ playing: true });
    const feed = fakeEl();
    const viewerId = id();
    const feedId = id();
    const off = [
      feedVideoRegistry.register(viewerId, viewer, PLAYBACK_PRIORITY.VIEWER),
      feedVideoRegistry.register(feedId, feed, PLAYBACK_PRIORITY.FEED),
    ];
    feedVideoRegistry.requestPlay(viewerId);

    expect(feedVideoRegistry.requestPlay(feedId)).toBe(false);
    expect(viewer.pause).not.toHaveBeenCalled();
    expect(feedVideoRegistry.activeId).toBe(viewerId);
    off.forEach((f) => f());
  });

  it('pauses a refused requester that was already playing, so two sources are never audible', () => {
    const viewer = fakeEl({ playing: true });
    const feed = fakeEl({ playing: true });
    const viewerId = id();
    const feedId = id();
    const off = [
      feedVideoRegistry.register(viewerId, viewer, PLAYBACK_PRIORITY.VIEWER),
      feedVideoRegistry.register(feedId, feed, PLAYBACK_PRIORITY.FEED),
    ];
    feedVideoRegistry.requestPlay(viewerId);

    feedVideoRegistry.requestPlay(feedId);
    expect(feed.pause).toHaveBeenCalledOnce();
    off.forEach((f) => f());
  });

  it('lets equal priorities take turns, and a voice note outrank the feed but not the viewer', () => {
    const a = fakeEl({ playing: true });
    const b = fakeEl();
    const aId = id();
    const bId = id();
    const off = [
      feedVideoRegistry.register(aId, a, PLAYBACK_PRIORITY.VOICE),
      feedVideoRegistry.register(bId, b, PLAYBACK_PRIORITY.VOICE),
    ];
    feedVideoRegistry.requestPlay(aId);
    expect(feedVideoRegistry.requestPlay(bId)).toBe(true);
    expect(a.pause).toHaveBeenCalledOnce();
    off.forEach((f) => f());
  });

  it('is not blocked by an "active" source that has already stopped on its own', () => {
    const viewer = fakeEl({ playing: true });
    const feed = fakeEl();
    const viewerId = id();
    const feedId = id();
    const off = [
      feedVideoRegistry.register(viewerId, viewer, PLAYBACK_PRIORITY.VIEWER),
      feedVideoRegistry.register(feedId, feed, PLAYBACK_PRIORITY.FEED),
    ];
    feedVideoRegistry.requestPlay(viewerId);
    viewer.paused = true; // stopped without notifyPause

    expect(feedVideoRegistry.requestPlay(feedId)).toBe(true);
    off.forEach((f) => f());
  });
});
