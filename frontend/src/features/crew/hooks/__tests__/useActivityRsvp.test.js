import { describe, expect, it } from 'vitest';
import { patchRsvp, rsvpFromActivity } from '../useActivityRsvp';

const me = { id: 'me', username: 'me', displayName: 'Me' };
const base = (over = {}) => ({
  id: 'a1',
  creatorId: 'host',
  members: [{ userId: 'host', status: 'MEMBER', user: { id: 'host' } }],
  notGoing: [],
  memberCount: 1,
  notGoingCount: 0,
  isJoined: false,
  isNotGoing: false,
  myStatus: null,
  ...over,
});

describe('rsvpFromActivity', () => {
  it('reads going, not going and no answer', () => {
    expect(rsvpFromActivity(base({ isJoined: true, myStatus: 'MEMBER' }))).toBe('in');
    expect(rsvpFromActivity(base({ isNotGoing: true, myStatus: 'DECLINED' }))).toBe('out');
    expect(rsvpFromActivity(base())).toBeNull();
    expect(rsvpFromActivity(undefined)).toBeNull();
  });

  it('understands a server that only sends myStatus', () => {
    const { isNotGoing: _omit, ...older } = base({ myStatus: 'DECLINED' });
    expect(rsvpFromActivity(older)).toBe('out');
  });
});

describe('patchRsvp', () => {
  it("I'm in from no answer: joins the going list and the count", () => {
    const next = patchRsvp(base(), 'in', me);
    expect(next.isJoined).toBe(true);
    expect(next.myStatus).toBe('MEMBER');
    expect(next.memberCount).toBe(2);
    expect(next.members.map((m) => m.userId)).toEqual(['host', 'me']);
    expect(next.notGoingCount).toBe(0);
  });

  it("I'm out from going: moves across, both counts follow", () => {
    const going = patchRsvp(base(), 'in', me);
    const out = patchRsvp(going, 'out', me);
    expect(out.isJoined).toBe(false);
    expect(out.isNotGoing).toBe(true);
    expect(out.myStatus).toBe('DECLINED');
    expect(out.memberCount).toBe(1);
    expect(out.members.map((m) => m.userId)).toEqual(['host']);
    expect(out.notGoing.map((m) => m.userId)).toEqual(['me']);
    expect(out.notGoingCount).toBe(1);
  });

  it("I'm in after I'm out: leaves the not-going list", () => {
    const out = patchRsvp(base(), 'out', me);
    const back = patchRsvp(out, 'in', me);
    expect(back.notGoing).toEqual([]);
    expect(back.notGoingCount).toBe(0);
    expect(back.memberCount).toBe(2);
  });

  it('changes nothing when the answer is already the one given', () => {
    const out = patchRsvp(base(), 'out', me);
    expect(patchRsvp(out, 'out', me)).toBe(out);
  });
});
