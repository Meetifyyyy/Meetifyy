// The real service imports sanitize-html, which Jest cannot parse (ESM).
jest.mock('../email/email.service', () => ({ EmailService: jest.fn() }));

import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  SupportCategory,
  SupportPriority,
  SupportRequestType,
  SupportStatus,
} from '@prisma/client';

import { stub } from '../common/testing/stub';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { replyAddressFor, SupportService } from './support.service';

const created = new Date('2026-10-01T10:00:00.000Z');
const updated = new Date('2026-10-02T12:00:00.000Z');

const row = {
  ticketNumber: 'MFT-ABC123',
  type: SupportRequestType.PROBLEM,
  subject: 'Cannot upload',
  category: SupportCategory.TECHNICAL,
  status: SupportStatus.IN_PROGRESS,
  createdAt: created,
  updatedAt: updated,
};

const context = { ip: '1.2.3.4', userAgent: 'jest', userId: null };

function build(
  opts: {
    rows?: unknown[];
    one?: unknown;
    user?: unknown;
  } = {},
) {
  const findMany = jest.fn((_args: unknown) =>
    Promise.resolve(opts.rows ?? []),
  );
  const findFirst = jest.fn((_args: unknown) =>
    Promise.resolve(opts.one ?? null),
  );
  const create = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 't1',
      ticketNumber: 'MFT-NEW001',
      status: SupportStatus.OPEN,
      createdAt: created,
      ...args.data,
    }),
  );
  const findUnique = jest.fn((_args: unknown) =>
    Promise.resolve(opts.user ?? null),
  );
  const prisma = stub<PrismaService>({
    supportTicket: { findMany, findFirst, create },
    user: { findUnique },
    media: { findMany: jest.fn(() => Promise.resolve([])) },
  });
  const email = stub<EmailService>({
    sendSupportRequestReceivedEmail: jest.fn(() => Promise.resolve()),
  });
  return {
    service: new SupportService(prisma, email),
    findMany,
    findFirst,
    create,
  };
}

describe("SupportService — the account's own requests", () => {
  it("lists only the account's tickets, with no private fields", async () => {
    const { service, findMany } = build({ rows: [row] });
    const { requests } = await service.listRequestsForUser('user-1');

    const args = findMany.mock.calls[0][0] as {
      where: unknown;
      select: Record<string, boolean>;
    };
    expect(args.where).toEqual({ userId: 'user-1' });
    expect(Object.keys(args.select).sort()).toEqual([
      'category',
      'createdAt',
      'status',
      'subject',
      'ticketNumber',
      'type',
      'updatedAt',
    ]);
    expect(requests[0]).toMatchObject({
      ticketNumber: 'MFT-ABC123',
      type: 'PROBLEM',
      createdAt: created.toISOString(),
    });
  });

  it('reads one ticket by number AND owner, excluding internal notes in the query', async () => {
    const { service, findFirst } = build({
      one: { ...row, description: 'It fails', resolvedAt: null, messages: [] },
    });
    const detail = await service.getRequestForUser('user-1', 'MFT-ABC123');

    const args = findFirst.mock.calls[0][0] as {
      where: unknown;
      select: { messages: { where: unknown } };
    };
    expect(args.where).toEqual({
      userId: 'user-1',
      ticketNumber: 'MFT-ABC123',
    });
    expect(args.select.messages.where).toEqual({ isInternal: false });
    expect(detail.description).toBe('It fails');
  });

  it("answers another account's ticket number exactly like a missing one", async () => {
    const { service } = build({ one: null });
    await expect(
      service.getRequestForUser('user-2', 'MFT-ABC123'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SupportService.createRequestForUser', () => {
  const dto = {
    category: SupportCategory.COMMUNITIES,
    subject: 'Pin posts',
    description: 'Let moderators pin a post to the top of the community.',
  };

  it('links the ticket to the account and replies to the account address', async () => {
    const { service, create } = build({
      user: { displayName: 'Asha', email: 'asha@uni.edu', collegeEmail: null },
    });
    await service.createRequestForUser('user-1', dto, context);

    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBe('user-1');
    expect(data.email).toBe('asha@uni.edu');
    expect(data.name).toBe('Asha');
    expect(data.type).toBe(SupportRequestType.PROBLEM);
  });

  it('files an idea at low priority, whatever its area', async () => {
    const { service, create } = build({
      user: { displayName: 'Asha', email: 'asha@uni.edu', collegeEmail: null },
    });
    const result = await service.createRequestForUser(
      'user-1',
      {
        ...dto,
        category: SupportCategory.SAFETY_REPORTING,
        type: SupportRequestType.IDEA,
      },
      context,
    );
    expect(create.mock.calls[0][0].data.priority).toBe(SupportPriority.LOW);
    expect(result.type).toBe('IDEA');
  });

  it('refuses an account with no address to reply to', async () => {
    const { service, create } = build({
      user: { displayName: 'A', email: 'x@meetifyy.user', collegeEmail: null },
    });
    await expect(
      service.createRequestForUser('user-1', dto, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('replyAddressFor', () => {
  it('prefers the college address and never returns the placeholder', () => {
    expect(
      replyAddressFor({ email: 'a@x.com', collegeEmail: 'A@Uni.edu' }),
    ).toBe('a@uni.edu');
    expect(
      replyAddressFor({ email: 'u1@meetifyy.user', collegeEmail: null }),
    ).toBeNull();
  });
});
