import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetIsland,
  islandDismiss,
  islandDismissForPath,
  islandDismissNow,
  islandFinish,
  islandHold,
  islandMarkShown,
  islandNotify,
  islandPause,
  islandQueuedCount,
  islandRelease,
  islandResume,
  islandSnapshot,
  islandSubscribe,
  MAX_QUEUED,
  MAX_VISIBLE,
} from '../islandStore';

const content = (title, body = 'hi') => ({ variant: 'person', title, body });
const titles = () => islandSnapshot().items.map((i) => i.content.title);

describe('notification island', () => {
  beforeEach(() => { vi.useFakeTimers(); __resetIsland(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stacks simultaneous notifications newest first', () => {
    islandNotify({ content: content('A') });
    islandNotify({ content: content('B') });
    expect(titles()).toEqual(['B', 'A']);
  });

  it('beyond three, the rest wait their turn instead of pushing rows out', () => {
    ['A', 'B', 'C', 'D', 'E'].forEach((t) => islandNotify({ content: content(t) }));
    expect(MAX_VISIBLE).toBe(3);
    expect(titles()).toEqual(['C', 'B', 'A']);
    expect(islandQueuedCount()).toBe(2);
  });

  it('a row leaving lets the oldest waiting one in at the top, in arrival order', () => {
    islandMarkShown();
    ['A', 'B', 'C', 'D', 'E'].forEach((t) => islandNotify({ content: content(t) }));
    vi.advanceTimersByTime(3500); // A, B and C share a clock and leave together
    expect(titles()).toEqual(['E', 'D']);
    expect(islandQueuedCount()).toBe(0);
    vi.advanceTimersByTime(3500);
    expect(islandSnapshot().closing).toBe(true);
    expect(titles()).toEqual(['E']);
  });

  it('ten at once: every one is shown, three at a time, none twice and none lost', () => {
    islandMarkShown();
    const seen = new Set();
    const order = [];
    islandSubscribe(() => islandSnapshot().items.forEach((i) => {
      if (!seen.has(i.content.title)) { seen.add(i.content.title); order.push(i.content.title); }
    }));
    const all = Array.from({ length: 10 }, (_, n) => `N${n}`);
    all.forEach((t) => islandNotify({ content: content(t) }));
    for (let t = 0; t < 40 && !islandSnapshot().closing; t += 1) {
      expect(islandSnapshot().items.length).toBeLessThanOrEqual(MAX_VISIBLE);
      const keys = islandSnapshot().items.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
      vi.advanceTimersByTime(500);
    }
    expect(order).toEqual(all);
    expect(islandSnapshot().closing).toBe(true);
  });

  it('a flood keeps only the newest waiting ones', () => {
    Array.from({ length: MAX_VISIBLE + MAX_QUEUED + 5 }, (_, n) => islandNotify({ content: content(`N${n}`) }));
    expect(islandQueuedCount()).toBe(MAX_QUEUED);
    expect(titles()).toEqual(['N2', 'N1', 'N0']);
  });

  it('the last row expiring with others waiting is replaced, not collapsed', () => {
    islandMarkShown();
    islandNotify({ content: content('A') });
    vi.advanceTimersByTime(1000);
    islandHold('press'); // nothing promoted while held...
    islandNotify({ content: content('B') });
    expect(titles()).toEqual(['A']);
    islandRelease('press'); // ...and it enters once released
    expect(titles()).toEqual(['B', 'A']);
    vi.advanceTimersByTime(2500);
    expect(titles()).toEqual(['B']);
    islandHold('split');
    ['C', 'D', 'E'].forEach((t) => islandNotify({ content: content(t) }));
    expect(titles()).toEqual(['B']);
    vi.advanceTimersByTime(1000);
    // B's time ran out while held: an empty island is never held back.
    expect(islandSnapshot().closing).toBe(false);
    expect(titles()).toEqual(['C']);
    islandRelease('split');
    expect(titles()).toEqual(['E', 'D', 'C']);
  });

  it('a new message for a waiting chat merges into its queued item', () => {
    ['A', 'B', 'C'].forEach((t) => islandNotify({ content: content(t) }));
    islandNotify({ groupKey: 'c1', content: content('Asha', 'one') });
    islandNotify({ groupKey: 'c1', content: content('Asha', 'two') });
    expect(islandQueuedCount()).toBe(1);
    islandDismissNow(islandSnapshot().items[2].key);
    const row = islandSnapshot().items[0];
    expect(row.content.body).toBe('two');
    expect(row.count).toBe(2);
  });

  it('dismissing a chat clears its waiting items too', () => {
    ['A', 'B', 'C'].forEach((t) => islandNotify({ content: content(t) }));
    islandNotify({ groupKey: 'c1', relevantPath: '/messages/c1', content: content('Asha') });
    islandDismissForPath('/messages/c1');
    expect(islandQueuedCount()).toBe(0);
    islandNotify({ groupKey: 'c2', content: content('Ravi') });
    islandDismiss('c2');
    expect(islandQueuedCount()).toBe(0);
  });

  it('swiping a row away promotes the next one; swiping the last empties the island', () => {
    ['A', 'B', 'C', 'D'].forEach((t) => islandNotify({ content: content(t) }));
    islandDismissNow(islandSnapshot().items[1].key); // B, the middle row
    expect(titles()).toEqual(['D', 'C', 'A']);
  });

  it('a hold leaves updates in place alone', () => {
    islandNotify({ groupKey: 'c1', content: content('Asha', 'one') });
    islandHold('press');
    islandNotify({ groupKey: 'c1', content: content('Asha', 'two') });
    expect(islandSnapshot().items[0].content.body).toBe('two');
    islandRelease('press');
  });

  it('clocks start only once the island has expanded', () => {
    islandNotify({ content: content('A') });
    vi.advanceTimersByTime(10_000);
    expect(titles()).toEqual(['A']);
    islandMarkShown();
    vi.advanceTimersByTime(3499);
    expect(islandSnapshot().closing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(islandSnapshot().closing).toBe(true);
    // The last row stays so the island can collapse with content in it.
    expect(titles()).toEqual(['A']);
    islandFinish();
    expect(titles()).toEqual([]);
  });

  it('each row leaves on its own clock', () => {
    islandMarkShown();
    islandNotify({ content: content('A'), priority: 'normal' });
    vi.advanceTimersByTime(2000);
    islandNotify({ content: content('B'), priority: 'message' });
    vi.advanceTimersByTime(1500);
    expect(titles()).toEqual(['B']);
    vi.advanceTimersByTime(3000);
    expect(islandSnapshot().closing).toBe(true);
  });

  it('a new message from a visible chat updates its row and restarts its time', () => {
    islandMarkShown();
    islandNotify({ groupKey: 'c1', priority: 'message', content: content('Asha', 'one') });
    islandNotify({ content: content('Other'), priority: 'important' });
    vi.advanceTimersByTime(4000);
    islandNotify({ groupKey: 'c1', priority: 'message', content: content('Asha', 'two') });
    const row = islandSnapshot().items.find((i) => i.groupKey === 'c1');
    expect(row.count).toBe(2);
    expect(row.content.body).toBe('two');
    expect(islandSnapshot().items).toHaveLength(2);
    vi.advanceTimersByTime(4000);
    expect(titles()).toContain('Asha');
  });

  it('a notification arriving while the island closes reopens it with the new one', () => {
    islandMarkShown();
    islandNotify({ content: content('A') });
    vi.advanceTimersByTime(3500);
    expect(islandSnapshot().closing).toBe(true);
    islandNotify({ content: content('B') });
    expect(islandSnapshot().closing).toBe(false);
    expect(titles()).toEqual(['B']);
  });

  it('ignores the same event delivered twice', () => {
    islandNotify({ id: 'm1', content: content('A') });
    islandNotify({ id: 'm1', content: content('A') });
    expect(titles()).toEqual(['A']);
  });

  it('pauses while pressed or hovered and never closes under the finger', () => {
    islandMarkShown();
    islandNotify({ content: content('A') });
    vi.advanceTimersByTime(3000);
    islandPause('press');
    vi.advanceTimersByTime(20_000);
    expect(islandSnapshot().closing).toBe(false);
    islandResume('press');
    vi.advanceTimersByTime(1199);
    expect(islandSnapshot().closing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(islandSnapshot().closing).toBe(true);
  });

  it('a background pause outlives the island it started on', () => {
    islandMarkShown();
    islandNotify({ content: content('A') });
    islandPause('hidden');
    islandDismiss(islandSnapshot().items[0].key);
    islandFinish();
    islandNotify({ content: content('B') });
    islandMarkShown();
    vi.advanceTimersByTime(20_000);
    expect(islandSnapshot().closing).toBe(false);
    islandResume('hidden');
    vi.advanceTimersByTime(3500);
    expect(islandSnapshot().closing).toBe(true);
  });

  it('sticky rows stay until dismissed', () => {
    islandMarkShown();
    islandNotify({ sticky: true, groupKey: 'call', content: content('Call') });
    vi.advanceTimersByTime(60_000);
    expect(islandSnapshot().closing).toBe(false);
    islandDismiss('call');
    expect(islandSnapshot().closing).toBe(true);
  });

  it('a swipe removes the row at once', () => {
    islandNotify({ content: content('A') });
    islandNotify({ content: content('B') });
    islandDismissNow(islandSnapshot().items[0].key);
    expect(titles()).toEqual(['A']);
    islandDismissNow(islandSnapshot().items[0].key);
    expect(titles()).toEqual([]);
    expect(islandSnapshot().closing).toBe(false);
  });

  it('opening the chat removes its rows', () => {
    islandNotify({ relevantPath: '/messages/c1', content: content('A') });
    islandNotify({ relevantPath: '/messages/c2', content: content('B') });
    islandDismissForPath('/messages/c1');
    expect(titles()).toEqual(['B']);
  });
});
