/**
 * The failover path, which had no coverage.
 *
 * The behaviour that matters is not just "does the fallback send" — it is that
 * a total failure is still RECORDED. An earlier version rethrew from inside the
 * fallback's catch, which skipped the delivery-failure write entirely, so
 * enabling a fallback silently turned "undelivered" tickets back into ones that
 * sat pending forever.
 */

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
    if (primaryFails) throw new Error('resend failed');
    recorded.push({ messageId: 'resend-1' });
    return { ok: true };
  };

  try {
    if (driver === 'mailpit' || driver === 'smtp') return await sendViaSmtp('primary');
    return await sendViaResend();
  } catch (primaryError) {
    const canFailOver =
      fallbackDriver === 'smtp' && driver !== 'smtp' && driver !== 'mailpit';

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
    ).rejects.toThrow('resend failed');

    expect(s.log).toEqual(['email.failover', 'email.failover_failed', 'email.send_error']);
    expect(s.recorded).toEqual([{ error: 'resend failed' }]);
  });

  it('reports the PRIMARY error, not the fallback one, so the cause is not masked', async () => {
    const s = setup();
    const err = await runSend({ driver: 'resend', fallbackDriver: 'smtp', primaryFails: true, fallbackFails: true, ...s })
      .catch((e) => e);
    expect(err.message).toBe('resend failed');
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
    ).rejects.toThrow('resend failed');
    expect(s.log).toEqual(['email.send_error']);
    expect(s.recorded).toEqual([{ error: 'resend failed' }]);
  });
});
