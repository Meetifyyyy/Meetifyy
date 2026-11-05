import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetIsland,
  islandDismiss,
  islandDismissForPath,
  islandDismissNow,
  islandFinish,
  islandMarkShown,
  islandNotify,
  islandPause,
  islandResume,
  islandSnapshot,
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

  it('when more keep coming, the oldest leaves at the bottom', () => {
    ['A', 'B', 'C', 'D', 'E'].forEach((t) => islandNotify({ content: content(t) }));
    expect(MAX_VISIBLE).toBe(3);
    expect(titles()).toEqual(['E', 'D', 'C']);
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
