import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
    (LinkPreviewService.prototype as any).isPrivateAddress.call(
      { normalizeAddress: (LinkPreviewService.prototype as any).normalizeAddress },
      address,
    );

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
  ];

  it.each(blocked)('treats %s as private', (address) => {
    expect(isPrivate(address)).toBe(true);
  });

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1::1'];

  it.each(allowed)('still allows the public address %s', (address) => {
    expect(isPrivate(address)).toBe(false);
  });
});
