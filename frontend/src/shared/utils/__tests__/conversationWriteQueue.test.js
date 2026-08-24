import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleConversationWrite, __resetConversationWriteQueue } from '../conversationWriteQueue';

/**
 * Mute and pin are toggles. A double-tap used to fire two requests whose
 * arrival order — not the tap order — decided the stored value, leaving the
 * server disagreeing with the UI the user was looking at.
 */
describe('scheduleConversationWrite', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    __resetConversationWriteQueue();
    vi.useRealTimers();
  });

  it('sends only the last write for a key', () => {
    const run = vi.fn();
    scheduleConversationWrite('mute:c1', run);
    scheduleConversationWrite('mute:c1', run);
    scheduleConversationWrite('mute:c1', run);

    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reads the settled state at send time, not at tap time', () => {
    let state = false;
    const sent = [];
    const tap = () => {
      state = !state;
      scheduleConversationWrite('mute:c1', () => sent.push(state));
    };

    tap(); // muted
    tap(); // unmuted again — the state the user finished on
    vi.advanceTimersByTime(1000);

    expect(sent).toEqual([false]);
  });

  it('keeps different conversations and different actions independent', () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleConversationWrite('mute:c1', a);
    scheduleConversationWrite('pin:c1', b);
    scheduleConversationWrite('mute:c2', a);

    vi.advanceTimersByTime(1000);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not let a throwing write reject unhandled', async () => {
    scheduleConversationWrite('mute:c1', () => { throw new Error('boom'); });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });
});
