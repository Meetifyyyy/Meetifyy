import { describe, expect, it } from 'vitest';
import { authorKey, closesUpFlags, continuesRun, opensWithLabel } from '../messageRuns';

/**
 * A "run" is consecutive messages from the same author. Within one the thread
 * closes the gap up; where the author changes it keeps the full gap. The answer
 * must depend only on who sent the rows - never on what they contain.
 */
const me = { id: 'u-me' };
const mine = (over = {}) => ({ id: 'm', senderId: 'u-me', from: 'me', text: 'hi', ...over });
const theirs = (senderId = 'u-a', over = {}) => ({ id: 't', senderId, text: 'hey', ...over });
const system = (over = {}) => ({ id: 's', type: 'SYSTEM', isSystem: true, text: 'Aarav joined', ...over });

describe('continuesRun in a direct chat', () => {
  it('joins two messages from the same side, whichever side it is', () => {
    expect(continuesRun(mine(), mine(), me, false)).toBe(true);
    expect(continuesRun(theirs(), theirs(), me, false)).toBe(true);
  });

  it('starts a new run when the side changes, in either direction', () => {
    expect(continuesRun(mine(), theirs(), me, false)).toBe(false);
    expect(continuesRun(theirs(), mine(), me, false)).toBe(false);
  });

  it('treats everything not yours as the one other person, whatever ids it carries', () => {
    expect(continuesRun(theirs('u-a'), theirs(undefined), me, false)).toBe(true);
    expect(continuesRun(theirs('u-a'), theirs('u-other'), me, false)).toBe(true);
  });

  it('does not depend on what the message contains', () => {
    const kinds = [
      {},
      { mediaUrl: 'k/photo.jpg', mediaType: 'image' },
      { mediaUrl: 'k/clip.mp4', mediaType: 'video' },
      { mediaType: 'audio', payload: { mediaType: 'audio' } },
      { payload: { post: { id: 'p1' } } },
      { payload: { profile: { id: 'u1' } } },
      { payload: { community: { id: 'c1' } } },
      { payload: { activity: { id: 'a1' } } },
      { inviteData: { type: 'groupInvite' } },
      { replyTo: { id: 'x', text: 'quoted' } },
      { state: 'UNSENT' },
    ];
    for (const a of kinds) {
      for (const b of kinds) {
        expect(continuesRun(mine(a), mine(b), me, false)).toBe(true);
        expect(continuesRun(mine(a), theirs('u-a', b), me, false)).toBe(false);
      }
    }
  });
});

describe('continuesRun in a group', () => {
  it('joins two messages from the same member', () => {
    expect(continuesRun(theirs('u-a'), theirs('u-a'), me, true)).toBe(true);
    expect(continuesRun(mine(), mine(), me, true)).toBe(true);
  });

  it('starts a new run when one member follows another, though both are on the left', () => {
    expect(continuesRun(theirs('u-a'), theirs('u-b'), me, true)).toBe(false);
  });

  it('reads the author from whichever field the message carries it in', () => {
    expect(continuesRun({ sender: { id: 'u-a' } }, { userId: 'u-a' }, me, true)).toBe(true);
    expect(continuesRun({ sender: { id: 'u-a' } }, { userId: 'u-b' }, me, true)).toBe(false);
  });

  it('falls back to one anonymous author when a message has no sender at all', () => {
    expect(authorKey({ text: 'x' }, me, true)).toBe('them');
    expect(continuesRun({ text: 'x' }, { text: 'y' }, me, true)).toBe(true);
  });
});

describe('continuesRun never joins across something that is not a message', () => {
  it('has no run when there is no row above (the first message, or a new day)', () => {
    expect(continuesRun(null, mine(), me, false)).toBe(false);
    expect(continuesRun(undefined, mine(), me, false)).toBe(false);
  });

  it('does not let a system notice take part, above or below', () => {
    expect(continuesRun(system(), mine(), me, false)).toBe(false);
    expect(continuesRun(mine(), system(), me, false)).toBe(false);
    expect(continuesRun(system(), system(), me, false)).toBe(false);
    expect(continuesRun(system({ type: 'system', isSystem: undefined }), mine(), me, true)).toBe(false);
  });
});

describe('opensWithLabel', () => {
  it('is true for a group member\'s row, which opens with their name', () => {
    expect(opensWithLabel(theirs(), me, true, false)).toBe(true);
  });

  it('is false for your own row in a group, and for anyone in a direct chat', () => {
    expect(opensWithLabel(mine(), me, true, false)).toBe(false);
    expect(opensWithLabel(theirs(), me, false, false)).toBe(false);
  });

  it('is true for a reply to a post, which opens with "You replied to ..."', () => {
    expect(opensWithLabel(mine(), me, false, true)).toBe(true);
  });
});

describe('closesUpFlags', () => {
  const msg = (m) => ({ type: 'message', msg: m });
  const divider = { type: 'date_separator' };
  const flags = (items, over = {}) =>
    closesUpFlags(items, { currentUser: me, isGroup: false, ...over }).map((f) => (f ? 'U' : '-'));

  it('a run of three: the first starts it, the rest close up against the row above', () => {
    expect(flags([msg(mine()), msg(mine()), msg(mine())])).toEqual(['-', 'U', 'U']);
  });

  it('a lone message does not close up', () => {
    expect(flags([msg(mine())])).toEqual(['-']);
  });

  it('the side changing starts a new run, in either direction', () => {
    expect(flags([msg(mine()), msg(mine()), msg(theirs()), msg(theirs()), msg(mine())])).toEqual(['-', 'U', '-', 'U', '-']);
  });

  it('a date separator breaks a run, though the author is the same either side of it', () => {
    expect(flags([msg(mine()), divider, msg(mine())])).toEqual(['-', '-', '-']);
  });

  it('a system notice breaks a run and is never part of one', () => {
    expect(flags([msg(mine()), msg(system()), msg(mine())])).toEqual(['-', '-', '-']);
  });

  it('a group member\'s rows each stand alone, since each opens with their name', () => {
    expect(flags([msg(theirs('u-a')), msg(theirs('u-a'))], { isGroup: true })).toEqual(['-', '-']);
    // ...but your own rows in the same group still close up.
    expect(flags([msg(mine()), msg(mine())], { isGroup: true })).toEqual(['-', 'U']);
  });

  it('a reply to a post stands apart from the message above it', () => {
    const post = { replyTo: { shareType: 'post', post: { id: 'p' } } };
    const isPostReply = (r) => Boolean(r && r.shareType === 'post');
    expect(flags([msg(mine()), msg(mine(post))], { isPostReply })).toEqual(['-', '-']);
    // A reply to a plain message closes up like any other row.
    const plain = { replyTo: { id: 'x', text: 'quoted' } };
    expect(flags([msg(mine()), msg(mine(plain))], { isPostReply })).toEqual(['-', 'U']);
  });

  it('does not depend on what the rows contain', () => {
    const photo = { mediaUrl: 'k/p.jpg', mediaType: 'image' };
    const card = { payload: { community: { id: 'c1' } } };
    expect(flags([msg(mine(photo)), msg(mine(card)), msg(mine())])).toEqual(['-', 'U', 'U']);
  });
});
