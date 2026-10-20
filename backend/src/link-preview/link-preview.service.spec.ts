import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { LinkPreviewService } from './link-preview.service';

describe('LinkPreviewService', () => {
  let service: LinkPreviewService;

  beforeEach(() => {
    service = new LinkPreviewService();
  });

  it('rejects missing url parameter', async () => {
    await expect(service.getPreview('')).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid url format', async () => {
    await expect(service.getPreview('not-a-valid-url')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects unsupported protocols like file: or ftp:', async () => {
    await expect(service.getPreview('file:///etc/passwd')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getPreview('ftp://example.com/file')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects localhost and private loopback hostnames', async () => {
    await expect(service.getPreview('http://localhost:3000')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getPreview('http://127.0.0.1/admin')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.getPreview('http://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects private IPv4 ranges (10.x, 192.168.x, 172.16.x)', async () => {
    await expect(service.getPreview('http://10.0.0.1/')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getPreview('http://192.168.1.1/')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getPreview('http://172.16.0.1/')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

/**
 * SSRF: the private-range check must not depend on notation.
 *
 * The mapped IPv6 forms were screened by a prefix list that covered
 * `::ffff:127.`, `::ffff:10.` and `::ffff:192.168.` and nothing else, so
 * `::ffff:169.254.169.254` — the cloud metadata endpoint — was treated as a
 * public address and fetched. The host being previewed serves its own DNS, so
 * answering with a mapped AAAA record is entirely within an attacker's control.
 */
describe('LinkPreviewService — private address detection', () => {
  const isPrivate = (address: string): boolean =>
    new LinkPreviewService()['isPrivateAddress'](address);

  const blocked = [
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254', // AWS/GCP/Azure metadata
    '100.100.100.200', // Alibaba metadata (CGNAT)
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    // The same addresses in IPv4-mapped notation — the bypass.
    '::ffff:169.254.169.254',
    '::ffff:172.16.0.1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:100.100.100.200',
    // The same again in hex, which is how the URL parser writes them.
    '::ffff:a9fe:a9fe',
    '::ffff:7f00:1',
    '::ffff:a00:1',
    '0:0:0:0:0:ffff:ac10:1',
    // IPv4-compatible (deprecated) and multicast.
    '::7f00:1',
    'ff02::1',
  ];

  it.each(blocked)('treats %s as private', (address) => {
    expect(isPrivate(address)).toBe(true);
  });

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1::1'];

  it.each(allowed)('still allows the public address %s', (address) => {
    expect(isPrivate(address)).toBe(false);
  });
});

/**
 * The same bypass end to end. The URL parser rewrites a mapped IPv6 literal
 * into hex (`[::ffff:169.254.169.254]` becomes `[::ffff:a9fe:a9fe]`), and an
 * IP-literal host skips DNS, so the pinned lookup never runs: the address
 * check is the only guard, and it recognised only the dotted form.
 */
describe('LinkPreviewService — IPv6 literals in the URL', () => {
  const service = new LinkPreviewService();

  it.each([
    'http://[::ffff:169.254.169.254]/latest/meta-data',
    'http://[::ffff:127.0.0.1]:4000/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://[::127.0.0.1]/',
    'http://[::1]/',
    'http://[fe80::1]/',
  ])('refuses %s before connecting', async (url) => {
    await expect(service.getPreview(url)).rejects.toThrow(ForbiddenException);
  });

  /**
   * Real sockets, no mocked http: Node 20+ calls `lookup` with `{ all: true }`
   * and wants an array back. A bare-string answer fails the request with
   * ERR_INVALID_IP_ADDRESS, which silently broke every hostname URL.
   */
  describe('safe lookup with a real http.request', () => {
    const fetchVia = (service: LinkPreviewService, port: number) =>
      new Promise<string>((resolve, reject) => {
        const req = http.request(
          {
            host: 'localhost',
            port,
            // A fresh socket per request: a kept-alive one would skip lookup.
            agent: false,
            lookup: service['createSafeLookup'](),
          },
          (res) => {
            let body = '';
            res.on('data', (c: Buffer) => (body += c.toString()));
            res.on('end', () => resolve(body));
          },
        );
        req.on('error', reject);
        req.end();
      });

    let server: http.Server;
    let port: number;

    beforeAll(async () => {
      server = http.createServer((_req, res) => res.end('pong'));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));
    let addressPolicy: jest.SpyInstance | undefined;
    // Only the address policy is faked, so the loopback server is reachable;
    // DNS resolution and the lookup callback shape stay real.
    const allowAllAddresses = () => {
      addressPolicy = jest
        .spyOn(
          LinkPreviewService.prototype as unknown as {
            isPrivateAddress: (a: string) => boolean;
          },
          'isPrivateAddress',
        )
        .mockReturnValue(false);
    };
    afterEach(() => addressPolicy?.mockRestore());

    it('connects when the resolved address is allowed (options.all honoured)', async () => {
      const svc = new LinkPreviewService();
      // Only the address policy is faked, so the loopback server is reachable;
      // DNS resolution and the lookup callback shape are the real thing.
      allowAllAddresses();
      await expect(fetchVia(svc, port)).resolves.toBe('pong');
    });

    it('still refuses a private address, as a Forbidden error', async () => {
      const svc = new LinkPreviewService();
      await expect(fetchVia(svc, port)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('answers the legacy single-address form too', async () => {
      const svc = new LinkPreviewService();
      allowAllAddresses();
      const result = await new Promise<unknown>((resolve) => {
        svc['createSafeLookup']()('localhost', {}, (err, address, family) =>
          resolve({ err, address, family }),
        );
      });
      expect(result).toMatchObject({ err: null });
      expect(typeof (result as { address: unknown }).address).toBe('string');
    });
  });
});
