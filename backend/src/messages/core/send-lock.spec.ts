import { Prisma } from '@prisma/client';
import {
  isClientMessageIdConflict,
  retryOnClientIdConflict,
} from './send-lock';

/**
 * The database is the last line against a duplicate message: the unique
 * (senderId, clientMessageId) index refuses the second of two copies that got
 * past the lock together. That refusal must read as "already delivered", not
 * as a failed send.
 */
const conflict = (target: unknown) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

describe('client message id conflicts', () => {
  it('recognises the unique index refusing a second copy', () => {
    expect(
      isClientMessageIdConflict(conflict(['senderId', 'clientMessageId'])),
    ).toBe(true);
    expect(
      isClientMessageIdConflict(
        conflict('Message_senderId_clientMessageId_key'),
      ),
    ).toBe(true);
  });

  it('leaves every other error alone', () => {
    expect(isClientMessageIdConflict(conflict(['slug']))).toBe(false);
    expect(isClientMessageIdConflict(new Error('db down'))).toBe(false);
  });

  it('sends once more, which finds the copy that won', async () => {
    const send = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(conflict(['senderId', 'clientMessageId']))
      .mockResolvedValueOnce('existing-message');
    await expect(retryOnClientIdConflict(send)).resolves.toBe(
      'existing-message',
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a real failure', async () => {
    const send = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new Error('db down'));
    await expect(retryOnClientIdConflict(send)).rejects.toThrow('db down');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
