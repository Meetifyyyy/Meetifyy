import { stub } from '../common/testing/stub';
import type { DomainEventService } from '../events/domain-event.service';
import {
  announceDeparture,
  departureLine,
  type DepartureAnnouncer,
} from './group-departure-announce.util';
import { previewTextFor } from './core/message-preview';

/**
 * A departure's line is written AT the departure (a departed member's history
 * ends at `leftAt`, inclusive, so it stays in theirs), and says what happened
 * in a form the app reads: the removed person sees "@admin removed you", the
 * one who left "You left the group". Both reach the departed member live.
 */
const flush = () => new Promise((r) => setImmediate(r));
const LEFT_AT = '2026-10-29T10:00:00.000Z';
const group = { internalId: 'g-1', publicId: 'pub-1', leftAt: LEFT_AT };

function announcer() {
  const emit = jest.fn(() => Promise.resolve());
  const systemLine = jest.fn<
    Promise<object>,
    Parameters<DepartureAnnouncer['systemLine']>
  >(() => Promise.resolve({ id: 'm-1' }));
  const a: DepartureAnnouncer = {
    events: stub<DomainEventService>({ emit }),
    participantIds: () => Promise.resolve(['admin', 'm1']),
    userHandle: (id) => Promise.resolve(`@${id}`),
    systemLine,
  };
  return { a, emit, systemLine };
}

describe('announcing a departure', () => {
  it('a removal is written at the removal, with who did it to whom', async () => {
    const { a, emit, systemLine } = announcer();
    announceDeparture(a, group, { actorId: 'admin', targetUserId: 'gone' });
    await flush();
    await flush();
    await flush();

    expect(systemLine).toHaveBeenCalledWith(
      'g-1',
      'admin',
      '@admin removed @gone from the group',
      {
        createdAt: new Date(LEFT_AT),
        event: {
          kind: 'member_removed',
          actorId: 'admin',
          actorHandle: '@admin',
          targetId: 'gone',
          targetHandle: '@gone',
        },
      },
    );
    // The removed member gets the event and the line, live.
    expect(emit).toHaveBeenCalledWith(
      'group:member_removed',
      expect.objectContaining({ targetUserId: 'gone', removedBy: 'admin' }),
      ['gone', 'admin', 'm1'],
    );
    expect(emit).toHaveBeenCalledWith('message:new', { id: 'm-1' }, [
      'gone',
      'admin',
      'm1',
    ]);
  });

  it('leaving is its own event, not a removal by oneself', async () => {
    const { a, systemLine } = announcer();
    announceDeparture(a, group, { actorId: 'm1', targetUserId: 'm1' });
    await flush();
    await flush();
    await flush();
    expect(systemLine).toHaveBeenCalledWith('g-1', 'm1', '@m1 left the group', {
      createdAt: new Date(LEFT_AT),
      event: { kind: 'member_left', actorId: 'm1', actorHandle: '@m1' },
    });
  });

  it('the stored text reads right for everyone else and older apps', () => {
    expect(
      departureLine({
        kind: 'member_removed',
        actorId: 'a',
        actorHandle: '@a',
        targetId: 'b',
        targetHandle: '@b',
      }),
    ).toBe('@a removed @b from the group');
  });
});

describe("a departure line in the departed member's chat list", () => {
  const removal = {
    state: 'NORMAL',
    payload: {
      text: '@admin removed @gone from the group',
      event: {
        kind: 'member_removed',
        actorId: 'admin',
        actorHandle: '@admin',
        targetId: 'gone',
        targetHandle: '@gone',
      },
    },
  };

  it('says "you" to the person it is about, and the stored text to anyone else', () => {
    expect(previewTextFor(removal, 'gone')).toBe(
      '@admin removed you from the group',
    );
    expect(previewTextFor(removal, 'm1')).toBe(
      '@admin removed @gone from the group',
    );
    expect(
      previewTextFor(
        {
          state: 'NORMAL',
          payload: {
            text: '@m1 left the group',
            event: { kind: 'member_left', actorId: 'm1', actorHandle: '@m1' },
          },
        },
        'm1',
      ),
    ).toBe('You left the group');
  });
});
