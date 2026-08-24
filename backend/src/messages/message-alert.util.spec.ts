import { emitMessageNew } from './message-alert.util';

/**
 * Mute must silence the alert without withholding the message.
 *
 * The bug this covers: `message:new` went out as one undifferentiated
 * broadcast and the client decided whether to alert from its own cached
 * conversation list. A device that had never loaded that list — a fresh tab, a
 * cold start — had no mute row to consult and alerted anyway.
 */
describe('emitMessageNew', () => {
  const makeService = () => {
    const calls: Array<{ type: string; data: any; targets?: string[] }> = [];
    return {
      calls,
      service: {
        emit: jest.fn(async (type: string, data: any, targets?: string[]) => {
          calls.push({ type, data, targets });
        }),
      } as any,
    };
  };

  it('delivers to muted recipients too, flagged not to alert', () => {
    const { calls, service } = makeService();

    emitMessageNew(service, { id: 'm1', text: 'hi' }, {
      recipientIds: ['alice', 'bob'],
      unmutedRecipientIds: ['alice'],
    });

    const delivered = calls.flatMap((c) => c.targets || []);
    expect(delivered.sort()).toEqual(['alice', 'bob']);

    const alice = calls.find((c) => c.targets?.includes('alice'));
    const bob = calls.find((c) => c.targets?.includes('bob'));
    expect(alice!.data.alert).toBe(true);
    expect(bob!.data.alert).toBe(false);
    // The message body is identical either way — mute is not a delivery filter.
    expect(bob!.data.text).toBe('hi');
  });

  it('never alerts the sender on their own other devices', () => {
    const { calls, service } = makeService();

    emitMessageNew(service, { id: 'm1' }, {
      recipientIds: ['alice'],
      unmutedRecipientIds: ['alice'],
      senderId: 'sender',
    });

    const own = calls.find((c) => c.targets?.includes('sender'));
    expect(own!.data.alert).toBe(false);
  });

  it('emits nothing for an empty recipient list', () => {
    const { calls, service } = makeService();
    emitMessageNew(service, { id: 'm1' }, { recipientIds: [], unmutedRecipientIds: [] });
    expect(calls).toHaveLength(0);
  });
});
