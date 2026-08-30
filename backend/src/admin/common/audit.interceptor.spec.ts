import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Verification reviews are the most consequential admin action in the product,
 * and until this pass they produced no `AuditLog` row at all — the endpoint
 * authenticated against the app's user session rather than an admin one, so
 * `req.admin` was never set and this interceptor skipped every request.
 */
describe('AuditInterceptor — verification reviews', () => {
  let prisma: any;
  let interceptor: AuditInterceptor;

  const run = async (req: any, response: any = { request: { id: 'req-1' } }) => {
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };
    await new Promise<void>((resolve) =>
      interceptor
        .intercept(ctx, { handle: () => of(response) } as any)
        .subscribe({ complete: () => resolve() }),
    );
    return prisma.auditLog.create.mock.calls[0]?.[0]?.data;
  };

  const reviewRequest = (status: string, extra: any = {}) => ({
    method: 'PATCH',
    originalUrl: '/admin/verification/requests/req-1/status',
    admin: { id: 'super-admin-7' },
    params: { id: 'req-1' },
    body: { status, ...extra },
    headers: {},
    ip: '10.0.0.1',
  });

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn(() => Promise.resolve({})) } };
    interceptor = new AuditInterceptor(prisma);
  });

  it('records an approval against the admin who made it', async () => {
    const data = await run(reviewRequest('VERIFIED'));
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
    const data = await run(reviewRequest('REJECTED'));
    expect(data.action).toBe('VERIFICATION_REJECT');
  });

  it('records a resubmission request distinctly', async () => {
    const data = await run(reviewRequest('RESUBMISSION_REQUIRED'));
    expect(data.action).toBe('VERIFICATION_REQUEST_RESUBMISSION');
  });

  it('does not copy the reviewer note into the audit row', async () => {
    // A note can quote what the reviewer read off an ID. The decision and its
    // author are what the trail needs; the note stays on the request row.
    const data = await run(
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

  it('ignores reads', async () => {
    await run({ ...reviewRequest('VERIFIED'), method: 'GET' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
