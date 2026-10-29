import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { refreshJoinRequests, applyJoinRequestDecided } from '../conversationLiveState';
import { INVITE_KEYS } from '../../../hooks/useGroupInvite';

/**
 * The two live events about requests to join, and what each refreshes:
 * - `group:join_requests` (owner and admins only): the group's details (its
 *   Requests list) and the timeline's request lines, for that group only;
 * - `group:join_request_decided` (the requester only): every open preview of
 *   the group, whichever invite it was opened through.
 */
const seed = (client, key, data) => {
  client.setQueryData(key, data);
  return () => client.getQueryState(key)?.isInvalidated;
};

describe('join request live state', () => {
  it("a change to a group's requests refreshes its Requests list and request lines, and no other group's", () => {
    const client = new QueryClient();
    const details = seed(client, ['groupDetails', 'pub-1'], { id: 'pub-1' });
    const lines = seed(client, ['groupJoinActivity', 'pub-1'], { items: [] });
    const otherLines = seed(client, ['groupJoinActivity', 'pub-2'], { items: [] });

    refreshJoinRequests(client, { publicId: 'pub-1', internalId: 'g-1' });

    expect(details()).toBe(true);
    expect(lines()).toBe(true);
    expect(otherLines()).toBe(false);
  });

  it("an answer to the viewer's request refreshes every preview of that group", () => {
    const client = new QueryClient();
    const byCard = seed(client, INVITE_KEYS.preview('pub-1', { messageId: 'm1' }), { publicId: 'pub-1', internalId: 'g-1' });
    const byLink = seed(client, INVITE_KEYS.link('Abc123Def456'), { publicId: 'pub-1', internalId: 'g-1' });
    const other = seed(client, INVITE_KEYS.preview('pub-2', null), { publicId: 'pub-2' });

    applyJoinRequestDecided(client, { publicId: 'pub-1', internalId: 'g-1', status: 'APPROVED' });

    expect(byCard()).toBe(true);
    expect(byLink()).toBe(true);
    expect(other()).toBe(false);
  });

  it('an event naming no group changes nothing', () => {
    const client = new QueryClient();
    const lines = seed(client, ['groupJoinActivity', 'pub-1'], { items: [] });
    refreshJoinRequests(client, {});
    applyJoinRequestDecided(client, null);
    expect(lines()).toBe(false);
  });
});
