import { clientIp, normalizeIp } from './client-ip.util';

describe('normalizeIp', () => {
  it('returns IPv4 unchanged', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6 that Node reports on dual-stack sockets', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  /**
   * Observed in production against Azure Container Apps: its ingress appends
   * the client as `address:port` to X-Forwarded-For, and the source port
   * changes on every TCP connection. Keeping the port meant every new
   * connection got its own fresh budget, which silently defeats every per-IP
   * limit — a brute-force script opening one connection per attempt would
   * never meet one.
   */
  describe('port stripping', () => {
    it('maps every port from one address to the same key', () => {
      const key = normalizeIp('14.139.98.105');
      expect(normalizeIp('14.139.98.105:54321')).toBe(key);
      expect(normalizeIp('14.139.98.105:54322')).toBe(key);
      expect(normalizeIp('14.139.98.105:1')).toBe(key);
    });

    it('handles bracketed IPv6 with a port', () => {
      expect(normalizeIp('[2001:db8::1]:443')).toBe(normalizeIp('2001:db8::1'));
      expect(normalizeIp('[2001:db8::1]:8080')).toBe(
        normalizeIp('[2001:db8::1]:443'),
      );
    });

    it('does not mistake IPv6 colons for a port separator', () => {
      // Eight hextets, no port — must still collapse to its /64, not be cut
      // at the first colon.
      expect(normalizeIp('2001:db8:abcd:12:dead:beef:1:2')).toBe(
        '2001:db8:abcd:12',
      );
    });

    it('keeps different addresses apart regardless of port', () => {
      expect(normalizeIp('14.139.98.105:1')).not.toBe(
        normalizeIp('14.139.98.106:1'),
      );
    });
  });

  it('strips a zone index', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80:0:0:0');
  });

  it('is case-insensitive and trims', () => {
    expect(normalizeIp('  2001:DB8:ABCD:0012::1  ')).toBe(
      normalizeIp('2001:db8:abcd:12::1'),
    );
  });

  it('handles missing input', () => {
    expect(normalizeIp(undefined)).toBe('unknown');
    expect(normalizeIp('')).toBe('unknown');
  });

  /**
   * The bypass this exists to close: a single IPv6 customer allocation is
   * commonly a /64, so keying on the full address hands one client 2^64 fresh
   * buckets — the same as having no limit at all.
   */
  describe('IPv6 /64 collapse', () => {
    it('maps every address in one /64 to the same key', () => {
      const key = normalizeIp('2001:db8:abcd:0012::1');
      expect(normalizeIp('2001:db8:abcd:0012::2')).toBe(key);
      expect(normalizeIp('2001:db8:abcd:0012:ffff:ffff:ffff:ffff')).toBe(key);
      expect(normalizeIp('2001:db8:abcd:12:dead:beef:cafe:1')).toBe(key);
    });

    it('keeps different /64s apart', () => {
      expect(normalizeIp('2001:db8:abcd:0012::1')).not.toBe(
        normalizeIp('2001:db8:abcd:0013::1'),
      );
    });

    it('expands :: shorthand consistently', () => {
      expect(normalizeIp('2001:db8::1')).toBe(normalizeIp('2001:db8:0:0::99'));
    });
  });
});

describe('clientIp', () => {
  /**
   * The critical regression test.
   *
   * Every IP-keyed guard used to read `x-forwarded-for.split(',')[0]` — the
   * LEFTMOST entry, which is whatever the caller wrote. Sending a random value
   * per request minted a fresh bucket each time, defeating login brute-force,
   * account-enumeration and support-form protection alike.
   *
   * `clientIp` must depend on `req.ip` only. Express derives that from the
   * right-hand end of the header using the configured trust-proxy hop count,
   * which is the only correct read.
   */
  it('ignores a forged X-Forwarded-For header entirely', () => {
    const forged = {
      ip: '203.0.113.7',
      headers: {
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'x-real-ip': '9.9.9.9',
      },
      socket: { remoteAddress: '10.0.0.1' },
    };

    expect(clientIp(forged as any)).toBe('203.0.113.7');
  });

  it('gives an attacker rotating the header the same bucket every time', () => {
    const buckets = new Set(
      ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'].map((spoofed) =>
        clientIp({
          ip: '203.0.113.7',
          headers: { 'x-forwarded-for': spoofed },
        } as any),
      ),
    );

    expect(buckets.size).toBe(1);
  });

  it('falls back to the socket address when req.ip is absent', () => {
    expect(
      clientIp({ socket: { remoteAddress: '::ffff:198.51.100.4' } } as any),
    ).toBe('198.51.100.4');
  });

  it('never throws on a malformed request object', () => {
    expect(clientIp({} as any)).toBe('unknown');
    expect(clientIp(undefined as any)).toBe('unknown');
  });
});
