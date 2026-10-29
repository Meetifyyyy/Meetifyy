import { stub } from '../common/testing/stub';
import type { DomainEventService } from '../events/domain-event.service';
import type { PushDispatcherService } from '../push/push-dispatcher.service';
import {
  EVERYONE,
  everyoneSpan,
  mentionNotifyIds,
  peopleMentions,
  storedMentions,
} from './core/message-mentions';
import { settingsChangeLines } from './group-settings-announce.util';
import { emitMessageNew, publicMessage } from './message-alert.util';
import {
  announceJoinRequested,
  announceJoined,
  announceRequestApproved,
  announceRequestDeclined,
  GroupAnnouncer,
} from './group-join-announce.util';

/**
 * The rules group chats now run on, each in one place: who a message tags
 * and who hears about it, how a settings change is told to the group, what a
 * recipient may see of a message's delivery, and what joining and requests
 * announce.
 */
const flush = () => new Promise((r) => setImmediate(r));

describe('message mentions', () => {
  const text = 'hi @everyone and @ana';

  it('@everyone counts only where the text says it, as a whole word', () => {
    const tag = { userId: EVERYONE, username: EVERYONE, start: 3, end: 12 };
    expect(everyoneSpan(text, [tag])).toEqual({ start: 3, end: 12 });
    // A span that does not read "@everyone" is ignored.
    expect(everyoneSpan(text, [{ ...tag, start: 4, end: 13 }])).toBeNull();
    expect(
      everyoneSpan('@everyones', [{ ...tag, start: 0, end: 9 }]),
    ).toBeNull();
    expect(
      everyoneSpan('a@everyone', [{ ...tag, start: 1, end: 10 }]),
    ).toBeNull();
    expect(everyoneSpan(text, [])).toBeNull();
  });

  it('the people list never carries the @everyone entry', () => {
    expect(
      peopleMentions([
        { userId: EVERYONE, username: EVERYONE, start: 3, end: 12 },
        { userId: 'u-ana', username: 'ana', start: 17, end: 21 },
      ]),
    ).toEqual([{ userId: 'u-ana', username: 'ana', start: 17, end: 21 }]);
  });

  it('stores the named members and @everyone in text order', () => {
    const named = [{ userId: 'u-ana', username: 'ana', start: 17, end: 21 }];
    expect(
      storedMentions(named, { start: 3, end: 12 }).map((m) => m.userId),
    ).toEqual([EVERYONE, 'u-ana']);
  });

  it('notifies tagged recipients only, and never anyone who muted the group', () => {
    expect(
      mentionNotifyIds({
        named: ['u-ana', 'u-gone', 'u-muted'],
        everyone: false,
        recipientIds: ['u-ana', 'u-muted', 'u-bo'],
        unmutedRecipientIds: ['u-ana', 'u-bo'],
      }),
    ).toEqual(['u-ana']);
  });

  it('@everyone notifies every recipient who has not muted the group', () => {
    expect(
      mentionNotifyIds({
        named: [],
        everyone: true,
        recipientIds: ['u-ana', 'u-muted', 'u-bo'],
        unmutedRecipientIds: ['u-ana', 'u-bo'],
      }),
    ).toEqual(['u-ana', 'u-bo']);
  });
});

describe('settings change lines', () => {
  it('says what changed, in plain words, and nothing for a no-op', () => {
    expect(
      settingsChangeLines(
        '@sam',
        { whoCanJoin: 'ANYONE' },
        { whoCanJoin: 'APPROVAL' },
      ),
    ).toEqual(['@sam turned on approval for new members']);
    expect(
      settingsChangeLines(
        '@sam',
        { whoCanJoin: 'Request required' },
        { whoCanJoin: 'ANYONE' },
      ),
    ).toEqual(['@sam turned off approval for new members']);
    expect(
      settingsChangeLines(
        '@sam',
        { editGroupPermission: 'ADMIN' },
        { editGroupPermission: 'EVERYONE' },
      ),
    ).toEqual(['@sam allowed all members to edit group info']);
    expect(
      settingsChangeLines(
        '@sam',
        { whoCanJoin: 'APPROVAL' },
        { whoCanJoin: 'APPROVAL_REQUIRED' },
      ),
    ).toEqual([]);
  });
});

