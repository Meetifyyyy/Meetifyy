import { Injectable, BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import * as cheerio from 'cheerio';

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

    const blockedHosts = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '10.',
      '192.168.',
      '172.16.',
      '169.254.',
    ];

    const isBlocked = blockedHosts.some((host) => parsedUrl.hostname.startsWith(host) || parsedUrl.hostname.endsWith(host));
    if (isBlocked) {
      throw new ForbiddenException('Forbidden target host');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        headers: { 'User-Agent': 'Meetifyy Link Preview Bot/1.0' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new UnprocessableEntityException(`Target responded with status ${response.status}`);
      }

      // Check content-type to make sure it's HTML, not binary
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        throw new BadRequestException('URL did not return an HTML document');
      }

      const html = await response.text();
      // Enforce content length limit (e.g. max 1MB)
      if (html.length > 1024 * 1024) {
        throw new BadRequestException('HTML payload too large');
      }

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
}
