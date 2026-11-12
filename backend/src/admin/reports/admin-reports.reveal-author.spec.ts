import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ReportTargetType } from '@prisma/client';
import { stub } from '../../common/testing/stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AdminRequest } from '../../common/types/authenticated-request';
import type { ModerationService } from '../../moderation/moderation.service';
import { AdminReportsController } from './admin-reports.controller';
import {
  AdminReportsService,
  CONFESSION_REVEAL_AUTHOR_ACTION,
  type RevealAuditContext,
} from './admin-reports.service';
import { RevealConfessionAuthorDto } from './reveal-confession-author.dto';

const author = {
  id: 'user-9',
  username: 'real_name',
  displayName: 'Real Name',
  avatar: null,
};

const context: RevealAuditContext = {
  adminId: 'admin-1',
  ip: '203.0.113.7',
  endpoint: '/admin/reports/report-1/reveal-author',
  httpMethod: 'POST',
  requestId: 'req-1',
};

const REASON = 'Repeated harassment of a named student';

describe('AdminReportsService.revealConfessionAuthor', () => {
  const build = (
    opts: {
      report?: { id: string; targetType: ReportTargetType; targetId: string };
      confession?: unknown;
      auditFails?: boolean;
    } = {},
  ) => {
    const report =
      'report' in opts
        ? opts.report
        : {
            id: 'report-1',
            targetType: ReportTargetType.CONFESSION,
            targetId: 'conf-1',
          };
    const confession =
      'confession' in opts
        ? opts.confession
        : { id: 'conf-1', profile: { user: author } };
    const auditCreate = jest.fn((_args: { data: Record<string, unknown> }) =>
      opts.auditFails
        ? Promise.reject(new Error('audit table unavailable'))
        : Promise.resolve({}),
    );
    const prisma = stub<PrismaService>({
      report: { findUnique: jest.fn(() => Promise.resolve(report ?? null)) },
      confession: {
        findUnique: jest.fn(() => Promise.resolve(confession ?? null)),
      },
      auditLog: { create: auditCreate },
    });
    return { service: new AdminReportsService(prisma), auditCreate };
  };

  it('404s for a missing report and writes nothing', async () => {
    const { service, auditCreate } = build({ report: undefined });
    await expect(
      service.revealConfessionAuthor('nope', REASON, context),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('400s for a report about anything but a confession', async () => {
    const { service, auditCreate } = build({
      report: {
        id: 'report-1',
        targetType: ReportTargetType.POST,
        targetId: 'post-1',
      },
    });
    await expect(
      service.revealConfessionAuthor('report-1', REASON, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('404s when the confession is gone, without an audit row', async () => {
    const { service, auditCreate } = build({ confession: null });
    await expect(
      service.revealConfessionAuthor('report-1', REASON, context),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('writes one audit row with the report and reason, never the author, then returns the author', async () => {
    const { service, auditCreate } = build();
    const result = await service.revealConfessionAuthor(
      'report-1',
      REASON,
      context,
    );

    expect(result).toEqual({ author });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const row = auditCreate.mock.calls[0][0].data;
    expect(row).toMatchObject({
      adminId: 'admin-1',
      action: CONFESSION_REVEAL_AUTHOR_ACTION,
      targetType: 'CONFESSION',
      targetId: 'conf-1',
      newValue: { reportId: 'report-1', reason: REASON },
      ip: '203.0.113.7',
      endpoint: '/admin/reports/report-1/reveal-author',
      httpMethod: 'POST',
      requestId: 'req-1',
    });
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(author.id);
    expect(serialised).not.toContain(author.username);
    expect(serialised).not.toContain(author.displayName);
  });

  it('does not return the identity when the audit write fails', async () => {
    const { service } = build({ auditFails: true });
    await expect(
      service.revealConfessionAuthor('report-1', REASON, context),
    ).rejects.toThrow('audit table unavailable');
  });
});

describe('RevealConfessionAuthorDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const run = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: RevealConfessionAuthorDto });

  it('accepts a reason and trims it', async () => {
    await expect(run({ reason: `  ${REASON}  ` })).resolves.toEqual({
      reason: REASON,
    });
  });

  it.each([
    ['too short', { reason: 'too short' }],
    ['only spaces', { reason: ' '.repeat(40) }],
    ['too long', { reason: 'x'.repeat(501) }],
    ['missing', {}],
    ['not a string', { reason: 12345678901 }],
    ['an unknown field', { reason: REASON, extra: 1 }],
  ])('rejects a reason that is %s', async (_label, body) => {
    await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AdminReportsController.revealAuthor', () => {
  it('hands the request origin to the service as the audit context', async () => {
    const revealConfessionAuthor = jest.fn(
      (_id: string, _reason: string, _ctx: RevealAuditContext) =>
        Promise.resolve({ author }),
    );
    const controller = new AdminReportsController(
      stub<ModerationService>(),
      stub<AdminReportsService>({ revealConfessionAuthor }),
    );
    const req = stub<AdminRequest>({
      admin: { id: 'admin-1' },
      ip: '203.0.113.7',
      method: 'POST',
      originalUrl: '/admin/reports/report-1/reveal-author',
      headers: { 'x-request-id': 'req-1' },
    });

    await expect(
      controller.revealAuthor('report-1', { reason: REASON }, req),
    ).resolves.toEqual({ author });
    expect(revealConfessionAuthor).toHaveBeenCalledWith('report-1', REASON, {
      adminId: 'admin-1',
      ip: '203.0.113.7',
      endpoint: '/admin/reports/report-1/reveal-author',
      httpMethod: 'POST',
      requestId: 'req-1',
    });
  });
});