describe('what a recipient sees of a message', () => {
  const message = {
    id: 'm-1',
    text: 'hi',
    recipientIds: ['a', 'b'],
    unmutedRecipientIds: ['a'],
  };

  it('never the recipient list or who muted the chat', () => {
    expect(publicMessage(message)).toEqual({ id: 'm-1', text: 'hi' });
  });

  it('each copy says whether that recipient may be alerted, and carries no lists', () => {
    const emit = jest.fn(() => Promise.resolve());
    void emitMessageNew(stub<DomainEventService>({ emit }), message, {
      recipientIds: ['a', 'b'],
      unmutedRecipientIds: ['a'],
      senderId: 's',
    });
    expect(emit).toHaveBeenCalledWith(
      'message:new',
      { id: 'm-1', text: 'hi', alert: true },
      ['a'],
    );
    expect(emit).toHaveBeenCalledWith(
      'message:new',
      { id: 'm-1', text: 'hi', alert: false },
      ['b'],
    );
    expect(emit).toHaveBeenCalledWith(
      'message:new',
      { id: 'm-1', text: 'hi', alert: false },
      ['s'],
    );
  });
});

describe('join and request announcements', () => {
  const group = {
    conversationId: 'pub-1',
    publicId: 'pub-1',
    internalId: 'g-1',
  };
  /** What the admin-only and requester-only events carry: never conversationId. */
  const ids = { publicId: 'pub-1', internalId: 'g-1' };
  let emit: jest.Mock;
  let enqueue: jest.Mock;
  let enqueueApproved: jest.Mock;
  let systemLine: jest.Mock;
  let a: GroupAnnouncer;

  beforeEach(() => {
    emit = jest.fn(() => Promise.resolve());
    enqueue = jest.fn();
    enqueueApproved = jest.fn();
    systemLine = jest.fn(() => Promise.resolve());
    a = {
      events: stub<DomainEventService>({ emit }),
      push: stub<PushDispatcherService>({
        enqueueForGroupJoinRequest: enqueue,
        enqueueForGroupJoinApproved: enqueueApproved,
      }),
      participantIds: () => Promise.resolve(['owner', 'admin', 'm1']),
      reviewerIds: () => Promise.resolve(['owner', 'admin']),
      userHandle: (id) => Promise.resolve(`@${id}`),
      systemLine,
    };
  });

  it('a join tells every member, with both ids and the time, then posts the line', async () => {
    announceJoined(a, { ...group, membershipChangedAt: 'T' }, 'joiner');
    await flush();
    await flush();
    expect(emit).toHaveBeenCalledWith(
      'group:member_added',
      {
        conversationId: 'pub-1',
        publicId: 'pub-1',
        internalId: 'g-1',
        userId: 'joiner',
        membershipChangedAt: 'T',
      },
      ['owner', 'admin', 'm1'],
    );
    expect(systemLine).toHaveBeenCalledWith(
      'g-1',
      'joiner',
      '@joiner joined the group',
    );
  });

  it('a new request reaches the owner and admins only: their list, and a push each', async () => {
    announceJoinRequested(a, group, 'asker');
    await flush();
    await flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('group:join_requests', ids, [
      'owner',
      'admin',
    ]);
    // Not a line in the group: members learn nothing of a request.
    expect(systemLine).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith({
      recipientId: 'owner',
      conversationId: 'g-1',
      requesterId: 'asker',
    });
  });

  it("an approval brings the group into the new member's inbox and updates the reviewers", async () => {
    announceRequestApproved(
      a,
      { ...group, membershipChangedAt: 'T' },
      'admin',
      'asker',
    );
    await flush();
    await flush();
    expect(emit).toHaveBeenCalledWith(
      'conversation:updated',
      { conversationId: 'pub-1' },
      ['asker'],
    );
    expect(emit).toHaveBeenCalledWith('group:join_requests', ids, [
      'owner',
      'admin',
    ]);
    // The requester's preview, and their phone.
    expect(emit).toHaveBeenCalledWith(
      'group:join_request_decided',
      { ...ids, status: 'APPROVED' },
      ['asker'],
    );
    expect(enqueueApproved).toHaveBeenCalledWith({
      recipientId: 'asker',
      conversationId: 'g-1',
      approvedAt: 'T',
    });
    expect(systemLine).toHaveBeenCalledWith(
      'g-1',
      'admin',
      "@admin approved @asker's request to join",
    );
  });

  it("a decline updates the reviewers' lists and the requester's preview, nothing else", async () => {
    announceRequestDeclined(a, ids, 'asker');
    await flush();
    await flush();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('group:join_requests', ids, [
      'owner',
      'admin',
    ]);
    expect(emit).toHaveBeenCalledWith(
      'group:join_request_decided',
      { ...ids, status: 'REJECTED' },
      ['asker'],
    );
    expect(systemLine).not.toHaveBeenCalled();
    expect(enqueueApproved).not.toHaveBeenCalled();
  });

  it('a request with no reviewers left sends nothing (never the group room)', async () => {
    a.reviewerIds = () => Promise.resolve([]);
    announceJoinRequested(a, group, 'asker');
    await flush();
    await flush();
    expect(emit).not.toHaveBeenCalled();
  });
});
