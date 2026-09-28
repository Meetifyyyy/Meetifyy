import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import type { PrismaService } from '../../prisma/prisma.service';
import { stub } from '../../common/testing/stub';

type AuditRow = Prisma.AuditLogUncheckedCreateInput;

/**
 * Verification reviews are the most consequential admin action in the product,
 * and until this pass they produced no `AuditLog` row at all — the endpoint
 * authenticated against the app's user session rather than an admin one, so
 * `req.admin` was never set and this interceptor skipped every request.
 */
describe('AuditInterceptor — verification reviews', () => {
  let prisma: {
    auditLog: { create: jest.Mock<Promise<object>, [{ data: AuditRow }]> };
  };
  let interceptor: AuditInterceptor;

  const run = async (
    req: Record<string, unknown>,
    response: unknown = { request: { id: 'req-1' } },
  ): Promise<AuditRow | undefined> => {
    const ctx = stub<ExecutionContext>({
      switchToHttp: () => ({ getRequest: () => req }),
    });
    const next: CallHandler = { handle: () => of(response) };
    await new Promise<void>((resolve) =>
      interceptor.intercept(ctx, next).subscribe({ complete: () => resolve() }),
    );
    return prisma.auditLog.create.mock.calls[0]?.[0]?.data;
  };

  /** Runs a request that must produce an audit row, and returns that row. */
  const recorded = async (req: Record<string, unknown>) => {
    const row = await run(req);
    if (!row) throw new Error('no AuditLog row was written');
    return row;
  };

  const reviewRequest = (
    status: string,
    extra: Record<string, unknown> = {},
  ) => ({
    method: 'PATCH',
    originalUrl: '/admin/verification/requests/req-1/status',
    admin: { id: 'super-admin-7' },
    params: { id: 'req-1' },
    body: { status, ...extra },
    headers: {},
    ip: '10.0.0.1',
  });

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: jest
          .fn<Promise<object>, [{ data: AuditRow }]>()
          .mockResolvedValue({}),
      },
    };
    interceptor = new AuditInterceptor(stub<PrismaService>(prisma));
  });

  it('records an approval against the admin who made it', async () => {
    const data = await recorded(reviewRequest('VERIFIED'));
    expect(data).toMatchObject({
      adminId: 'super-admin-7',
      action: 'VERIFICATION_APPROVE',
      targetType: 'VERIFICATION',
      targetId: 'req-1',
      httpMethod: 'PATCH',
    });
  });

  it('distinguishes a rejection from an approval', async () => {
    // The generic `/status` rule would have flattened both into
    // VERIFICATION_STATUS_CHANGE, losing which way the decision went.
    const data = await recorded(reviewRequest('REJECTED'));
    expect(data.action).toBe('VERIFICATION_REJECT');
  });

  it('records a resubmission request distinctly', async () => {
    const data = await recorded(reviewRequest('RESUBMISSION_REQUIRED'));
    expect(data.action).toBe('VERIFICATION_REQUEST_RESUBMISSION');
  });

  it('does not copy the reviewer note into the audit row', async () => {
    // A note can quote what the reviewer read off an ID. The decision and its
    // author are what the trail needs; the note stays on the request row.
    const data = await recorded(
      reviewRequest('REJECTED', { adminNotes: 'DOB on ID reads 1998-04-11' }),
    );
    expect(data.newValue).toEqual({ status: 'REJECTED' });
    expect(JSON.stringify(data)).not.toContain('1998-04-11');
  });

  it('writes nothing when no admin is attached', async () => {
    const { admin, ...anonymous } = reviewRequest('VERIFIED');
    await run(anonymous);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('still writes the row when x-request-id is repeated', async () => {
    // A repeated header arrives as an array, which the string column refuses,
    // and the swallowed insert failure used to lose the whole row.
    const data = await recorded({
      ...reviewRequest('VERIFIED'),
      headers: { 'x-request-id': ['a', 'b'] },
    });
    expect(data).toMatchObject({
      action: 'VERIFICATION_APPROVE',
      requestId: null,
    });
  });

  it('records no fields from a body that is not an object', async () => {
    const data = await recorded({
      ...reviewRequest('VERIFIED'),
      body: 'status=x',
    });
    expect(data.newValue).toEqual({});
  });

  it('ignores reads', async () => {
    await run({ ...reviewRequest('VERIFIED'), method: 'GET' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
