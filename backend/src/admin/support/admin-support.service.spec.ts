// sanitize-html is ESM-only under ts-jest; this spec never sanitizes.
jest.mock('../../common/utils/sanitize-html.util', () => ({
  sanitizeReplyHtml: (html: string) => html,
  htmlToPlainText: (html: string) => html,
}));

import { NotFoundException } from '@nestjs/common';
import { AdminSupportService } from './admin-support.service';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EmailService } from '../../email/email.service';
import type { StorageService } from '../../uploads/uploads.service';

describe('AdminSupportService.getTicketById attachments', () => {
  const findUnique = jest.fn();
  const getReviewerSignedUrl = jest.fn();

  const service = new AdminSupportService(
    stub<PrismaService>({
      supportTicket: { findUnique },
      superAdmin: { findMany: jest.fn().mockResolvedValue([]) },
    }),
    stub<EmailService>(),
    stub<StorageService>({ getReviewerSignedUrl }),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getReviewerSignedUrl.mockImplementation((key: string) =>
      Promise.resolve(`https://signed.example/${key}?sig=1`),
    );
  });

  it('attaches a 15-minute signed url to ticket and message attachments', async () => {
    findUnique.mockResolvedValue({
      id: 't1',
      attachments: [{ key: 'support/a.png', filename: 'a.png', size: 5 }],
      messages: [
        {
          id: 'm1',
          authorAdminId: null,
          attachments: [{ key: 'support/b.pdf', filename: 'b.pdf' }],
        },
        { id: 'm2', authorAdminId: null, attachments: null },
      ],
    });

    const ticket = await service.getTicketById('t1');

    expect(ticket.attachments).toEqual([
      {
        key: 'support/a.png',
        filename: 'a.png',
        size: 5,
        url: 'https://signed.example/support/a.png?sig=1',
      },
    ]);
    expect(ticket.messages[0].attachments?.[0].url).toBe(
      'https://signed.example/support/b.pdf?sig=1',
    );
    expect(ticket.messages[1].attachments).toBeNull();
    expect(getReviewerSignedUrl).toHaveBeenCalledWith('support/a.png', 900);
  });

  it('yields url null when signing fails, and drops malformed entries', async () => {
    getReviewerSignedUrl.mockRejectedValue(new Error('r2 down'));
    findUnique.mockResolvedValue({
      id: 't1',
      attachments: [{ key: 'support/a.png' }, 'junk', { nokey: true }, null],
      messages: [],
    });

    const ticket = await service.getTicketById('t1');

    expect(ticket.attachments).toEqual([{ key: 'support/a.png', url: null }]);
  });

  it('still 404s for a missing ticket', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.getTicketById('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
