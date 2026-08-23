import { describe, it, expect } from 'vitest';
import { resolveSheetPanel } from '../sheetPanel';

const live = { isActive: true, endReason: null };
const theyLeft = { isActive: false, endReason: 'they_left' };
const youLeft = { isActive: false, endReason: 'you_left' };
const expired = { isActive: false, endReason: 'expired' };
const pairing = { matchId: 'm1', candidate: { id: 'u2' } };

const at = (over) => resolveSheetPanel({ status: 'idle', searching: false, chat: null, recentMatch: null, ...over });

describe('resolveSheetPanel', () => {
  it('shows the form when nothing is going on', () => {
    expect(at({})).toBe('form');
  });

  it('shows the matched panel for a live chat', () => {
    // Tapping the Instant Match icon while matched must land here, not in
    // the conversation and not on a search the server would reject.
    expect(at({ chat: live })).toBe('matched');
    expect(at({ status: 'matched', chat: live })).toBe('matched');
  });

  it('shows the matched panel in the gap before the chat state lands', () => {
    expect(at({ recentMatch: pairing })).toBe('matched');
  });

  describe('once the conversation is over', () => {
    it('shows the ended panel, never the matched one', () => {
      // The regression: an ended chat is still in state, so a presence check
      // rendered the celebration screen over a dead match.
      expect(at({ chat: theyLeft })).toBe('ended');
      expect(at({ chat: expired })).toBe('ended');
      expect(at({ chat: youLeft })).toBe('ended');
    });

    it('still shows ended even while a stale pairing lingers', () => {
      // recentMatch outlives the chat by design — it is a 24h window on the
      // server — so it must not drag the matched panel back up.
      expect(at({ chat: theyLeft, recentMatch: pairing })).toBe('ended');
    });
  });

  it('returns to the form once the leaver has cleared their own state', () => {
    // Leaving clears both, which is what hands them the search flow. Without
    // that, they sat on a panel built from a partner they no longer had.
    expect(at({ chat: null, recentMatch: null })).toBe('form');
  });

  it('never covers the searching screen', () => {
    expect(at({ searching: true, chat: live })).toBe('form');
    expect(at({ status: 'searching', chat: live })).toBe('form');
  });

  it('never covers a live match card awaiting a response', () => {
    expect(at({ status: 'match_found', chat: live })).toBe('form');
    expect(at({ status: 'waiting', recentMatch: pairing })).toBe('form');
  });
});
