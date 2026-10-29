import { describe, it, expect } from 'vitest';
import { departureLineFor, messagePreviewText } from '../messagePreview';

/**
 * A group departure line reads "you" for the person it is about: the member
 * an admin removed sees "@admin removed you from the group", the one who left
 * "You left the group". Everyone else, and lines from older servers (no
 * `event`), keep the stored text.
 */
const removal = {
  type: 'system',
  text: '@admin removed @gone from the group',
  payload: {
    text: '@admin removed @gone from the group',
    event: { kind: 'member_removed', actorId: 'admin', actorHandle: '@admin', targetId: 'gone', targetHandle: '@gone' },
  },
};

describe('departure lines', () => {
  it('say "you" to the removed member, in the chat and the list', () => {
    expect(departureLineFor(removal, 'gone')).toBe('@admin removed you from the group');
    expect(messagePreviewText(removal, 'gone')).toBe('@admin removed you from the group');
  });

  it('read as stored for everyone else', () => {
    expect(departureLineFor(removal, 'm1')).toBeNull();
    expect(messagePreviewText(removal, 'm1')).toBe('@admin removed @gone from the group');
    expect(messagePreviewText(removal)).toBe('@admin removed @gone from the group');
  });

  it('say "You left the group" to the one who left', () => {
    const left = { payload: { text: '@m1 left the group', event: { kind: 'member_left', actorId: 'm1', actorHandle: '@m1' } } };
    expect(departureLineFor(left, 'm1')).toBe('You left the group');
  });

  it('leave a line from an older server alone', () => {
    expect(departureLineFor({ text: '@a removed @b from the group' }, 'b')).toBeNull();
  });
});
