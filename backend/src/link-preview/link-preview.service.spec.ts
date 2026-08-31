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
