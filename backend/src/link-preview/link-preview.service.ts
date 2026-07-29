import { Injectable, BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

@Injectable()
export class LinkPreviewService {
  async getPreview(url: string) {
    if (!url) {
      throw new BadRequestException('Missing url parameter');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('Protocol not supported. Only http and https allowed.');
    }

    await this.assertPublicTarget(parsedUrl);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        headers: { 'User-Agent': 'Meetifyy Link Preview Bot/1.0' },
        signal: controller.signal,
        redirect: 'manual',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status >= 300 && response.status < 400) {
          throw new ForbiddenException('Redirects are not allowed for link previews');
        }
        throw new UnprocessableEntityException(`Target responded with status ${response.status}`);
      }

      // Check content-type to make sure it's HTML, not binary
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        throw new BadRequestException('URL did not return an HTML document');
      }

       const maxBytes = 1024 * 1024;
       const contentLength = Number(response.headers.get('content-length') || 0);
       if (contentLength > maxBytes) throw new BadRequestException('HTML payload too large');
       if (!response.body) throw new BadRequestException('Empty HTML response');
       const reader = response.body.getReader();
       const chunks: Buffer[] = [];
       let totalBytes = 0;
       while (true) {
         const { done, value } = await reader.read();
         if (done) break;
         totalBytes += value.byteLength;
         if (totalBytes > maxBytes) {
           await reader.cancel();
           throw new BadRequestException('HTML payload too large');
         }
         chunks.push(Buffer.from(value));
       }
       const html = Buffer.concat(chunks).toString('utf8');

      const $ = cheerio.load(html);

      const getMeta = (prop: string) =>
        $(`meta[property="og:${prop}"]`).attr('content') ||
        $(`meta[name="og:${prop}"]`).attr('content') ||
        $(`meta[name="twitter:${prop}"]`).attr('content') ||
        null;

      const title = getMeta('title') || $('title').text() || null;
      const description = getMeta('description') || $('meta[name="description"]').attr('content') || null;
      const image = getMeta('image') || null;
      const siteName = getMeta('site_name') || parsedUrl.hostname;

      return {
        title: title ? title.trim() : null,
        description: description ? description.trim() : null,
        image,
        siteName,
        url: getMeta('url') || url,
        favicon: `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=32`,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new UnprocessableEntityException('Request timed out');
      }
      throw new UnprocessableEntityException(`Could not fetch preview: ${err.message}`);
    }
  }

  private async assertPublicTarget(parsedUrl: URL): Promise<void> {
    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      throw new ForbiddenException('Forbidden target host');
    }

    const addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true })).map(({ address }) => address);
    if (addresses.length === 0 || addresses.some((address) => this.isPrivateAddress(address))) {
      throw new ForbiddenException('Forbidden target host');
    }
  }

  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    if (isIP(normalized) === 4) {
      const octets = normalized.split('.').map(Number);
      const [a, b] = octets;
      return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
    }
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
  }
}
