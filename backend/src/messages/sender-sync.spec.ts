import { emitMessageNew } from './message-alert.util';
import { stub } from '../common/testing/stub';
import type { DomainEventService } from '../events/domain-event.service';

/** One emitted event, as recorded by the fake. */
type SentEvent = {
  event: string;
  payload: { alert?: boolean };
  targets: string[];
};

/**
 * A message sent over HTTP has to reach the person who sent it.
 *
 * The chat's own composer sends over the socket, where the gateway answers the
 * sending tab with an ACK and echoes to that user's other tabs. Every SHARE
 * flow — share a post, a community, a profile, an activity — sends over HTTP
 * instead, and that path fanned out to `recipientIds` only.
 *
 * `emitMessageNew` has always taken a `senderId` for exactly this, and no
 * caller passed one, so the branch was dead: the message was written, the
 * recipients saw it live, and the sender's own devices were told nothing. The
 * message then appeared only when something refetched the thread, which is why
 * it took a reload to show up.
 */
describe('message:new fan-out', () => {
  const build = () => {
    const sent: SentEvent[] = [];
    const domainEventService = stub<DomainEventService>({
      emit: jest.fn(
        (event: string, payload: SentEvent['payload'], targets: string[]) => {
          sent.push({ event, payload, targets });
          return Promise.resolve();
        },
      ),
    });
    return { domainEventService, sent };
  };

  const targetsOf = (sent: SentEvent[], id: string) =>
    sent.filter((e) => e.targets.includes(id));

  it('delivers to the sender when a senderId is given', async () => {
    const { domainEventService, sent } = build();

    await Promise.all(
      emitMessageNew(
        domainEventService,
        { id: 'm1' },
        {
          recipientIds: ['bob'],
          unmutedRecipientIds: ['bob'],
          senderId: 'alice',
        },
      ),
    );

    expect(targetsOf(sent, 'alice')).toHaveLength(1);
    expect(targetsOf(sent, 'bob')).toHaveLength(1);
  });

  it('never alerts the sender — they already know', async () => {
    const { domainEventService, sent } = build();

    await Promise.all(
      emitMessageNew(
        domainEventService,
        { id: 'm1' },
        {
          recipientIds: ['bob'],
          unmutedRecipientIds: ['bob'],
          senderId: 'alice',
        },
      ),
    );

    expect(targetsOf(sent, 'alice')[0].payload.alert).toBe(false);
    expect(targetsOf(sent, 'bob')[0].payload.alert).toBe(true);
  });

  it('still delivers to a muted recipient, just without the alert', async () => {
    // Mute silences the alert, not the delivery — a muted chat that dropped
    // messages would silently lose history.
    const { domainEventService, sent } = build();

    await Promise.all(
      emitMessageNew(
        domainEventService,
        { id: 'm1' },
        {
          recipientIds: ['bob', 'carol'],
          unmutedRecipientIds: ['bob'],
          senderId: 'alice',
        },
      ),
    );

    expect(targetsOf(sent, 'carol')).toHaveLength(1);
    expect(targetsOf(sent, 'carol')[0].payload.alert).toBe(false);
  });

  it('tells nobody about the sender when there is no senderId', async () => {
    // The old behaviour, pinned so the regression is visible rather than
    // silent if a future call site forgets the option again.
    const { domainEventService, sent } = build();

    await Promise.all(
      emitMessageNew(
        domainEventService,
        { id: 'm1' },
        {
          recipientIds: ['bob'],
          unmutedRecipientIds: ['bob'],
        },
      ),
    );

    expect(targetsOf(sent, 'alice')).toHaveLength(0);
  });
});
