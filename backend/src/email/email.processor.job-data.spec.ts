// The builder pulls in sanitize-html (ESM) and is replaced by a fake below;
// only its job names are needed from the real module.
jest.mock('./support-email.builder', () => ({
  SUPPORT_EMAIL_JOBS: {
    requestReceived: 'send-support-request-received',
    reply: 'send-support-reply',
  },
  SupportEmailBuilder: class {},
}));

// Template rendering needs VM modules under Jest; the HTML is not under test.
jest.mock('@react-email/render', () => ({
  render: jest.fn().mockResolvedValue('<p>rendered</p>'),
}));

import { EmailProcessor } from './email.processor';
import type { EmailJob, EmailJobData } from './email-jobs';
import type { SupportEmailBuilder } from './support-email.builder';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmailUsageService } from './email-usage.service';

/**
 * EmailProcessor against the job data EmailService enqueues. The transports are
 * replaced; everything between the job and the transport call is the real code.
 */
describe('EmailProcessor job data', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'smtp-1' });
  const build = jest.fn().mockResolvedValue(null);

  const processor = () => {
    const p = new EmailProcessor(
      { build } as unknown as SupportEmailBuilder,
      {} as PrismaService,
      {
        recordSent: jest.fn().mockResolvedValue(undefined),
      } as unknown as EmailUsageService,
    );
    Object.assign(p, {
      driver: 'smtp',
      fallbackDriver: '',
      smtpTransporter: { sendMail },
    });
    return p;
  };
  const job = (name: string, data: EmailJobData) =>
    ({ id: 'job-1', name, data }) as EmailJob;

  beforeEach(() => jest.clearAllMocks());

  it('sends a template job to the address it carries', async () => {
    await processor().process(
      job('send-welcome-email', { email: 'a@example.test', name: 'A' }),
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]).toEqual([
      expect.objectContaining({ subject: 'Welcome to Meetifyy!' }),
    ]);
  });

  it('fails a template job with no recipient before calling a transport', async () => {
    await expect(
      processor().process(job('send-welcome-email', { name: 'A' })),
    ).rejects.toThrow('has no recipient');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('fails a support job with no row id instead of querying with none', async () => {
    await expect(
      processor().process(job('send-support-reply', {})),
    ).rejects.toThrow('has no row id');
    expect(build).not.toHaveBeenCalled();
  });

  it('builds a support job from the row id it carries', async () => {
    await expect(
      processor().process(job('send-support-reply', { messageId: 'm-1' })),
    ).resolves.toEqual({ skipped: true });
    expect(build).toHaveBeenCalledWith('send-support-reply', 'm-1');
  });
});
