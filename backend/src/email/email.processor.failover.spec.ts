/**
 * The failover path, which had no coverage.
 *
 * The behaviour that matters is not just "does the fallback send" — it is that
 * a total failure is still RECORDED. An earlier version rethrew from inside the
 * fallback's catch, which skipped the delivery-failure write entirely, so
 * enabling a fallback silently turned "undelivered" tickets back into ones that
 * sat pending forever.
 */

import { classifyResendFailure, ResendRejection } from './resend-failure';

type Outcome = { ok: boolean };

/**
 * A faithful reduction of EmailProcessor.send()'s control flow: primary
 * transport, optional SMTP failover, shared failure handling. Exercising the
 * real class would need Redis, Prisma, Resend and a live SMTP server; this
 * isolates the branching, which is where the bug was.
 */
async function runSend(opts: {
  driver: 'resend' | 'smtp' | 'mailpit';
  fallbackDriver: '' | 'smtp';
  primaryFails: boolean;
  /** What the primary failed with. Decides whether failover is even attempted. */
  primaryError?: unknown;
  fallbackFails: boolean;
  log: string[];
  recorded: { error?: string; messageId?: string }[];
}): Promise<Outcome> {
  const { driver, fallbackDriver, primaryFails, fallbackFails, log, recorded } = opts;

  const sendViaSmtp = async (tag: string) => {
    if ((tag === 'primary' && primaryFails) || (tag === 'fallback' && fallbackFails)) {
      throw new Error(`smtp ${tag} failed`);
    }
    recorded.push({ messageId: `smtp-${tag}` });
    return { ok: true };
  };
  const sendViaResend = async () => {
    if (primaryFails) throw (opts.primaryError ?? new ResendRejection('quota', 'daily_quota_exceeded', 429));
    recorded.push({ messageId: 'resend-1' });
    return { ok: true };
  };

  try {
    if (driver === 'mailpit' || driver === 'smtp') return await sendViaSmtp('primary');
    return await sendViaResend();
  } catch (primaryError) {
    const relayAvailable =
      fallbackDriver === 'smtp' && driver !== 'smtp' && driver !== 'mailpit';
    // Only when Resend told us it did not send. See resend-failure.ts.
    const canFailOver =
      relayAvailable && classifyResendFailure(primaryError) === 'not-sent';

    if (canFailOver) {
      log.push('email.failover');
      try {
        return await sendViaSmtp('fallback');
      } catch {
        log.push('email.failover_failed');
        // No rethrow: execution must reach the shared handling below.
      }
    }

    log.push('email.send_error');
    recorded.push({ error: (primaryError as Error).message });
    throw primaryError;
  }
}

describe('email failover', () => {
  const setup = () => ({ log: [] as string[], recorded: [] as any[] });

  it('sends via Resend and never touches the fallback when the primary works', async () => {
    const s = setup();
    await runSend({ driver: 'resend', fallbackDriver: 'smtp', primaryFails: false, fallbackFails: false, ...s });
    expect(s.recorded).toEqual([{ messageId: 'resend-1' }]);
    expect(s.log).toEqual([]);
  });

  it('falls over to SMTP when Resend fails, and records the delivery', async () => {
    const s = setup();
    const out = await runSend({ driver: 'resend', fallbackDriver: 'smtp', primaryFails: true, fallbackFails: false, ...s });
    expect(out).toEqual({ ok: true });
    expect(s.log).toEqual(['email.failover']);
    expect(s.recorded).toEqual([{ messageId: 'smtp-fallback' }]);
  });

  it('RECORDS THE FAILURE when both transports fail', async () => {
    // The regression: this used to rethrow from the inner catch, so the send
    // error was never logged and the delivery was never marked failed.
    const s = setup();
    await expect(
      runSend({ driver: 'resend', fallbackDriver: 'smtp', primaryFails: true, fallbackFails: true, ...s }),
    ).rejects.toThrow(/quota/);

    expect(s.log).toEqual(['email.failover', 'email.failover_failed', 'email.send_error']);
    expect(s.recorded[0].error).toMatch(/quota/);
  });

  it('reports the PRIMARY error, not the fallback one, so the cause is not masked', async () => {
    const s = setup();
    const err = await runSend({ driver: 'resend', fallbackDriver: 'smtp', primaryFails: true, fallbackFails: true, ...s })
      .catch((e) => e);
    expect(err.message).toMatch(/quota/);
  });

  it('does not retry SMTP through the same transporter that just failed', async () => {
    const s = setup();
    await expect(
      runSend({ driver: 'smtp', fallbackDriver: 'smtp', primaryFails: true, fallbackFails: false, ...s }),
    ).rejects.toThrow('smtp primary failed');
    // No failover attempted: same host, same credentials, same outcome.
    expect(s.log).toEqual(['email.send_error']);
    expect(s.recorded).toEqual([{ error: 'smtp primary failed' }]);
  });

  it('records the failure normally when no fallback is configured', async () => {
    const s = setup();
    await expect(
      runSend({ driver: 'resend', fallbackDriver: '', primaryFails: true, fallbackFails: false, ...s }),
    ).rejects.toThrow(/quota/);
    expect(s.log).toEqual(['email.send_error']);
    expect(s.recorded[0].error).toMatch(/quota/);
  });
});

describe('failover is skipped when it would risk a duplicate', () => {
  const setup = () => ({ log: [] as string[], recorded: [] as any[] });

  it('does NOT reach for Brevo after a Resend timeout', async () => {
    // Resend may have accepted and sent it; only the reply was lost. Sending
    // again through the relay is how one signup produces two emails.
    const s = setup();
    await expect(
      runSend({
        driver: 'resend', fallbackDriver: 'smtp',
        primaryFails: true, fallbackFails: false,
        primaryError: Object.assign(new Error('request timed out'), { name: 'TimeoutError' }),
        ...s,
      }),
    ).rejects.toThrow(/timed out/);

    expect(s.log).toEqual(['email.send_error']);           // no failover attempted
    expect(s.recorded.some((r) => r.messageId)).toBe(false); // nothing sent twice
  });

  it('does NOT reach for Brevo for a message Brevo would also reject', async () => {
    const s = setup();
    await expect(
      runSend({
        driver: 'resend', fallbackDriver: 'smtp',
        primaryFails: true, fallbackFails: false,
        primaryError: new ResendRejection('bad address', 'validation_error', 422),
        ...s,
      }),
    ).rejects.toThrow(/bad address/);
    expect(s.log).toEqual(['email.send_error']);
  });

  it('DOES reach for Brevo when Resend is out of quota', async () => {
    // The case the fallback exists for.
    const s = setup();
    const out = await runSend({
      driver: 'resend', fallbackDriver: 'smtp',
      primaryFails: true, fallbackFails: false,
      primaryError: new ResendRejection('over quota', 'daily_quota_exceeded', 429),
      ...s,
    });
    expect(out).toEqual({ ok: true });
    expect(s.log).toEqual(['email.failover']);
    expect(s.recorded).toEqual([{ messageId: 'smtp-fallback' }]);
  });

  it('DOES reach for Brevo when Resend itself is unreachable', async () => {
    const s = setup();
    const out = await runSend({
      driver: 'resend', fallbackDriver: 'smtp',
      primaryFails: true, fallbackFails: false,
      primaryError: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      ...s,
    });
    expect(out).toEqual({ ok: true });
    expect(s.log).toEqual(['email.failover']);
  });
});
