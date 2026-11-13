import { ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MaxRetriesPerRequestError } from 'ioredis/built/errors';
import { QueueNotReadyError } from '../common/queues/producer-queue';
import { EmailService } from './email.service';
import type { EmailJobData } from './email-jobs';

// sanitize-html ships as ESM, which this project's Jest transform cannot load;
// the support-email builder imports it, and nothing here builds a support email.
jest.mock('../common/utils/sanitize-html.util', () => ({}));

const FRIENDLY = 'Email is temporarily unavailable. Please try again.';

describe('EmailService when the queue cannot reach Redis', () => {
  const build = (failure: Error) => {
    const add = jest.fn<Promise<unknown>, unknown[]>(() =>
      Promise.reject(failure),
    );
    // Only `add` is used by the service.
    const queue = { add } as unknown as Queue<EmailJobData>;
    return { service: new EmailService(queue), add };
  };

  const mapped: Array<[string, () => Error]> = [
    ['the producer ready timeout', () => new QueueNotReadyError(5_000)],
    ['an ioredis command timeout', () => new Error('Command timed out')],
    [
      'ioredis max retries per request',
      () => new MaxRetriesPerRequestError(2) as unknown as Error,
    ],
  ];

  it.each(mapped)(
    'turns %s into a 503 the client can retry',
    async (_n, make) => {
      const cause = make();
      const { service } = build(cause);

      const outcome = await service
        .sendVerificationOtpEmail('a@example.test', 'A', '123456')
        .catch((err: unknown) => err);

      expect(outcome).toBeInstanceOf(ServiceUnavailableException);
      expect((outcome as ServiceUnavailableException).getStatus()).toBe(503);
      expect((outcome as ServiceUnavailableException).message).toBe(FRIENDLY);
      expect((outcome as ServiceUnavailableException).cause).toBe(cause);
    },
  );

  it('maps every enqueue path, not just one method', async () => {
    const { service, add } = build(new Error('Command timed out'));
    await expect(
      service.sendSignInEmailChangedNotice(
        'a@example.test',
        'A',
        'b***@x.test',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.sendAccountDeletionOtpEmail('a@example.test', 'A', '123456'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('never puts the code or the address in the response', async () => {
    const { service } = build(new Error('Command timed out'));
    const outcome = await service
      .sendVerificationOtpEmail('secret@example.test', 'A', '987654')
      .catch((err: unknown) => err);
    expect(
      JSON.stringify((outcome as ServiceUnavailableException).getResponse()),
    ).not.toMatch(/987654|secret@/);
  });

  it('leaves any other failure exactly as it was', async () => {
    const other = new Error("JobId cannot be '0'");
    const { service } = build(other);
    await expect(service.sendWelcomeEmail('a@example.test', 'A')).rejects.toBe(
      other,
    );
  });

  it('passes a successful enqueue straight through', async () => {
    const add = jest.fn(() => Promise.resolve({ id: '1' }));
    const service = new EmailService({ add } as unknown as Queue<EmailJobData>);
    await expect(
      service.sendWelcomeEmail('a@example.test', 'A'),
    ).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledWith('send-welcome-email', {
      email: 'a@example.test',
      name: 'A',
    });
  });
});
